import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    globalSetup: ["tests/global-setup.ts"],
    env: {
      DATABASE_URL: "file:./test.db?connection_limit=1",
      APP_ENV: "test",
      SESSION_SECRET: "test-secret-test-secret-test-secret-123",
      OWNER_TELEGRAM_IDS: "111",
      LOG_LEVEL: "silent",
      STORAGE_DIR: "./.test-storage",
    },
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 15000,
  },
});
