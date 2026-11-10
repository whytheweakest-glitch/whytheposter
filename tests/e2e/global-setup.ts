import { spawn } from "node:child_process";
import path from "node:path";
import { E2E_ENV } from "./env";

/** Worker не слушает порт, поэтому запускается здесь, а не через webServer. */
export default async function globalSetup() {
  const tsxCli = path.resolve("node_modules/tsx/dist/cli.mjs");
  const worker = spawn(process.execPath, [tsxCli, "scripts/worker.ts"], { env: { ...process.env, ...E2E_ENV }, stdio: ["ignore", "ignore", "inherit"] });
  return async () => {
    worker.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 500));
    if (worker.exitCode === null) worker.kill("SIGKILL");
  };
}
