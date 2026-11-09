import { mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { logActivity } from "@/core/activity/log";

const KEEP = 14;

/** Онлайн-бэкап SQLite (VACUUM INTO) в BACKUP_DIR, хранятся последние 14 копий. Папку storage копируйте отдельно. */
export async function runBackup() {
  const dir = path.resolve(process.env.BACKUP_DIR ?? "./backups");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `wtw-${new Date().toISOString().replace(/[:.]/g, "-")}.db`);
  await db.$executeRawUnsafe(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const files = (await readdir(dir)).filter((f) => f.startsWith("wtw-") && f.endsWith(".db")).sort();
  for (const old of files.slice(0, Math.max(0, files.length - KEEP))) await rm(path.join(dir, old));
  await logActivity({ actorType: "system", action: "backup.created", entityType: "backup", entityId: path.basename(file) });
  logger.info({ file: path.basename(file) }, "backup_created");
  return file;
}
