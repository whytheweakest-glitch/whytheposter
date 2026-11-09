/** Импорт канала-образца: npm run import:reference -- путь/к/result.json */
import { readFile } from "node:fs/promises";
import { importReferenceExport } from "../src/core/reference/import";
import { db } from "../src/lib/db";

const file = process.argv[2];
if (!file) {
  console.error("Укажите путь к result.json из экспорта Telegram Desktop");
  process.exit(1);
}
readFile(file, "utf8")
  .then((s) => importReferenceExport(JSON.parse(s)))
  .then((r) => console.log(`Канал «${r.channel}»: импортировано ${r.imported}, пропущено ${r.skipped}`))
  .finally(() => db.$disconnect());
