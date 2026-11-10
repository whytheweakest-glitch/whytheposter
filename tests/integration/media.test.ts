import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { intakeMaterial } from "@/core/materials/service";
import { createPost, updatePostContent, submitForReview, approvePost, PostError } from "@/core/posts/service";
import { publishPost } from "@/core/publishing/publisher";
import { saveFile } from "@/core/storage/files";
import { resetDb, seed, FakeTelegram } from "../helpers";

let ctx: Awaited<ReturnType<typeof seed>>;
let tg: FakeTelegram;
beforeEach(async () => {
  await resetDb();
  ctx = await seed();
  tg = new FakeTelegram();
});

const jpegWithExif = () =>
  Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.from([0xff, 0xe1, 0x00, 0x0b]), Buffer.from("Exif\0\0GPS"), Buffer.from([0xff, 0xda, 0x00, 0x02, Math.floor(Math.random() * 255), 0xff, 0xd9])]);

async function materialWithFiles(kinds: ("image" | "video" | "document")[], group = "g1") {
  let materialId = "";
  for (const [i, kind] of kinds.entries()) {
    const r = await intakeMaterial({ sourceKind: "telegram_bot", type: kind === "image" ? "image" : kind, mediaGroupId: group, text: i === 0 ? "подпись" : null, attachments: [{ kind, telegramFileId: `f${i}`, telegramFileUniqueId: `${group}u${i}` }] });
    materialId = r.materialId;
  }
  const atts = await db.attachment.findMany({ where: { materialId }, orderBy: { sortOrder: "asc" } });
  for (const a of atts) {
    const saved = await saveFile(a.kind === "image" ? jpegWithExif() : Buffer.from(`file-${a.id}`), a.kind === "image" ? "jpg" : "bin");
    await db.attachment.update({ where: { id: a.id }, data: { storageKey: saved.key, sha256: saved.sha256, fileName: `${a.kind}.bin` } });
  }
  return { materialId, atts: await db.attachment.findMany({ where: { materialId }, orderBy: { sortOrder: "asc" } }) };
}

async function approvedPostWith(attachmentIds: string[], materialId: string, body = "Подпись") {
  const p = await createPost({ materialIds: [materialId], body, actorUserId: ctx.owner.id });
  await updatePostContent(p.id, { attachmentIds }, { userId: ctx.owner.id });
  await submitForReview(p.id, ctx.owner.id);
  await approvePost(p.id, { userId: ctx.owner.id, via: "dashboard" });
  return p.id;
}

describe("альбомы и медиа", () => {
  it("части альбома собираются в один материал", async () => {
    const { materialId, atts } = await materialWithFiles(["image", "image", "video"]);
    expect(await db.material.count()).toBe(1);
    expect(atts).toHaveLength(3);
    expect(await db.job.count({ where: { kind: "download_attachment" } })).toBe(3);
    expect((await db.material.findUniqueOrThrow({ where: { id: materialId } })).text).toBe("подпись");
  });

  it("фото публикуется без EXIF", async () => {
    const { materialId, atts } = await materialWithFiles(["image"]);
    const id = await approvedPostWith([atts[0].id], materialId);
    expect((await db.post.findUniqueOrThrow({ where: { id } })).format).toBe("photo");
    expect((await publishPost(id, tg)).result).toBe("published");
    expect(tg.calls[0].method).toBe("sendPhoto");
    expect(tg.files[0].head.includes(Buffer.from("GPS"))).toBe(false);
  });

  it("альбом уходит одним sendMediaGroup, все message_id сохраняются", async () => {
    const { materialId, atts } = await materialWithFiles(["image", "video", "image"]);
    const id = await approvedPostWith(atts.map((a) => a.id), materialId);
    const r = await publishPost(id, tg);
    expect(r).toMatchObject({ result: "published" });
    expect(tg.calls.map((c) => c.method)).toEqual(["sendMediaGroup"]);
    expect(tg.files.map((f) => f.method)).toEqual(["photo", "video", "photo"]);
    expect(JSON.parse((await db.post.findUniqueOrThrow({ where: { id } })).telegramMessageIds!)).toHaveLength(3);
  });

  it("видео и документ", async () => {
    const v = await materialWithFiles(["video"], "gv");
    const vid = await approvedPostWith([v.atts[0].id], v.materialId);
    const d = await materialWithFiles(["document"], "gd");
    const did = await approvedPostWith([d.atts[0].id], d.materialId);
    await publishPost(vid, tg);
    await publishPost(did, tg);
    expect(tg.calls.map((c) => c.method)).toEqual(["sendVideo", "sendDocument"]);
  });

  it("смена вложений после подтверждения снимает его", async () => {
    const { materialId, atts } = await materialWithFiles(["image", "image"]);
    const id = await approvedPostWith([atts[0].id], materialId);
    const r = await updatePostContent(id, { attachmentIds: [atts[1].id] }, { userId: ctx.owner.id });
    expect(r.approvalRevoked).toBe(true);
    expect((await publishPost(id, tg)).result).toBe("skipped");
  });

  it("нельзя смешать документ с фото и выбрать нескачанный файл", async () => {
    const a = await materialWithFiles(["image", "document"], "gm");
    const p = await createPost({ materialIds: [a.materialId], body: "x", actorUserId: ctx.owner.id });
    await expect(updatePostContent(p.id, { attachmentIds: a.atts.map((x) => x.id) }, { userId: ctx.owner.id })).rejects.toThrow(PostError);
    await db.attachment.update({ where: { id: a.atts[0].id }, data: { storageKey: null } });
    await expect(updatePostContent(p.id, { attachmentIds: [a.atts[0].id] }, { userId: ctx.owner.id })).rejects.toThrow(/не скачана/);
  });

  it("пропавший файл → failed (точно не отправлено), а не «неизвестно»", async () => {
    const { materialId, atts } = await materialWithFiles(["image"], "gx");
    const id = await approvedPostWith([atts[0].id], materialId);
    await db.attachment.updateMany({ where: { postId: id }, data: { storageKey: "zz/zz/missing.jpg" } });
    expect((await publishPost(id, tg)).result).toBe("failed");
    expect(tg.calls).toHaveLength(0);
  });

  it("подпись к медиа ограничена 1024 символами", async () => {
    const { materialId, atts } = await materialWithFiles(["image"], "gl");
    const p = await createPost({ materialIds: [materialId], body: "а".repeat(1500), actorUserId: ctx.owner.id });
    await updatePostContent(p.id, { attachmentIds: [atts[0].id] }, { userId: ctx.owner.id });
    await submitForReview(p.id, ctx.owner.id);
    await expect(approvePost(p.id, { userId: ctx.owner.id, via: "dashboard" })).rejects.toThrow(/1024/);
  });
});
