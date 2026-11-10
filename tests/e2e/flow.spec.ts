import { test, expect, devices } from "@playwright/test";
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { E2E_ENV } from "./env";

const tgLog = () => (existsSync("tests/e2e/telegram.log") ? readFileSync("tests/e2e/telegram.log", "utf8") : "");
const loginToken = () => execSync("npx tsx tests/e2e/login-token.ts", { env: { ...process.env, ...E2E_ENV } }).toString().trim().split("\n").pop()!;

test("путь от ссылки до публикации только после подтверждения", async ({ page, browser }) => {
  await page.goto("/inbox");
  await expect(page).toHaveURL(/\/login/);

  const token = loginToken();
  await page.goto(`/login/${token}`);
  await expect(page).toHaveURL(E2E_ENV.APP_URL + "/");
  await page.goto(`/login/${token}`);
  await expect(page).toHaveURL(/error=expired/);

  await page.goto("/inbox");
  await page.fill("input[name=text]", "https://www.are.na/block/123?utm_source=tg посмотреть шрифты");
  await page.click("text=Добавить");
  await expect(page.getByText("are.na/block/123").first()).toBeVisible();
  await page.fill("input[name=text]", "https://are.na/block/123");
  await page.click("text=Добавить");
  await expect(page.getByText("присылали ещё 1 раз")).toBeVisible();
  await expect(page.locator("article.card")).toHaveCount(1);

  await page.click('button:has-text("Создать черновик")');
  await expect(page).toHaveURL(/\/posts\//);
  await page.fill("#body", 'Нашёл на <a href="https://are.na/block/123">Are.na</a> подборку шрифтов. <b>Сохраняю</b>.');
  await expect(page.getByText(/Сохранено в/)).toBeVisible({ timeout: 10_000 });
  await page.reload();
  await expect(page.locator("#body")).toHaveValue(/Are\.na/);
  await expect(page.locator(".tg-bubble b")).toHaveText("Сохраняю");

  await page.click('button:has-text("Отправить на проверку")');
  await expect(page.getByText("Подтверждение публикации.")).toBeVisible();

  // без отметки браузер не отправит форму
  await page.click('button:has-text("Подтвердить публикацию")');
  await expect(page.locator(".badge-review")).toBeVisible();
  const before = tgLog().split("\n").filter((l) => l.includes('"-1001"')).length;
  expect(before).toBe(0);

  await page.check("input[name=confirm]");
  await page.click('button:has-text("Подтвердить публикацию")');
  await expect(page.getByText(/^Подтверждено/)).toBeVisible();

  await expect(async () => {
    await page.reload();
    await expect(page.locator(".badge-published")).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 45_000 });

  const sent = tgLog().split("\n").filter((l) => l.includes('\\"chat_id\\":\\"-1001\\"'));
  expect(sent).toHaveLength(1);

  await page.goto("/archive");
  await expect(page.getByText(/Нашёл на Are\.na/)).toBeVisible();
  await page.goto("/settings");
  expect(await page.content()).not.toContain("FAKEFAKE");

  const phone = await browser.newContext({ ...devices["iPhone 13"] });
  await phone.addCookies(await page.context().cookies());
  const m = await phone.newPage();
  await m.goto(E2E_ENV.APP_URL + "/");
  expect(await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await phone.close();
});
