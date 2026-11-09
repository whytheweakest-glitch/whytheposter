/** Telegram-бот (long polling, публичный адрес не нужен): `npm run bot`. */
import { initDb, db } from "../src/lib/db";
import { env } from "../src/lib/env";
import { errorMessage, logger } from "../src/lib/logger";
import { buildBot } from "../src/bot/bot";
import { ensureOwners } from "../src/core/auth/users";

async function main() {
  const e = env();
  if (!e.TELEGRAM_BOT_TOKEN) throw new Error("Задайте TELEGRAM_BOT_TOKEN в .env");
  if (!e.OWNER_TELEGRAM_IDS.length) throw new Error("Задайте OWNER_TELEGRAM_IDS в .env, иначе бот никого не пустит");
  await initDb();
  await ensureOwners(e.OWNER_TELEGRAM_IDS);
  const bot = buildBot(e.TELEGRAM_BOT_TOKEN);
  await bot.api.setMyCommands([
    { command: "inbox", description: "Последние входящие" },
    { command: "drafts", description: "Черновики" },
    { command: "queue", description: "Очередь публикаций" },
    { command: "idea", description: "Сохранить идею" },
    { command: "login", description: "Вход в Dashboard" },
    { command: "help", description: "Справка" },
  ]);
  const stop = async () => { await bot.stop(); await db.$disconnect(); };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  logger.info("bot started");
  await bot.start({ allowed_updates: ["message", "callback_query"], drop_pending_updates: false });
}

main().catch((err) => { logger.fatal({ err: errorMessage(err) }, "bot_crashed"); process.exit(1); });
