import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { errorMessage, logger } from "@/lib/logger";
import { logActivity } from "@/core/activity/log";
import { getValidApproval } from "@/core/posts/service";
import { readStoredFile, stripJpegMetadata } from "@/core/storage/files";
import { TelegramApiError, TelegramNetworkError, type TelegramPublisherApi, type SentMessage } from "@/core/telegram/api";

export type PublishOutcome =
  | { result: "published"; messageIds: number[] }
  | { result: "skipped"; reason: string }
  | { result: "rate_limited"; retryAfterSec: number }
  | { result: "failed"; error: string }
  | { result: "unknown"; error: string };

const LEASE_MS = 2 * 60_000;

/** Проверка, что публиковать в этот канал разрешено именно сейчас (тестовый или явно разрешённый основной). */
export function assertChannelAllowed(channel: { kind: string; isPublishEnabled: boolean; title: string }) {
  if (!channel.isPublishEnabled) throw new Error(`Публикация в «${channel.title}» выключена`);
  if (channel.kind === "main" && process.env.MAIN_CHANNEL_PUBLISH_CONFIRMED !== "true") {
    throw new Error("Публикация в основной канал не разрешена (MAIN_CHANNEL_PUBLISH_CONFIRMED)");
  }
}

function postUrl(sent: SentMessage) {
  if (sent.chat.username) return `https://t.me/${sent.chat.username}/${sent.message_id}`;
  const internal = String(sent.chat.id).replace(/^-100/, "");
  return `https://t.me/c/${internal}/${sent.message_id}`;
}

/**
 * Публикует один пост. Гарантии:
 *  1. Без действующего подтверждения (хеш содержимого совпадает) отправки нет.
 *  2. Пост захватывается условным UPDATE: два исполнителя не отправят его дважды.
 *  3. Обрыв связи → publish_unknown, автоматического повтора нет.
 *  4. 429 от Telegram означает «не отправлено» → пост возвращается в прежний статус для повтора.
 */
export async function publishPost(postId: string, api: TelegramPublisherApi, now = new Date()): Promise<PublishOutcome> {
  const post = await db.post.findUnique({ where: { id: postId }, include: { channel: true, attachments: { where: { deletedAt: null }, orderBy: { sortOrder: "asc" } } } });
  if (!post) return { result: "skipped", reason: "not_found" };
  if (post.status !== "approved" && !(post.status === "scheduled" && post.scheduledAt && post.scheduledAt <= now)) {
    return { result: "skipped", reason: `status_${post.status}` };
  }
  const approval = await getValidApproval(postId);
  if (!approval) {
    await db.$transaction(async (tx) => {
      await tx.post.updateMany({ where: { id: postId, status: post.status }, data: { status: "review", lastError: "Подтверждение недействительно: содержимое изменилось или право отозвано" } });
      await logActivity({ actorType: "system", action: "post.publish_blocked_no_approval", entityType: "post", entityId: postId, severity: "warning" }, tx);
    });
    return { result: "skipped", reason: "no_valid_approval" };
  }
  if (!post.channel) return { result: "failed", error: "Не выбран канал" };
  try {
    assertChannelAllowed(post.channel);
  } catch (e) {
    await db.post.update({ where: { id: postId }, data: { lastError: errorMessage(e) } });
    return { result: "skipped", reason: errorMessage(e) };
  }

  const attemptId = randomUUID();
  const claimed = await db.post.updateMany({
    where: { id: postId, status: post.status, publishAttemptId: null },
    data: { status: "publishing", publishAttemptId: attemptId, publishLeaseUntil: new Date(now.getTime() + LEASE_MS) },
  });
  if (claimed.count !== 1) return { result: "skipped", reason: "already_claimed" };
  const attempt = await db.publishAttempt.create({ data: { postId, approvalId: approval.id } });
  await logActivity({ actorType: "system", action: "post.publishing", entityType: "post", entityId: postId, data: { attemptId: attempt.id } });

  const chatId = post.channel.telegramChatId.toString();
  try {
    let sent: SentMessage;
    const photo = post.format === "photo" ? post.attachments.find((a) => a.kind === "image" && a.storageKey) : null;
    if (post.format === "photo") {
      if (!photo) throw new TelegramApiError(400, "У поста-фото нет скачанного изображения");
      const raw = await readStoredFile(photo.storageKey!);
      sent = await api.sendPhoto(chatId, { data: stripJpegMetadata(raw), fileName: photo.fileName ?? "image.jpg" }, post.body);
    } else {
      sent = await api.sendMessage(chatId, post.body);
    }
    const messageIds = [sent.message_id];
    await db.$transaction(async (tx) => {
      await tx.post.update({
        where: { id: postId },
        data: { status: "published", publishedAt: new Date(), publishedUrl: postUrl(sent), telegramMessageIds: JSON.stringify(messageIds), publishLeaseUntil: null, lastError: null },
      });
      await tx.publishAttempt.update({ where: { id: attempt.id }, data: { finishedAt: new Date(), outcome: "sent", messageIds: JSON.stringify(messageIds) } });
      await tx.postMaterial.findMany({ where: { postId } }).then((pm) =>
        pm.length ? tx.material.updateMany({ where: { id: { in: pm.map((x) => x.materialId) }, status: { not: "deleted" } }, data: { status: "archived" } }) : null,
      );
      await logActivity({ actorType: "system", action: "post.published", entityType: "post", entityId: postId, data: { messageIds } }, tx);
    });
    return { result: "published", messageIds };
  } catch (e) {
    if (e instanceof TelegramApiError && e.code === 429) {
      // Telegram явно не отправил сообщение: возвращаем пост в прежний статус, повтор позже
      await db.$transaction(async (tx) => {
        await tx.post.update({ where: { id: postId }, data: { status: post.status, publishAttemptId: null, publishLeaseUntil: null, lastError: `Лимит Telegram, повтор через ${e.retryAfter ?? 30} с` } });
        await tx.publishAttempt.update({ where: { id: attempt.id }, data: { finishedAt: new Date(), outcome: "rate_limited", telegramErrorCode: 429 } });
      });
      return { result: "rate_limited", retryAfterSec: e.retryAfter ?? 30 };
    }
    if (e instanceof TelegramApiError) {
      await db.$transaction(async (tx) => {
        await tx.post.update({ where: { id: postId }, data: { status: "failed", publishAttemptId: null, publishLeaseUntil: null, lastError: errorMessage(e) } });
        await tx.publishAttempt.update({ where: { id: attempt.id }, data: { finishedAt: new Date(), outcome: "rejected_by_telegram", telegramErrorCode: e.code, errorText: errorMessage(e) } });
        await logActivity({ actorType: "system", action: "post.publish_failed", entityType: "post", entityId: postId, data: { code: e.code }, severity: "warning" }, tx);
      });
      return { result: "failed", error: errorMessage(e) };
    }
    // сеть, таймаут или неизвестная ошибка после начала отправки: результат неизвестен
    const msg = e instanceof TelegramNetworkError ? errorMessage(e) : `Непредвиденная ошибка: ${errorMessage(e)}`;
    await db.$transaction(async (tx) => {
      await tx.post.update({ where: { id: postId }, data: { status: "publish_unknown", publishLeaseUntil: null, lastError: msg } });
      await tx.publishAttempt.update({ where: { id: attempt.id }, data: { finishedAt: new Date(), outcome: "unknown", errorText: msg } });
      await logActivity({ actorType: "system", action: "post.publish_unknown", entityType: "post", entityId: postId, severity: "critical" }, tx);
    });
    logger.error({ postId }, "publish_unknown");
    return { result: "unknown", error: msg };
  }
}

/** Посты, зависшие в publishing (процесс упал во время отправки), уходят в publish_unknown, а не в повтор. */
export async function recoverStalePublishing(now = new Date()) {
  const stale = await db.post.findMany({ where: { status: "publishing", publishLeaseUntil: { lt: now } } });
  for (const p of stale) {
    const r = await db.post.updateMany({ where: { id: p.id, status: "publishing" }, data: { status: "publish_unknown", lastError: "Процесс прервался во время отправки" } });
    if (r.count) await logActivity({ actorType: "system", action: "post.publish_unknown", entityType: "post", entityId: p.id, severity: "critical", data: { reason: "stale_lease" } });
  }
  return stale.map((p) => p.id);
}

/** Посты, которые пора отправлять: подтверждённые и запланированные с наступившим временем. */
export async function duePostIds(now = new Date()) {
  const posts = await db.post.findMany({
    where: { OR: [{ status: "approved" }, { status: "scheduled", scheduledAt: { lte: now } }] },
    select: { id: true },
    orderBy: { updatedAt: "asc" },
    take: 10,
  });
  return posts.map((p) => p.id);
}
