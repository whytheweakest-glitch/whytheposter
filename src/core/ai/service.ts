import { z } from "zod";
import { db } from "@/lib/db";
import { errorMessage } from "@/lib/logger";
import { logActivity } from "@/core/activity/log";
import { getAiProvider, AiInvalidOutputError, type AiProvider } from "./provider";
import { curatorSystemPrompt, CURATOR_PROMPT_VERSION } from "./prompts/curator";
import { EDITOR_SYSTEM_PROMPT, EDITOR_PROMPT_VERSION } from "./prompts/editor";
import { PermanentJobError } from "@/core/jobs/queue";

const curatorSchema = z.object({
  category: z.string(),
  confidence: z.number().min(0).max(1),
  topic: z.string().max(120).optional().default(""),
  title: z.string().max(300).optional().default(""),
  summary: z.string().max(1200).optional().default(""),
});
const curatorJsonSchema = {
  type: "object",
  properties: { category: { type: "string" }, confidence: { type: "number" }, topic: { type: "string" }, title: { type: "string" }, summary: { type: "string" } },
  required: ["category", "confidence", "summary"],
};

const editorSchema = z.object({ variants: z.array(z.object({ body: z.string().min(1).max(4000) })).min(1).max(3) });
const editorJsonSchema = {
  type: "object",
  properties: { variants: { type: "array", items: { type: "object", properties: { body: { type: "string" } }, required: ["body"] } } },
  required: ["variants"],
};

function materialAsText(m: { type: string; originalUrl: string | null; title: string | null; text: string | null; extractedText: string | null; ownerNote: string | null; sourceName: string | null }) {
  return [
    `Тип: ${m.type}`,
    m.originalUrl && `Ссылка: ${m.originalUrl}`,
    m.sourceName && `Источник: ${m.sourceName}`,
    m.title && `Заголовок: ${m.title}`,
    m.ownerNote && `Заметка автора: ${m.ownerNote}`,
    m.text && `Текст от автора:\n${m.text.slice(0, 4000)}`,
    m.extractedText && `Извлечённый текст:\n${m.extractedText.slice(0, 6000)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

async function record(provider: AiProvider, mode: string, promptVersion: string, subjectType: string, subjectId: string, started: number, output: unknown, error?: unknown) {
  return db.aiGeneration.create({
    data: {
      mode,
      provider: provider.name,
      model: provider.model,
      promptVersion,
      subjectType,
      subjectId,
      output: output === undefined ? null : JSON.stringify(output),
      status: error ? (error instanceof AiInvalidOutputError ? "invalid_output" : "error") : "ok",
      error: error ? errorMessage(error) : null,
      durationMs: Date.now() - started,
    },
  });
}

/**
 * Curator: предлагает категорию, тему и описание. Категорию, выбранную автором вручную, не трогает.
 * Если AI выключен, материал просто становится ready: ручная работа не блокируется.
 */
export async function classifyMaterial(materialId: string, provider = getAiProvider()) {
  const m = await db.material.findUnique({ where: { id: materialId } });
  if (!m || m.status === "deleted") return;
  if (!provider) {
    if (m.status === "inbox" || m.status === "processing") await db.material.update({ where: { id: materialId }, data: { status: "ready" } });
    return;
  }
  await db.material.update({ where: { id: materialId }, data: { status: m.status === "inbox" ? "processing" : m.status } });
  const categories = await db.category.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } });
  const started = Date.now();
  try {
    const out = await provider.json(
      [
        { role: "system", content: curatorSystemPrompt(categories.map((c) => ({ slug: c.slug, name: c.name, description: c.descriptionForAi }))) },
        { role: "user", content: materialAsText(m) },
      ],
      curatorSchema,
      curatorJsonSchema,
    );
    await record(provider, "curator", CURATOR_PROMPT_VERSION, "material", materialId, started, out);
    const cat = categories.find((c) => c.slug.toLowerCase() === out.category.toLowerCase());
    const fresh = await db.material.findUniqueOrThrow({ where: { id: materialId } });
    await db.material.update({
      where: { id: materialId },
      data: {
        status: fresh.status === "processing" ? "ready" : fresh.status,
        processingError: null,
        summary: fresh.summary ?? (out.summary || null),
        topic: fresh.topic ?? (out.topic || null),
        title: fresh.title ?? (out.title || null),
        ...(fresh.categorySetBy === "user" || !cat ? {} : { categoryId: cat.id, categoryConfidence: out.confidence, categorySetBy: "ai" }),
      },
    });
    await logActivity({ actorType: "ai", action: "material.classified", entityType: "material", entityId: materialId, data: { category: cat?.slug ?? null, confidence: out.confidence } });
  } catch (e) {
    await record(provider, "curator", CURATOR_PROMPT_VERSION, "material", materialId, started, undefined, e);
    await db.material.update({ where: { id: materialId }, data: { status: "ready", processingError: `AI: ${errorMessage(e)}` } });
    // материал уже сохранён и доступен; повторяем только временные сбои
    if (e instanceof AiInvalidOutputError) throw new PermanentJobError(errorMessage(e));
    throw e;
  }
}

const WORD_RE = /[\p{L}\d]{4,}/gu;
function words(s: string) {
  return new Set((s.toLowerCase().match(WORD_RE) ?? []).map((w) => w.slice(0, 6)));
}

/** Подбирает посты канала-образца, похожие по словам (без нейросетей). */
export async function pickStyleExamples(queryText: string, categoryId: string | null, limit = 6) {
  const all = await db.referencePost.findMany({ orderBy: { date: "desc" }, take: 2000 });
  if (!all.length) return [];
  const q = words(queryText);
  const scored = all.map((p) => {
    const w = words(p.text);
    let overlap = 0;
    for (const x of q) if (w.has(x)) overlap++;
    const lengthPenalty = p.text.length > 2500 ? 0.5 : 1;
    return { p, score: (overlap + (categoryId && p.categoryId === categoryId ? 3 : 0)) * lengthPenalty };
  });
  scored.sort((a, b) => b.score - a.score || b.p.date.getTime() - a.p.date.getTime());
  return scored.slice(0, limit).map((s) => s.p.text);
}

/** Editor: варианты текста поста по его материалам. Каждый вариант сохраняется как версия черновика с origin=ai. */
export async function generateDraftVariants(postId: string, provider = getAiProvider()) {
  if (!provider) throw new PermanentJobError("AI выключен");
  const post = await db.post.findUniqueOrThrow({ where: { id: postId }, include: { postMaterials: { include: { material: true } }, category: true } });
  const materialsText = post.postMaterials.map((pm) => materialAsText(pm.material)).join("\n\n---\n\n");
  const examples = await pickStyleExamples(materialsText, post.categoryId);
  const user = [
    post.category && `Рубрика: ${post.category.name}`,
    examples.length && `Примеры постов автора (для стиля, не копировать):\n${examples.map((e, i) => `[${i + 1}]\n${e.slice(0, 1500)}`).join("\n\n")}`,
    `Материалы:\n${materialsText || "(нет материалов)"}`,
    post.body.trim() && `Текущий черновик автора (сохрани его мысль):\n${post.body}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const started = Date.now();
  try {
    const out = await provider.json([{ role: "system", content: EDITOR_SYSTEM_PROMPT }, { role: "user", content: user }], editorSchema, editorJsonSchema);
    const gen = await record(provider, "editor", EDITOR_PROMPT_VERSION, "post", postId, started, out);
    const last = await db.draft.findFirst({ where: { postId }, orderBy: { version: "desc" } });
    let v = last?.version ?? 0;
    for (const variant of out.variants) {
      await db.draft.create({ data: { postId, version: ++v, body: variant.body.trim(), origin: "ai", aiGenerationId: gen.id } });
    }
    await logActivity({ actorType: "ai", action: "post.ai_variants", entityType: "post", entityId: postId, data: { count: out.variants.length } });
    return out.variants.length;
  } catch (e) {
    await record(provider, "editor", EDITOR_PROMPT_VERSION, "post", postId, started, undefined, e);
    if (e instanceof AiInvalidOutputError) throw new PermanentJobError(errorMessage(e));
    throw e;
  }
}
