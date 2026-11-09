import { z } from "zod";

/**
 * Проверенное окружение. Секреты читаются только из process.env, никогда из БД или кода.
 * Вызывайте env() лениво, чтобы сборка Next.js не падала без секретов.
 */
const bool = z
  .string()
  .optional()
  .transform((v) => v === "true");

const ids = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => BigInt(s)),
  );

const schema = z.object({
  APP_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET должен быть не короче 32 символов"),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  OWNER_TELEGRAM_IDS: ids,
  TEST_CHANNEL_ID: z.string().optional(),
  MAIN_CHANNEL_ID: z.string().optional(),
  PUBLISH_TARGET: z.enum(["test", "main"]).default("test"),
  MAIN_CHANNEL_PUBLISH_CONFIRMED: bool,
  AI_PROVIDER: z.enum(["ollama", "disabled"]).default("ollama"),
  OLLAMA_URL: z.string().url().default("http://127.0.0.1:11434"),
  AI_MODEL: z.string().default("qwen2.5:7b-instruct"),
  AI_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  STORAGE_DIR: z.string().default("./storage"),
  BACKUP_DIR: z.string().default("./backups"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal", "silent"]).default("info"),
});

export type Env = z.infer<typeof schema>;
let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Неверная конфигурация окружения: ${issues}`);
  }
  cached = parsed.data;
  return cached;
}

export function resetEnvCache() {
  cached = null;
}
