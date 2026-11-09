/**
 * Фоновый процесс: `npm run worker`.
 *  - задачи из очереди (скачивание файлов, AI, уведомления);
 *  - публикация подтверждённых постов (только approved/scheduled с действующим подтверждением);
 *  - восстановление после сбоев, ежедневный бэкап.
 */
import { db, initDb } from "../src/lib/db";
import { env } from "../src/lib/env";
import { errorMessage, logger } from "../src/lib/logger";
import { runDueJobs } from "../src/core/jobs/queue";
import { publishPost, duePostIds, recoverStalePublishing } from "../src/core/publishing/publisher";
import { BotApi } from "../src/core/telegram/api";
import { buildHandlers, notifyApprovers } from "../src/worker/handlers";
import { ensureOwners } from "../src/core/auth/users";
import { syncChannelsFromEnv } from "../src/core/telegram/channels";
import { runBackup } from "../src/core/backup";

const e = env();
const api = e.TELEGRAM_BOT_TOKEN ? new BotApi(e.TELEGRAM_BOT_TOKEN) : null;
const handlers = buildHandlers(e.TELEGRAM_BOT_TOKEN);
let pausedUntil = 0;

async function publishDue() {
  if (!api || Date.now() < pausedUntil) return;
  for (const id of await duePostIds()) {
    const r = await publishPost(id, api);
    if (r.result === "published") await notifyApprovers("Пост опубликован.");
    if (r.result === "failed") await notifyApprovers(`Telegram отклонил публикацию: ${r.error}`);
    if (r.result === "unknown") await notifyApprovers("Связь оборвалась во время публикации. Проверьте канал и отметьте в Dashboard, вышел ли пост. Повторно система его не отправит.");
    if (r.result === "rate_limited") {
      pausedUntil = Date.now() + r.retryAfterSec * 1000;
      return;
    }
  }
}

type Task = { name: string; everySec: number; run: () => Promise<unknown> };
const TASKS: Task[] = [
  { name: "jobs", everySec: 3, run: () => runDueJobs(handlers, 5) },
  { name: "publish", everySec: 15, run: publishDue },
  { name: "recover", everySec: 60, run: async () => {
      const ids = await recoverStalePublishing();
      if (ids.length) await notifyApprovers("Публикация прервалась при перезапуске. Проверьте канал и отметьте результат в Dashboard.");
    } },
  { name: "heartbeat", everySec: 30, run: () => db.setting.upsert({ where: { key: "worker.heartbeat" }, update: { value: JSON.stringify(new Date().toISOString()) }, create: { key: "worker.heartbeat", value: JSON.stringify(new Date().toISOString()) } }) },
  { name: "backup", everySec: 24 * 3600, run: runBackup },
];

let stopping = false;
const last = new Map<string, number>();

async function main() {
  await initDb();
  await ensureOwners(e.OWNER_TELEGRAM_IDS);
  await syncChannelsFromEnv();
  if (!api) logger.warn("TELEGRAM_BOT_TOKEN не задан: публикация и скачивание файлов отключены");
  logger.info("worker started");
  while (!stopping) {
    for (const t of TASKS) {
      if (stopping) break;
      if (Date.now() - (last.get(t.name) ?? 0) < t.everySec * 1000) continue;
      last.set(t.name, Date.now());
      try {
        await t.run();
      } catch (err) {
        logger.error({ task: t.name, err: errorMessage(err) }, "worker_task_failed");
      }
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  await db.$disconnect();
}

for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => { stopping = true; });
main().catch((err) => { logger.fatal({ err: errorMessage(err) }, "worker_crashed"); process.exit(1); });
