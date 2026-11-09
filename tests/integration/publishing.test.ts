import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createPost, submitForReview, approvePost, updatePostContent, rejectPost, resolveUnknown, reschedulePost, PostError } from "@/core/posts/service";
import { publishPost, duePostIds, recoverStalePublishing } from "@/core/publishing/publisher";
import { TelegramApiError, TelegramNetworkError } from "@/core/telegram/api";
import { resetDb, seed, FakeTelegram } from "../helpers";

let ctx: Awaited<ReturnType<typeof seed>>;
let tg: FakeTelegram;

beforeEach(async () => {
  await resetDb();
  ctx = await seed();
  tg = new FakeTelegram();
});

async function reviewPost(body = "Текст поста") {
  const p = await createPost({ body, actorUserId: ctx.owner.id });
  await submitForReview(p.id, ctx.owner.id);
  return p.id;
}

describe("подтверждение и публикация", () => {
  it("без подтверждения пост не публикуется", async () => {
    const id = await reviewPost();
    expect(await duePostIds()).toEqual([]);
    const r = await publishPost(id, tg);
    expect(r).toMatchObject({ result: "skipped" });
    expect(tg.calls).toHaveLength(0);
  });

  it("сохранение черновика не является подтверждением", async () => {
    const p = await createPost({ body: "a", actorUserId: ctx.owner.id });
    await updatePostContent(p.id, { body: "b" }, { userId: ctx.owner.id, autosave: true });
    expect((await publishPost(p.id, tg)).result).toBe("skipped");
    expect(tg.calls).toHaveLength(0);
  });

  it("после подтверждения публикуется ровно один раз", async () => {
    const id = await reviewPost();
    await approvePost(id, { userId: ctx.owner.id, via: "dashboard" });
    const [a, b] = await Promise.all([publishPost(id, tg), publishPost(id, tg)]);
    expect([a.result, b.result].sort()).toEqual(["published", "skipped"]);
    expect(tg.calls).toHaveLength(1);
    expect(tg.calls[0].chatId).toBe("-1001");
    const post = await db.post.findUniqueOrThrow({ where: { id } });
    expect(post.status).toBe("published");
    expect(post.publishedUrl).toContain("t.me/wtw_test/");
    expect((await publishPost(id, tg)).result).toBe("skipped");
    expect(tg.calls).toHaveLength(1);
  });

  it("сохраняет, кто и когда подтвердил", async () => {
    const id = await reviewPost();
    const appr = await approvePost(id, { userId: ctx.owner.id, via: "bot" });
    expect(appr).toMatchObject({ userId: ctx.owner.id, via: "bot", action: "approve" });
    expect(appr.createdAt).toBeInstanceOf(Date);
  });

  it("правка после подтверждения отзывает его", async () => {
    const id = await reviewPost();
    await approvePost(id, { userId: ctx.owner.id, via: "dashboard" });
    const r = await updatePostContent(id, { body: "новый текст" }, { userId: ctx.owner.id });
    expect(r.approvalRevoked).toBe(true);
    expect(r.post.status).toBe("review");
    expect((await publishPost(id, tg)).result).toBe("skipped");
    expect(tg.calls).toHaveLength(0);
  });

  it("если хеш изменился в обход сервиса, публикация блокируется", async () => {
    const id = await reviewPost();
    await approvePost(id, { userId: ctx.owner.id, via: "dashboard" });
    await db.post.update({ where: { id }, data: { contentHash: "tampered" } });
    expect((await publishPost(id, tg)).result).toBe("skipped");
    expect((await db.post.findUniqueOrThrow({ where: { id } })).status).toBe("review");
    expect(tg.calls).toHaveLength(0);
  });

  it("администратор без права подтверждения не может подтвердить", async () => {
    const id = await reviewPost();
    await expect(approvePost(id, { userId: ctx.admin.id, via: "bot" })).rejects.toThrow(PostError);
  });

  it("основной канал выключен по умолчанию", async () => {
    const id = await reviewPost();
    await updatePostContent(id, { channelId: ctx.main.id }, { userId: ctx.owner.id });
    await expect(approvePost(id, { userId: ctx.owner.id, via: "dashboard" })).rejects.toThrow(/выключена/);
  });

  it("основной канал не публикуется без MAIN_CHANNEL_PUBLISH_CONFIRMED, даже если включён в БД", async () => {
    await db.channel.update({ where: { id: ctx.main.id }, data: { isPublishEnabled: true } });
    const id = await reviewPost();
    await updatePostContent(id, { channelId: ctx.main.id }, { userId: ctx.owner.id });
    await approvePost(id, { userId: ctx.owner.id, via: "dashboard" });
    expect((await publishPost(id, tg)).result).toBe("skipped");
    expect(tg.calls).toHaveLength(0);
  });

  it("обрыв связи → publish_unknown без повторной отправки", async () => {
    const id = await reviewPost();
    await approvePost(id, { userId: ctx.owner.id, via: "dashboard" });
    tg.next = () => Promise.reject(new TelegramNetworkError("timeout"));
    expect((await publishPost(id, tg)).result).toBe("unknown");
    tg.next = null;
    expect(await duePostIds()).toEqual([]);
    expect((await publishPost(id, tg)).result).toBe("skipped");
    expect(tg.calls).toHaveLength(1);
    // автор говорит «не вышел» → нужно новое подтверждение
    await resolveUnknown(id, { userId: ctx.owner.id, outcome: "not_published" });
    expect((await db.post.findUniqueOrThrow({ where: { id } })).status).toBe("review");
    expect((await publishPost(id, tg)).result).toBe("skipped");
    await approvePost(id, { userId: ctx.owner.id, via: "dashboard" });
    expect((await publishPost(id, tg)).result).toBe("published");
    expect(tg.calls).toHaveLength(2);
  });

  it("429 возвращает пост в очередь, 400 переводит в failed", async () => {
    const id = await reviewPost();
    await approvePost(id, { userId: ctx.owner.id, via: "dashboard" });
    tg.next = () => Promise.reject(new TelegramApiError(429, "Too Many Requests", 7));
    expect(await publishPost(id, tg)).toEqual({ result: "rate_limited", retryAfterSec: 7 });
    expect((await db.post.findUniqueOrThrow({ where: { id } })).status).toBe("approved");
    tg.next = () => Promise.reject(new TelegramApiError(400, "Bad Request: can't parse entities"));
    expect((await publishPost(id, tg)).result).toBe("failed");
    expect((await db.post.findUniqueOrThrow({ where: { id } })).status).toBe("failed");
  });

  it("запланированный пост выходит только по наступлении времени", async () => {
    const id = await reviewPost();
    const when = new Date(Date.now() + 3600_000);
    await approvePost(id, { userId: ctx.owner.id, via: "dashboard", scheduledFor: when });
    expect((await db.post.findUniqueOrThrow({ where: { id } })).status).toBe("scheduled");
    expect(await duePostIds()).toEqual([]);
    expect(await duePostIds(new Date(when.getTime() + 1000))).toEqual([id]);
    expect((await publishPost(id, tg, new Date(when.getTime() + 1000))).result).toBe("published");
  });

  it("перенос в календаре неподтверждённого поста не делает его подтверждённым", async () => {
    const id = await reviewPost();
    await reschedulePost(id, new Date(Date.now() - 1000), ctx.owner.id);
    expect(await duePostIds()).toEqual([]);
    expect((await publishPost(id, tg)).result).toBe("skipped");
  });

  it("зависший publishing после перезапуска → publish_unknown", async () => {
    const id = await reviewPost();
    await approvePost(id, { userId: ctx.owner.id, via: "dashboard" });
    await db.post.update({ where: { id }, data: { status: "publishing", publishAttemptId: "x", publishLeaseUntil: new Date(Date.now() - 1000) } });
    expect(await recoverStalePublishing()).toEqual([id]);
    expect((await db.post.findUniqueOrThrow({ where: { id } })).status).toBe("publish_unknown");
  });

  it("отклонённый пост не публикуется", async () => {
    const id = await reviewPost();
    await approvePost(id, { userId: ctx.owner.id, via: "dashboard" });
    await rejectPost(id, { userId: ctx.owner.id, via: "bot" });
    expect((await publishPost(id, tg)).result).toBe("skipped");
  });

  it("неверная разметка блокирует подтверждение", async () => {
    const id = await reviewPost("<div>нет</div>");
    await expect(approvePost(id, { userId: ctx.owner.id, via: "dashboard" })).rejects.toThrow(/не поддерживает/);
  });
});
