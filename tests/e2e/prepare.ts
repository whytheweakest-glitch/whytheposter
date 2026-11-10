// Готовит чистую БД для e2e: миграции + сид. Запускается перед playwright.
import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import { E2E_ENV } from "./env";

for (const f of ["prisma/e2e.db", "prisma/e2e.db-wal", "prisma/e2e.db-shm", "prisma/e2e.db-journal", "tests/e2e/telegram.log"]) rmSync(f, { force: true });
const env = { ...process.env, ...E2E_ENV };
execSync("npx prisma migrate deploy", { env, stdio: "inherit" });
execSync("npx tsx prisma/seed.ts", { env, stdio: "inherit" });
