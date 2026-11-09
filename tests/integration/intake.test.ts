import { beforeEach, describe, expect, it, afterEach } from "vitest";
import { db } from "@/lib/db";
import { intakeMaterial } from "@/core/materials/service";
import { classifyMaterial, generateDraftVariants } from "@/core/ai/service";
import { setAiProvider, AiUnavailableError, type AiProvider } from "@/core/ai/provider";
import { createPost } from "@/core/posts/service";
import { runDueJobs, enqueueJob, claimNextJob } from "@/core/jobs/queue";
import { consumeLoginToken, createLoginToken, userBySessionToken } from "@/core/auth/sessions";
import { importReferenceExport } from "@/core/reference/import";
import { resetDb, seed } from "../helpers";

let ctx: Awaited<ReturnType<typeof seed>>;
beforeEach(async () => {
  await resetDb();
  ctx = await seed();
});
afterEach(() => setAiProvider(undefined));

const fakeAi = (out: unknown): AiProvider => ({ name: "fake", model: "fake-1", ping: async () => true, json: async (_m, schema) => schema.parse(out) });
const downAi: AiProvider = { name: "fake", model: "down", ping: async () => false, json: async () => { throw new AiUnavailableError("down"); } };

describe("приём материалов", () => {
  it("повторная ссылка не создаёт дубликат", async () => {
    const a = await intakeMaterial({ sourceKind: "telegram_bot", type: "link", url: "https://site.com/a?utm_source=x" });
    const b = await intakeMaterial({ sourceKind: "telegram_bot", type: "link", url: "https://www.site.com/a/", ownerNote: "ещё раз" });
    expect(a.status).toBe("created");
    expect(b).toEqual({ status: "duplicate", materialId: a.materialId });
    expect(await db.material.count()).toBe(1);
    const m = await db.material.findUniqueOrThrow({ where: { id: a.materialId } });
    expect(m.duplicateCount).toBe(1);
    expect(m.ownerNote).toBe("ещё раз");
  });

  it("одновременная отправка одной ссылки создаёт одну запись", async () => {
    const rs = await Promise.allSettled(Array.from({ length: 5 }, () => intakeMaterial({ sourceKind: "telegram_bot", type: "link", url: "https://race.com/x" })));
    expect(rs.every((r) => r.status === "fulfilled")).toBe(true);
    expect(await db.material.count()).toBe(1);
  });

  it("материал сохраняется, даже если AI недоступен", async () => {
    setAiProvider(downAi);
    const r = await intakeMaterial({ sourceKind: "telegram_bot", type: "text", text: "мысль" });
    const done = await runDueJobs({ classify_material: async (p) => classifyMaterial(String(p.materialId)) });
    expect(done).toBe(1);
    const m = await db.material.findUniqueOrThrow({ where: { id: r.materialId } });
    expect(m.status).toBe("ready");
    expect(m.processingError).toContain("AI");
    const job = await db.job.findFirstOrThrow({ where: { kind: "classify_material" } });
    expect(job.status).toBe("queued"); // будет повтор
    expect(job.runAfter.getTime()).toBeGreaterThan(Date.now());
  });

  it("при выключенном AI материал сразу готов к ручной работе", async () => {
    setAiProvider(null);
    const r = await intakeMaterial({ sourceKind: "manual", type: "text", text: "x" });
    await classifyMaterial(r.materialId);
    expect((await db.material.findUniqueOrThrow({ where: { id: r.materialId } })).status).toBe("ready");
  });

  it("AI предлагает категорию и описание, но не перетирает ручной выбор", async () => {
    setAiProvider(fakeAi({ category: "whythefinds", confidence: 0.8, topic: "шрифты", summary: "Сайт со шрифтами" }));
    const r = await intakeMaterial({ sourceKind: "telegram_bot", type: "link", url: "https://fonts.example" });
    await classifyMaterial(r.materialId);
    let m = await db.material.findUniqueOrThrow({ where: { id: r.materialId }, include: { category: true } });
    expect(m.category?.slug).toBe("whythefinds");
    expect(m.summary).toBe("Сайт со шрифтами");
    expect(m.categorySetBy).toBe("ai");
    const people = await db.category.findUniqueOrThrow({ where: { slug: "whythepeople" } });
    await db.material.update({ where: { id: m.id }, data: { categoryId: people.id, categorySetBy: "user" } });
    await classifyMaterial(r.materialId);
    m = await db.material.findUniqueOrThrow({ where: { id: r.materialId }, include: { category: true } });
    expect(m.category?.slug).toBe("whythepeople");
    expect(await db.aiGeneration.count({ where: { mode: "curator", status: "ok" } })).toBe(2);
  });

  it("AI-черновик сохраняется вариантами, без смены статуса поста", async () => {
    setAiProvider(fakeAi({ variants: [{ body: "Вариант 1" }, { body: "Вариант 2" }] }));
    const r = await intakeMaterial({ sourceKind: "telegram_bot", type: "link", url: "https://x.example" });
    const p = await createPost({ materialIds: [r.materialId], actorUserId: ctx.owner.id });
    expect(await generateDraftVariants(p.id)).toBe(2);
    const drafts = await db.draft.findMany({ where: { postId: p.id, origin: "ai" } });
    expect(drafts.map((d) => d.body)).toEqual(["Вариант 1", "Вариант 2"]);
    expect((await db.post.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("draft");
  });
});

describe("очередь задач", () => {
  it("dedupKey не даёт поставить задачу дважды, пока она активна", async () => {
    const a = await enqueueJob({ kind: "notify_text", payload: {}, dedupKey: "k" });
    const b = await enqueueJob({ kind: "notify_text", payload: {}, dedupKey: "k" });
    expect(a.id).toBe(b.id);
    await runDueJobs({ notify_text: async () => {} });
    const c = await enqueueJob({ kind: "notify_text", payload: {}, dedupKey: "k" });
    expect(c.id).not.toBe(a.id);
  });

  it("задача с истёкшей арендой возвращается в работу", async () => {
    await enqueueJob({ kind: "notify_text", payload: {} });
    const j = await claimNextJob();
    expect(j?.status).toBe("running");
    expect(await claimNextJob()).toBeNull();
    expect((await claimNextJob(undefined, new Date(Date.now() + 10 * 60_000)))?.id).toBe(j!.id);
  });
});

describe("вход в Dashboard", () => {
  it("одноразовая ссылка работает один раз", async () => {
    const t = await createLoginToken(ctx.owner.id);
    const s = await consumeLoginToken(t);
    expect(s).not.toBeNull();
    expect((await userBySessionToken(s!.sessionToken))?.id).toBe(ctx.owner.id);
    expect(await consumeLoginToken(t)).toBeNull();
  });
  it("отключённый пользователь не входит", async () => {
    const t = await createLoginToken(ctx.admin.id);
    await db.user.update({ where: { id: ctx.admin.id }, data: { isActive: false } });
    expect(await consumeLoginToken(t)).toBeNull();
  });
});

describe("канал-образец", () => {
  it("импорт берёт только собственные содержательные посты и не дублирует", async () => {
    const data = {
      name: "ref",
      messages: [
        { id: 1, type: "message", date: "2025-01-01T10:00:00", text: ["Очень длинный текст поста про ", { type: "bold", text: "дизайн" }, " и шрифты, больше сорока символов"] },
        { id: 2, type: "message", date: "2025-01-02T10:00:00", text: "коротко" },
        { id: 3, type: "message", date: "2025-01-03T10:00:00", text: "Пересланный пост, который не нужен в образце стиля, длинный", forwarded_from: "x" },
        { id: 4, type: "service", date: "2025-01-03T10:00:00", text: "" },
      ],
    };
    expect(await importReferenceExport(data)).toMatchObject({ imported: 1, skipped: 3 });
    await importReferenceExport(data);
    expect(await db.referencePost.count()).toBe(1);
  });
});
