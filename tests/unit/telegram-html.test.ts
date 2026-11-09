import { describe, expect, it } from "vitest";
import { checkPost, checkTelegramHtml, previewHtml, visibleLength } from "@/core/publishing/telegram-html";

describe("Telegram HTML", () => {
  it("принимает разрешённые теги", () => {
    expect(checkTelegramHtml('<b>жирный</b> и <a href="https://x.com">ссылка</a>').ok).toBe(true);
  });
  it("отклоняет неизвестные теги и незакрытые теги", () => {
    expect(checkTelegramHtml("<div>x</div>").ok).toBe(false);
    expect(checkTelegramHtml("<b>x").ok).toBe(false);
    expect(checkTelegramHtml("<b><i>x</b></i>").ok).toBe(false);
  });
  it("отклоняет javascript: в ссылках", () => {
    expect(checkTelegramHtml('<a href="javascript:alert(1)">x</a>').ok).toBe(false);
  });
  it("требует экранировать < и &", () => {
    expect(checkTelegramHtml("1 < 2").ok).toBe(false);
    expect(checkTelegramHtml("Tom & Jerry").ok).toBe(false);
    expect(checkTelegramHtml("Tom &amp; Jerry &lt;3").ok).toBe(true);
  });
  it("считает видимую длину без тегов", () => {
    expect(visibleLength("<b>abc</b> &amp;")).toBe(5);
  });
  it("проверяет лимиты: 4096 для текста, 1024 для подписи", () => {
    const long = "а".repeat(1500);
    expect(checkPost(long, "text").filter((c) => c.level === "error")).toEqual([]);
    expect(checkPost(long, "photo").some((c) => c.level === "error")).toBe(true);
  });
  it("предупреждает об отсутствии ссылки на источник", () => {
    expect(checkPost("текст", "text", { sourceUrls: ["https://www.site.com/a"] }).some((c) => c.message.includes("site.com"))).toBe(true);
  });
  it("предпросмотр не пропускает чужой HTML", () => {
    expect(previewHtml('<script>alert(1)</script>')).not.toContain("<script>");
    expect(previewHtml('<a href="https://x.com">x</a>')).toContain('rel="noopener noreferrer nofollow"');
  });
});
