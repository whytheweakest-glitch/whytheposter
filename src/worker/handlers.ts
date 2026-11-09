import path from "node:path";
import { Api } from "grammy";
import { db } from "@/lib/db";
import { errorMessage, logger } from "@/lib/logger";
import { PermanentJobError, enqueueJob, type JobHandler, type JobKind } from "@/core/jobs/queue";
import { classifyMaterial, generateDraftVariants } from "@/core/ai/service";
import { saveFile, sniffMime } from "@/core/storage/files";
import { BotApi, TelegramApiError } from "@/core/telegram/api";
import { sendReviewRequest } from "@/bot/bot";
import { escapeHtml } from "@/core/publishing/telegram-html";

/** Бот может скачать через облачный Bot API файлы до 20 МБ. */
export const TELEGRAM_DOWNLOAD_LIMIT = 20 * 1024 * 1024;

export function buildHandlers(token: string | undefined): Partial<Record<JobKind, JobHandler>> {
  const botApi = token ? new BotApi(token) : null;
  const gApi = token ? new Api(token) : null;

  return {
    async download_attachment(p) {
      const a = await db.attachment.findUnique({ where: { id: String(p.attachmentId) } });
      if (!a || a.storageKey || !a.telegramFileId) return;
      if (!botApi) throw new Error("TELEGRAM_BOT_TOKEN не задан");
      if (a.sizeBytes && a.sizeBytes > TELEGRAM_DOWNLOAD_LIMIT) {
        await db.attachment.update({ where: { id: a.id }, data: { downloadError: "Файл больше 20 МБ: бот не может его скачать. Сохранена ссылка на сообщение" } });
        return;
      }
      // тот же файл уже скачан раньше: переиспользуем
      const same = a.telegramFileUniqueId ? await db.attachment.findFirst({ where: { telegramFileUniqueId: a.telegramFileUniqueId, storageKey: { not: null } } }) : null;
      if (same) {
        await db.attachment.update({ where: { id: a.id }, data: { storageKey: same.storageKey, sha256: same.sha256, mime: same.mime, sizeBytes: same.sizeBytes } });
        return;
      }
      try {
        const info = await botApi.getFile(a.telegramFileId);
        if (!info.file_path) throw new PermanentJobError("Telegram не вернул путь к файлу");
        const data = await botApi.downloadFile(info.file_path);
        const mime = sniffMime(data) ?? a.mime ?? "application/octet-stream";
        const ext = path.extname(a.fileName ?? info.file_path).slice(1);
        const saved = await saveFile(data, ext);
        await db.attachment.update({ where: { id: a.id }, data: { storageKey: saved.key, sha256: saved.sha256, sizeBytes: saved.size, mime, downloadError: null } });
      } catch (e) {
        if (e instanceof TelegramApiError && e.code === 400) {
          await db.attachment.update({ where: { id: a.id }, data: { downloadError: errorMessage(e) } });
          throw new PermanentJobError(errorMessage(e));
        }
        throw e;
      }
    },

    async classify_material(p) {
      await classifyMaterial(String(p.materialId));
    },

    async generate_draft(p) {
      const n = await generateDraftVariants(String(p.postId));
      if (p.notifyUserId) await enqueueJob({ kind: "notify_text", payload: { userId: p.notifyUserId, text: `AI подготовил вариантов: ${n}. Откройте черновик в Dashboard.` } });
    },

    async notify_review(p) {
      if (!gApi) return;
      await sendReviewRequest(gApi, String(p.postId));
    },

    async notify_text(p) {
      if (!gApi) return;
      const users = p.userId
        ? await db.user.findMany({ where: { id: String(p.userId), isActive: true } })
        : await db.user.findMany({ where: { isActive: true, canApprove: true } });
      for (const u of users) await gApi.sendMessage(Number(u.telegramUserId), escapeHtml(String(p.text)), { parse_mode: "HTML" });
    },
  };
}

export async function notifyApprovers(text: string) {
  await enqueueJob({ kind: "notify_text", payload: { text } }).catch((e) => logger.warn({ err: errorMessage(e) }, "notify_enqueue_failed"));
}
