import { db, type Tx } from "@/lib/db";
import { sha256 } from "@/lib/crypto";
import { logActivity } from "@/core/activity/log";
import { checkPost } from "@/core/publishing/telegram-html";
import { enqueueJob } from "@/core/jobs/queue";
import { assertTransition, EDITABLE, type PostStatus } from "./states";

export class PostError extends Error {}

type PostContent = { body: string; format: string; channelId: string | null; attachmentKeys: string[] };

/** Хеш всего, что уходит в канал. Подтверждение действует только для этого хеша. */
export function computeContentHash(c: PostContent) {
  return sha256(JSON.stringify([c.body, c.format, c.channelId ?? "", c.attachmentKeys]));
}

async function contentOf(tx: Tx, postId: string): Promise<PostContent> {
  const p = await tx.post.findUniqueOrThrow({ where: { id: postId }, include: { attachments: { where: { deletedAt: null }, orderBy: { sortOrder: "asc" } } } });
  return { body: p.body, format: p.format, channelId: p.channelId, attachmentKeys: p.attachments.map((a) => a.sha256 ?? a.id) };
}

/**
 * Действующее подтверждение: последнее approve, после которого не было reject/revoke,
 * и хеш которого совпадает с текущим содержимым.
 */
export async function getValidApproval(postId: string, tx: Tx | typeof db = db) {
  const post = await tx.post.findUniqueOrThrow({ where: { id: postId } });
  const last = await tx.approval.findFirst({
    where: { postId, action: { in: ["approve", "reject", "revoke"] } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: { user: true },
  });
  if (!last || last.action !== "approve") return null;
  if (last.contentHash !== post.contentHash) return null;
  if (!last.user.isActive || !last.user.canApprove) return null;
  return last;
}

export async function defaultChannelId(tx: Tx | typeof db = db) {
  const kind = process.env.PUBLISH_TARGET === "main" ? "main" : "test";
  const ch = await tx.channel.findFirst({ where: { kind } });
  return ch?.id ?? null;
}

/** Создаёт пост из материалов. Текст пишет автор или AI; публикации здесь нет. */
export async function createPost(input: { materialIds?: string[]; body?: string; categoryId?: string | null; actorUserId: string | null; actorType?: "user" | "ai" | "bot" }) {
  return db.$transaction(async (tx) => {
    const materials = input.materialIds?.length ? await tx.material.findMany({ where: { id: { in: input.materialIds } } }) : [];
    const body = input.body ?? "";
    const categoryId = input.categoryId ?? materials.find((m) => m.categoryId)?.categoryId ?? null;
    const channelId = await defaultChannelId(tx);
    const post = await tx.post.create({
      data: {
        status: "draft",
        body,
        categoryId,
        channelId,
        postMaterials: { create: materials.map((m) => ({ materialId: m.id })) },
      },
    });
    const hash = computeContentHash(await contentOf(tx, post.id));
    await tx.post.update({ where: { id: post.id }, data: { contentHash: hash } });
    await tx.draft.create({ data: { postId: post.id, version: 1, body, origin: input.actorType === "ai" ? "ai" : "user" } });
    await logActivity({ actorType: input.actorType ?? "user", actorUserId: input.actorUserId, action: "post.created", entityType: "post", entityId: post.id, data: { materials: materials.map((m) => m.id) } }, tx);
    return post;
  });
}

/**
 * Сохраняет текст (автосохранение тоже идёт сюда). Если пост был подтверждён и содержимое
 * изменилось, подтверждение отзывается и пост возвращается на проверку.
 */
export async function updatePostContent(postId: string, patch: { body?: string; format?: "text" | "photo"; categoryId?: string | null; channelId?: string | null }, actor: { userId: string | null; type?: "user" | "ai"; autosave?: boolean }) {
  return db.$transaction(async (tx) => {
    const post = await tx.post.findUniqueOrThrow({ where: { id: postId } });
    if (!EDITABLE.includes(post.status as PostStatus)) throw new PostError(`Публикацию в статусе «${post.status}» нельзя редактировать`);
    await tx.post.update({
      where: { id: postId },
      data: {
        ...(patch.body !== undefined ? { body: patch.body } : {}),
        ...(patch.format ? { format: patch.format } : {}),
        ...(patch.categoryId !== undefined ? { categoryId: patch.categoryId } : {}),
        ...(patch.channelId !== undefined ? { channelId: patch.channelId } : {}),
      },
    });
    const newHash = computeContentHash(await contentOf(tx, postId));
    const changed = newHash !== post.contentHash;
    let status = post.status as PostStatus;
    if (changed && (status === "approved" || status === "scheduled")) {
      await tx.approval.create({ data: { postId, action: "revoke", userId: actor.userId ?? (await systemUserId(tx)), via: "dashboard", contentHash: post.contentHash } });
      status = "review";
      await logActivity({ actorType: "system", action: "post.approval_revoked_by_edit", entityType: "post", entityId: postId, severity: "warning" }, tx);
    }
    const updated = await tx.post.update({ where: { id: postId }, data: { contentHash: newHash, status } });
    if (patch.body !== undefined && changed) {
      const last = await tx.draft.findFirst({ where: { postId }, orderBy: { version: "desc" } });
      await tx.draft.create({ data: { postId, version: (last?.version ?? 0) + 1, body: patch.body, origin: actor.autosave ? "autosave" : actor.type === "ai" ? "ai" : "user" } });
    }
    return { post: updated, approvalRevoked: status !== post.status };
  });
}

async function systemUserId(tx: Tx) {
  const owner = await tx.user.findFirst({ where: { role: "owner" }, orderBy: { createdAt: "asc" } });
  if (!owner) throw new PostError("Нет владельца в базе");
  return owner.id;
}

async function transition(tx: Tx, postId: string, to: PostStatus, data: Record<string, unknown> = {}) {
  const post = await tx.post.findUniqueOrThrow({ where: { id: postId } });
  assertTransition(post.status, to);
  // условный UPDATE: если статус успели поменять параллельно, ничего не произойдёт
  const res = await tx.post.updateMany({ where: { id: postId, status: post.status }, data: { status: to, ...data } });
  if (res.count !== 1) throw new PostError("Статус публикации изменился, обновите страницу");
  return post;
}

export async function submitForReview(postId: string, actorUserId: string) {
  return db.$transaction(async (tx) => {
    await transition(tx, postId, "review");
    await logActivity({ actorType: "user", actorUserId, action: "post.submitted_for_review", entityType: "post", entityId: postId }, tx);
    await enqueueJob({ kind: "notify_review", payload: { postId }, dedupKey: `notify_review:${postId}`, maxAttempts: 3 }, tx);
  });
}

async function assertApprover(tx: Tx, userId: string) {
  const user = await tx.user.findUnique({ where: { id: userId } });
  if (!user || !user.isActive || !user.canApprove) throw new PostError("У этого пользователя нет права подтверждать публикации");
  return user;
}

/**
 * Явное подтверждение публикации. Единственный путь к approved/scheduled.
 * scheduledFor в будущем → scheduled, иначе approved (worker опубликует сразу).
 */
export async function approvePost(postId: string, input: { userId: string; via: "dashboard" | "bot"; scheduledFor?: Date | null; expectedContentHash?: string }) {
  return db.$transaction(async (tx) => {
    await assertApprover(tx, input.userId);
    const post = await tx.post.findUniqueOrThrow({ where: { id: postId }, include: { postMaterials: { include: { material: true } } } });
    if (input.expectedContentHash && input.expectedContentHash !== post.contentHash) {
      throw new PostError("Текст изменился после открытия предпросмотра. Проверьте его ещё раз");
    }
    if (!post.channelId) throw new PostError("Не выбран канал для публикации");
    const channel = await tx.channel.findUniqueOrThrow({ where: { id: post.channelId } });
    if (!channel.isPublishEnabled) throw new PostError(`Публикация в канал «${channel.title}» выключена в настройках`);
    const errors = checkPost(post.body, post.format as "text" | "photo").filter((c) => c.level === "error");
    if (errors.length) throw new PostError(errors.map((e) => e.message).join("; "));
    const scheduled = input.scheduledFor && input.scheduledFor.getTime() > Date.now() ? input.scheduledFor : null;
    const to: PostStatus = scheduled ? "scheduled" : "approved";
    await transition(tx, postId, to, { scheduledAt: scheduled, lastError: null });
    const approval = await tx.approval.create({ data: { postId, action: "approve", userId: input.userId, via: input.via, contentHash: post.contentHash, scheduledFor: scheduled } });
    await logActivity({ actorType: "user", actorUserId: input.userId, action: scheduled ? "post.approved_scheduled" : "post.approved", entityType: "post", entityId: postId, data: { via: input.via, scheduledFor: scheduled?.toISOString() } }, tx);
    return approval;
  });
}

export async function rejectPost(postId: string, input: { userId: string; via: "dashboard" | "bot" }) {
  return db.$transaction(async (tx) => {
    const post = await transition(tx, postId, "rejected", { scheduledAt: null });
    await tx.approval.create({ data: { postId, action: "reject", userId: input.userId, via: input.via, contentHash: post.contentHash } });
    await logActivity({ actorType: "user", actorUserId: input.userId, action: "post.rejected", entityType: "post", entityId: postId, data: { via: input.via } }, tx);
  });
}

/** Перенос даты. Подтверждение сохраняется (содержимое то же), но не создаётся: без него переноса нет. */
export async function reschedulePost(postId: string, when: Date | null, actorUserId: string) {
  return db.$transaction(async (tx) => {
    const post = await tx.post.findUniqueOrThrow({ where: { id: postId } });
    if (post.status === "approved" || post.status === "scheduled") {
      if (!(await getValidApproval(postId, tx))) throw new PostError("Подтверждение недействительно, подтвердите пост заново");
      const to: PostStatus = when && when.getTime() > Date.now() ? "scheduled" : "approved";
      if (to !== post.status) await transition(tx, postId, to, { scheduledAt: to === "scheduled" ? when : null });
      else await tx.post.update({ where: { id: postId }, data: { scheduledAt: to === "scheduled" ? when : null } });
    } else if (EDITABLE.includes(post.status as PostStatus)) {
      // для неподтверждённого поста это только желаемая дата, публикации не будет
      await tx.post.update({ where: { id: postId }, data: { scheduledAt: when } });
    } else {
      throw new PostError("Дату этой публикации менять нельзя");
    }
    await logActivity({ actorType: "user", actorUserId, action: "post.rescheduled", entityType: "post", entityId: postId, data: { from: post.scheduledAt?.toISOString() ?? null, to: when?.toISOString() ?? null } }, tx);
  });
}

export async function archivePost(postId: string, actorUserId: string) {
  return db.$transaction(async (tx) => {
    await transition(tx, postId, "archived");
    await logActivity({ actorType: "user", actorUserId, action: "post.archived", entityType: "post", entityId: postId }, tx);
  });
}

export async function returnToDraft(postId: string, actorUserId: string) {
  return db.$transaction(async (tx) => {
    await transition(tx, postId, "draft", { scheduledAt: null });
    await logActivity({ actorType: "user", actorUserId, action: "post.returned_to_draft", entityType: "post", entityId: postId }, tx);
  });
}

/**
 * Разбор publish_unknown. «Вышел» → published со ссылкой; «не вышел» → снова review,
 * то есть повторная отправка требует нового подтверждения.
 */
export async function resolveUnknown(postId: string, input: { userId: string; outcome: "published" | "not_published"; publishedUrl?: string | null }) {
  return db.$transaction(async (tx) => {
    await assertApprover(tx, input.userId);
    const post = await tx.post.findUniqueOrThrow({ where: { id: postId } });
    if (post.status !== "publish_unknown") throw new PostError("Публикация не в статусе «результат неизвестен»");
    if (input.outcome === "published") {
      await transition(tx, postId, "published", { publishedAt: new Date(), publishedUrl: input.publishedUrl ?? null, publishAttemptId: null });
      await tx.approval.create({ data: { postId, action: "resolve_published", userId: input.userId, via: "dashboard", contentHash: post.contentHash } });
    } else {
      await transition(tx, postId, "review", { publishAttemptId: null, scheduledAt: null });
      await tx.approval.create({ data: { postId, action: "revoke", userId: input.userId, via: "dashboard", contentHash: post.contentHash } });
    }
    await logActivity({ actorType: "user", actorUserId: input.userId, action: `post.unknown_resolved_${input.outcome}`, entityType: "post", entityId: postId }, tx);
  });
}
