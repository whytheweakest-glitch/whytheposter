import pino from "pino";

const redactPaths = [
  "token", "*.token", "secret", "*.secret", "password", "*.password",
  "authorization", "*.authorization", "headers.cookie", "headers.authorization",
  "botToken", "*.botToken",
];

/** Убирает токен бота из любых строк (URL вида https://api.telegram.org/bot<token>/...). */
export function scrubSecrets(s: string): string {
  return s
    .replace(/bot\d{5,}:[A-Za-z0-9_-]{20,}/g, "bot[redacted]")
    .replace(/\b\d{5,}:[A-Za-z0-9_-]{30,}\b/g, "[redacted]");
}

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: { paths: redactPaths, censor: "[redacted]" },
  base: { service: process.env.SERVICE_NAME ?? "wtw-os" },
  timestamp: pino.stdTimeFunctions.isoTime,
  hooks: {
    logMethod(args, method) {
      method.apply(this, args.map((a) => (typeof a === "string" ? scrubSecrets(a) : a)) as Parameters<typeof method>);
    },
  },
});

export function errorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return scrubSecrets(msg).slice(0, 2000);
}
