import { PrismaClient } from "@prisma/client";

const g = globalThis as unknown as { __db?: PrismaClient };
// SQLite: один писатель. Транзакции ждут друг друга, а не падают сразу.
export const db = g.__db ?? new PrismaClient({ transactionOptions: { maxWait: 15_000, timeout: 20_000 } });
if (process.env.NODE_ENV !== "production") g.__db = db;

let pragmasApplied = false;
/** WAL и ожидание блокировки: бот, worker и Dashboard пишут в один файл SQLite. */
export async function initDb() {
  if (pragmasApplied) return;
  pragmasApplied = true;
  await db.$queryRawUnsafe("PRAGMA journal_mode = WAL;");
  await db.$queryRawUnsafe("PRAGMA busy_timeout = 5000;");
}

export type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];
