import { defineConfig, devices } from "@playwright/test";
import { E2E_ENV } from "./tests/e2e/env";

// Перед запуском: npm run build. Команда: npm run test:e2e
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  workers: 1,
  globalSetup: "./tests/e2e/global-setup.ts",
  use: { baseURL: E2E_ENV.APP_URL, trace: "off" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: [
    { command: "node tests/e2e/fake-telegram.mjs tests/e2e/telegram.log 4555", port: 4555, reuseExistingServer: false },
    { command: "node node_modules/next/dist/bin/next start -p 3100", port: 3100, env: E2E_ENV, reuseExistingServer: false, gracefulShutdown: { signal: "SIGTERM", timeout: 5000 } },
  ],
});
