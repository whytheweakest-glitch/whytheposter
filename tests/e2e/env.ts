// Окружение сквозных тестов: отдельная БД, поддельный Telegram, AI выключен. Реальный Telegram не используется.
export const E2E_ENV = {
  DATABASE_URL: "file:./e2e.db?connection_limit=1",
  SESSION_SECRET: "e2e-secret-e2e-secret-e2e-secret-1234",
  OWNER_TELEGRAM_IDS: "111",
  TEST_CHANNEL_ID: "-1001",
  TELEGRAM_BOT_TOKEN: "123456:FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE12",
  TELEGRAM_API_URL: "http://127.0.0.1:4555",
  AI_PROVIDER: "disabled",
  APP_URL: "http://localhost:3100",
  STORAGE_DIR: "./.e2e-storage",
  BACKUP_DIR: "./.e2e-backups",
  LOG_LEVEL: "warn",
};
