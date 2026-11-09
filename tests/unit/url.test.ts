import { describe, expect, it } from "vitest";
import { extractUrls, normalizeUrl } from "@/core/materials/url";

describe("normalizeUrl", () => {
  it("убирает трекинг, www, якорь и завершающий слеш", () => {
    expect(normalizeUrl("http://WWW.Example.com/Path/?utm_source=tg&b=2&a=1#top")).toBe("https://example.com/Path?a=1&b=2");
  });
  it("одинаковые ссылки дают одинаковый результат", () => {
    expect(normalizeUrl("https://example.com/x/")).toBe(normalizeUrl("https://www.example.com/x?fbclid=123"));
  });
  it("youtu.be и youtube.com/watch совпадают", () => {
    expect(normalizeUrl("https://youtu.be/abc123?si=xyz")).toBe(normalizeUrl("https://www.youtube.com/watch?v=abc123"));
  });
  it("отклоняет не-http", () => {
    expect(normalizeUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeUrl("не ссылка")).toBeNull();
  });
});

describe("extractUrls", () => {
  it("находит ссылки и отрезает пунктуацию", () => {
    expect(extractUrls("смотри https://a.com/x, и (https://b.org/y).")).toEqual(["https://a.com/x", "https://b.org/y"]);
  });
});
