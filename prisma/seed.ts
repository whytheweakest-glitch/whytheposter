import { db } from "../src/lib/db";
import { DEFAULT_CATEGORIES } from "../src/core/categories/defaults";
import { ensureOwners } from "../src/core/auth/users";
import { syncChannelsFromEnv } from "../src/core/telegram/channels";

/** Только структура: категории, владельцы, каналы из .env. Никаких демонстрационных данных. */
async function main() {
  for (const [i, c] of DEFAULT_CATEGORIES.entries()) {
    await db.category.upsert({ where: { slug: c.slug }, update: {}, create: { ...c, sortOrder: i } });
  }
  const ids = (process.env.OWNER_TELEGRAM_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean).map(BigInt);
  await ensureOwners(ids);
  await syncChannelsFromEnv();
  console.log(`Категорий: ${DEFAULT_CATEGORIES.length}, владельцев: ${ids.length}`);
}

main().finally(() => db.$disconnect());
