import { runBackup } from "../src/core/backup";
import { db } from "../src/lib/db";
runBackup().then((f) => console.log(`Бэкап: ${f}`)).finally(() => db.$disconnect());
