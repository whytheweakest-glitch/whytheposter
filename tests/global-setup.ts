import { execSync } from "node:child_process";
import { rmSync } from "node:fs";

export default function setup() {
  for (const f of ["prisma/test.db", "prisma/test.db-journal", "prisma/test.db-wal", "prisma/test.db-shm"]) rmSync(f, { force: true });
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: "file:./test.db" }, stdio: "pipe" });
}
