/**
 * Запуск всей системы одной командой: `npm run os`.
 * Поднимает Dashboard, бота и worker, перезапускает упавший процесс с паузой,
 * по Ctrl+C останавливает всё. Работает на Windows и Linux.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";

const isWin = process.platform === "win32";
const npm = isWin ? "npm.cmd" : "npm";

if (!existsSync(".next/BUILD_ID")) {
  console.error("Сначала соберите Dashboard: npm run build");
  process.exit(1);
}

type Proc = { name: string; args: string[]; color: string; child?: ChildProcess; restarts: number; enabled: boolean };
const procs: Proc[] = [
  { name: "web", args: ["run", "start"], color: "\x1b[36m", restarts: 0, enabled: true },
  { name: "bot", args: ["run", "bot"], color: "\x1b[35m", restarts: 0, enabled: !!process.env.TELEGRAM_BOT_TOKEN },
  { name: "worker", args: ["run", "worker"], color: "\x1b[33m", restarts: 0, enabled: true },
];
let stopping = false;

function prefix(p: Proc, chunk: Buffer) {
  for (const line of chunk.toString().split(/\r?\n/)) if (line.trim()) process.stdout.write(`${p.color}[${p.name}]\x1b[0m ${line}\n`);
}

function start(p: Proc) {
  const child = spawn(npm, p.args, { stdio: ["ignore", "pipe", "pipe"], shell: isWin, env: process.env });
  p.child = child;
  child.stdout?.on("data", (c) => prefix(p, c));
  child.stderr?.on("data", (c) => prefix(p, c));
  child.on("exit", (code) => {
    if (stopping) return;
    p.restarts++;
    const delay = Math.min(60, 2 ** Math.min(p.restarts, 6));
    console.log(`[${p.name}] завершился (код ${code}), перезапуск через ${delay} с`);
    setTimeout(() => !stopping && start(p), delay * 1000);
  });
}

for (const p of procs) if (p.enabled) start(p);
if (!procs[1].enabled) console.log("TELEGRAM_BOT_TOKEN не задан в .env: бот не запущен");
console.log("WHYTHEWEAKEST OS запущена. Dashboard: " + (process.env.APP_URL ?? "http://localhost:3000") + ". Остановка: Ctrl+C");

function stopAll() {
  if (stopping) return;
  stopping = true;
  for (const p of procs) {
    if (!p.child?.pid) continue;
    if (isWin) spawn("taskkill", ["/pid", String(p.child.pid), "/T", "/F"]);
    else p.child.kill("SIGTERM");
  }
  setTimeout(() => process.exit(0), 3000);
}
process.on("SIGINT", stopAll);
process.on("SIGTERM", stopAll);
