import { describe, expect, it } from "vitest";
import type { Message } from "grammy/types";
import { messageToIntake } from "@/bot/bot";

const base = { message_id: 1, date: 0, chat: { id: 1, type: "private", first_name: "x" } } as const;

describe("messageToIntake", () => {
  it("ссылка с текстом → материал-ссылка с заметкой", () => {
    const r = messageToIntake({ ...base, text: "глянь https://site.com/a очень красиво" } as Message);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ type: "link", url: "https://site.com/a", ownerNote: "глянь очень красиво" });
  });
  it("несколько ссылок → несколько материалов", () => {
    expect(messageToIntake({ ...base, text: "https://a.com https://b.com" } as Message)).toHaveLength(2);
  });
  it("простой текст → материал-текст", () => {
    expect(messageToIntake({ ...base, text: "мысль" } as Message)[0]).toMatchObject({ type: "text", text: "мысль" });
  });
  it("фото → самый большой размер, подпись как текст", () => {
    const r = messageToIntake({ ...base, caption: "подпись", photo: [{ file_id: "s", file_unique_id: "us", width: 1, height: 1 }, { file_id: "b", file_unique_id: "ub", width: 9, height: 9 }] } as Message);
    expect(r[0]).toMatchObject({ type: "image", text: "подпись" });
    expect(r[0].attachments?.[0].telegramFileId).toBe("b");
  });
  it("пересланный пост публичного канала → ссылка на оригинал", () => {
    const r = messageToIntake({ ...base, text: "текст", forward_origin: { type: "channel", date: 0, message_id: 5, chat: { id: -1, type: "channel", title: "Канал", username: "chan" } } } as Message);
    expect(r[0]).toMatchObject({ type: "forward", url: "https://t.me/chan/5", sourceName: "Канал" });
  });
});
