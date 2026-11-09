import { db } from "@/lib/db";

/**
 * Каналы из .env. Тестовый канал включается для публикации сразу, основной всегда создаётся
 * выключенным: включить его может только владелец в настройках (и нужен MAIN_CHANNEL_PUBLISH_CONFIRMED=true).
 */
export async function syncChannelsFromEnv() {
  const test = process.env.TEST_CHANNEL_ID?.trim();
  const main = process.env.MAIN_CHANNEL_ID?.trim();
  if (test) {
    await db.channel.upsert({ where: { telegramChatId: BigInt(test) }, update: { kind: "test" }, create: { telegramChatId: BigInt(test), title: "Тестовый канал", kind: "test", isPublishEnabled: true } });
  }
  if (main) {
    await db.channel.upsert({ where: { telegramChatId: BigInt(main) }, update: { kind: "main" }, create: { telegramChatId: BigInt(main), title: "WHYTHEWEAKEST", kind: "main", isPublishEnabled: false } });
  }
}
