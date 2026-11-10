import { describe, expect, it } from "vitest";
import { fetchPublicChannel, parseChannelName, parsePreviewPage } from "@/core/reference/web-preview";

const msg = (id: number, text: string, extra = "") => `<div class="tgme_widget_message_wrap js-widget_message_wrap"><div class="tgme_widget_message" data-post="chan/${id}">${extra}<div class="tgme_widget_message_text js-message_text" dir="auto">${text}</div><a class="tgme_widget_message_date"><time datetime="2025-0${(id % 9) + 1}-01T10:00:00+00:00" class="time">10:00</time></a></div></div>`;

describe("импорт канала по ссылке", () => {
  it("понимает разные формы ссылки", () => {
    expect(parseChannelName("https://t.me/whytheweekest")).toBe("whytheweekest");
    expect(parseChannelName("t.me/s/whytheweekest")).toBe("whytheweekest");
    expect(parseChannelName("@whytheweekest")).toBe("whytheweekest");
    expect(() => parseChannelName("https://example.com")).toThrow();
  });

  it("разбирает текст, ссылки, переносы и пересылки", () => {
    const html = msg(5, 'Первая строка<br/>вторая &amp; <a href="https://are.na/x">Are.na</a> <b>жирно</b>') + msg(6, "пересланное", '<div class="tgme_widget_message_forwarded_from">x</div>');
    const r = parsePreviewPage(html, "chan");
    expect(r[0]).toMatchObject({ id: 5, text: "Первая строка\nвторая & Are.na (https://are.na/x) жирно", forwarded: false });
    expect(r[1].forwarded).toBe(true);
  });

  it("листает страницы назад, пока есть новые посты", async () => {
    const pages: Record<string, string> = {
      "https://t.me/s/chan": msg(10, "десятый пост, достаточно длинный текст для образца стиля") + msg(11, "одиннадцатый"),
      "https://t.me/s/chan?before=10": msg(8, "восьмой") + msg(9, "девятый"),
      "https://t.me/s/chan?before=8": msg(8, "восьмой"),
    };
    const fetchImpl = (async (url: string) => new Response(pages[url] ?? "", { status: 200 })) as unknown as typeof fetch;
    const data = await fetchPublicChannel("https://t.me/chan", { fetchImpl, delayMs: 0 });
    expect(data.messages?.map((m) => m.id).sort()).toEqual([10, 11, 8, 9].sort());
  });
});
