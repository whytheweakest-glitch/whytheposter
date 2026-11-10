/**
 * Импорт канала-образца:
 *   npm run import:reference -- https://t.me/whytheweekest   (публичный канал по ссылке)
 *   npm run import:reference -- путь/к/result.json          (экспорт Telegram Desktop)
 */
import { readFile } from "node:fs/promises";
import { importReferenceExport } from "../src/core/reference/import";
import { fetchPublicChannel } from "../src/core/reference/web-preview";
import { db } from "../src/lib/db";

async function main() {
  const src = process.argv[2];
  if (!src) throw new Error("Укажите ссылку на канал (https://t.me/имя) или путь к result.json");
  const isLink = /t\.me\/|^@/.test(src);
  if (isLink) console.log("Читаю публичные посты канала, это займёт пару минут…");
  const data = isLink ? await fetchPublicChannel(src) : JSON.parse(await readFile(src, "utf8"));
  const r = await importReferenceExport(data);
  console.log(`Канал «${r.channel}»: импортировано ${r.imported}, пропущено ${r.skipped} (короткие, пересланные, служебные)`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
