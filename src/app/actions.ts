"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { errorMessage } from "@/lib/logger";
import { requireUser } from "@/lib/web/auth";
import { logActivity } from "@/core/activity/log";
import { intakeMaterial, setMaterialCategory, setMaterialStatus, softDeleteMaterial } from "@/core/materials/service";
import { extractUrls } from "@/core/materials/url";
import {
  approvePost, archivePost, createPost, rejectPost, reschedulePost, resolveUnknown, returnToDraft, submitForReview, updatePostContent, PostError,
} from "@/core/posts/service";
import { enqueueJob } from "@/core/jobs/queue";
import { revokeSession, SESSION_COOKIE } from "@/core/auth/sessions";

const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" ? v : "";
};
/** datetime-local без часового пояса: трактуется как местное время ПК, на котором работает система. */
const dateOrNull = (v: string) => (v ? new Date(v) : null);

function fail(path: string, e: unknown): never {
  const msg = e instanceof PostError ? e.message : `Ошибка: ${errorMessage(e)}`;
  redirect(`${path}${path.includes("?") ? "&" : "?"}error=${encodeURIComponent(msg)}`);
}

// ---------- материалы ----------

export async function addManualMaterial(f: FormData) {
  const user = await requireUser();
  const text = str(f, "text").trim();
  if (!text) return;
  const urls = extractUrls(text);
  if (urls.length) {
    let note = text;
    for (const u of urls) note = note.replace(u, "");
    for (const url of urls) await intakeMaterial({ sourceKind: "manual", type: "link", url, ownerNote: note.trim() || null, actorUserId: user.id });
  } else {
    await intakeMaterial({ sourceKind: "manual", type: "text", text, actorUserId: user.id });
  }
  revalidatePath("/inbox");
}

export async function materialAction(f: FormData) {
  const user = await requireUser();
  const id = str(f, "id");
  const action = str(f, "op");
  if (action === "archive") await setMaterialStatus(id, "archived", user.id);
  if (action === "restore") await setMaterialStatus(id, "ready", user.id);
  if (action === "delete") {
    if (str(f, "confirm") !== "yes") redirect(`/inbox?confirmDelete=${id}`);
    await softDeleteMaterial(id, user.id);
  }
  if (action === "category") await setMaterialCategory(id, str(f, "categoryId") || null, user.id);
  if (action === "note") {
    await db.material.update({ where: { id }, data: { ownerNote: str(f, "note") || null } });
    await logActivity({ actorType: "user", actorUserId: user.id, action: "material.note_updated", entityType: "material", entityId: id });
  }
  if (action === "reclassify") await enqueueJob({ kind: "classify_material", payload: { materialId: id }, dedupKey: `classify:${id}`, maxAttempts: 3 });
  if (action === "draft") {
    const post = await createPost({ materialIds: [id], actorUserId: user.id });
    redirect(`/posts/${post.id}`);
  }
  revalidatePath("/inbox");
}

export async function bulkCategory(f: FormData) {
  const user = await requireUser();
  const ids = f.getAll("ids").filter((x): x is string => typeof x === "string");
  const categoryId = str(f, "categoryId") || null;
  for (const id of ids) await setMaterialCategory(id, categoryId, user.id);
  revalidatePath("/inbox");
}

// ---------- публикации ----------

export async function newPost() {
  const user = await requireUser();
  const post = await createPost({ actorUserId: user.id });
  redirect(`/posts/${post.id}`);
}

/** Автосохранение из редактора. Возвращает результат, а не редирект. */
export async function autosavePost(postId: string, body: string) {
  const user = await requireUser();
  try {
    const r = await updatePostContent(postId, { body }, { userId: user.id, autosave: true });
    return { ok: true as const, status: r.post.status, contentHash: r.post.contentHash, approvalRevoked: r.approvalRevoked, savedAt: new Date().toISOString() };
  } catch (e) {
    return { ok: false as const, error: e instanceof PostError ? e.message : errorMessage(e) };
  }
}

export async function savePostMeta(f: FormData) {
  const user = await requireUser();
  const id = str(f, "id");
  const path = `/posts/${id}`;
  try {
    await updatePostContent(
      id,
      {
        body: f.has("body") ? str(f, "body") : undefined,
        format: str(f, "format") === "photo" ? "photo" : "text",
        categoryId: str(f, "categoryId") || null,
        channelId: str(f, "channelId") || null,
      },
      { userId: user.id },
    );
    const photoId = str(f, "photoAttachmentId");
    if (photoId) await attachPhoto(id, photoId);
  } catch (e) {
    fail(path, e);
  }
  revalidatePath(path);
  redirect(path);
}

/** Привязывает к посту изображение из материала (копия записи о вложении, файл тот же). */
async function attachPhoto(postId: string, attachmentId: string) {
  const src = await db.attachment.findUniqueOrThrow({ where: { id: attachmentId } });
  if (!src.storageKey) throw new PostError("Изображение ещё не скачано");
  await db.attachment.updateMany({ where: { postId, deletedAt: null }, data: { deletedAt: new Date() } });
  await db.attachment.create({ data: { postId, kind: "image", storageKey: src.storageKey, sha256: src.sha256, mime: src.mime, sizeBytes: src.sizeBytes, fileName: src.fileName } });
  // хеш содержимого учитывает вложения: пересчитываем через обычное обновление
  await updatePostContent(postId, {}, { userId: null });
}

export async function useVariant(f: FormData) {
  const user = await requireUser();
  const id = str(f, "id");
  const draft = await db.draft.findUniqueOrThrow({ where: { id: str(f, "draftId") } });
  try {
    await updatePostContent(id, { body: draft.body }, { userId: user.id });
  } catch (e) {
    fail(`/posts/${id}`, e);
  }
  redirect(`/posts/${id}`);
}

export async function requestAiVariants(f: FormData) {
  const user = await requireUser();
  const id = str(f, "id");
  await enqueueJob({ kind: "generate_draft", payload: { postId: id, notifyUserId: user.id }, dedupKey: `draft:${id}`, maxAttempts: 2 });
  redirect(`/posts/${id}?info=${encodeURIComponent("Запрос отправлен локальной модели. Обновите страницу через минуту")}`);
}

export async function postAction(f: FormData) {
  const user = await requireUser();
  const id = str(f, "id");
  const action = str(f, "op");
  const path = `/posts/${id}`;
  try {
    switch (action) {
      case "review":
        await submitForReview(id, user.id);
        break;
      case "approve":
        // отдельное явное действие: галочка + хеш содержимого, которое автор видел в предпросмотре
        if (str(f, "confirm") !== "yes") throw new PostError("Поставьте отметку «Я проверил текст и предпросмотр»");
        await approvePost(id, { userId: user.id, via: "dashboard", scheduledFor: dateOrNull(str(f, "scheduledAt")), expectedContentHash: str(f, "contentHash") });
        break;
      case "reject":
        await rejectPost(id, { userId: user.id, via: "dashboard" });
        break;
      case "draft":
        await returnToDraft(id, user.id);
        break;
      case "archive":
        await archivePost(id, user.id);
        break;
      case "reschedule":
        await reschedulePost(id, dateOrNull(str(f, "scheduledAt")), user.id);
        break;
      case "resolve_published":
        await resolveUnknown(id, { userId: user.id, outcome: "published", publishedUrl: str(f, "publishedUrl") || null });
        break;
      case "resolve_not_published":
        await resolveUnknown(id, { userId: user.id, outcome: "not_published" });
        break;
    }
  } catch (e) {
    fail(path, e);
  }
  revalidatePath(path);
  redirect(path);
}

export async function rescheduleFromCalendar(f: FormData) {
  const user = await requireUser();
  try {
    await reschedulePost(str(f, "id"), dateOrNull(str(f, "scheduledAt")), user.id);
  } catch (e) {
    fail("/calendar", e);
  }
  revalidatePath("/calendar");
}

// ---------- идеи ----------

export async function addIdea(f: FormData) {
  const user = await requireUser();
  const text = str(f, "text").trim();
  if (!text) return;
  const idea = await db.idea.create({ data: { text, categoryId: str(f, "categoryId") || null } });
  await logActivity({ actorType: "user", actorUserId: user.id, action: "idea.created", entityType: "idea", entityId: idea.id });
  revalidatePath("/ideas");
}

export async function ideaToPost(f: FormData) {
  const user = await requireUser();
  const idea = await db.idea.findUniqueOrThrow({ where: { id: str(f, "id") } });
  const post = await createPost({ body: idea.text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"), categoryId: idea.categoryId, materialIds: idea.originMaterialId ? [idea.originMaterialId] : [], actorUserId: user.id });
  await db.idea.update({ where: { id: idea.id }, data: { status: "in_progress" } });
  redirect(`/posts/${post.id}`);
}

export async function ideaStatus(f: FormData) {
  await requireUser();
  await db.idea.update({ where: { id: str(f, "id") }, data: { status: str(f, "status") } });
  revalidatePath("/ideas");
}

// ---------- настройки ----------

export async function addCategory(f: FormData) {
  const user = await requireUser();
  const name = str(f, "name").trim().toUpperCase();
  if (!name) return;
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `cat-${Date.now()}`;
  await db.category.create({ data: { name, slug, descriptionForAi: str(f, "description"), sortOrder: 100 } });
  await logActivity({ actorType: "user", actorUserId: user.id, action: "category.created", entityType: "category", entityId: slug });
  revalidatePath("/settings");
}

export async function toggleCategory(f: FormData) {
  const user = await requireUser();
  const c = await db.category.update({ where: { id: str(f, "id") }, data: { isActive: str(f, "active") === "true" } });
  await logActivity({ actorType: "user", actorUserId: user.id, action: c.isActive ? "category.shown" : "category.hidden", entityType: "category", entityId: c.id });
  revalidatePath("/settings");
}

export async function toggleChannel(f: FormData) {
  const user = await requireUser();
  if (user.role !== "owner") fail("/settings", new PostError("Только владелец управляет каналами"));
  const ch = await db.channel.findUniqueOrThrow({ where: { id: str(f, "id") } });
  const enable = str(f, "enable") === "true";
  if (enable && ch.kind === "main" && str(f, "confirm") !== "ВКЛЮЧИТЬ") fail("/settings", new PostError("Чтобы включить основной канал, введите ВКЛЮЧИТЬ"));
  await db.channel.update({ where: { id: ch.id }, data: { isPublishEnabled: enable } });
  await logActivity({ actorType: "user", actorUserId: user.id, action: enable ? "channel.publish_enabled" : "channel.publish_disabled", entityType: "channel", entityId: ch.id, severity: ch.kind === "main" ? "critical" : "info" });
  revalidatePath("/settings");
}

export async function logout() {
  const jar = await cookies();
  const t = jar.get(SESSION_COOKIE)?.value;
  if (t) await revokeSession(t);
  jar.delete(SESSION_COOKIE);
  redirect("/login");
}
