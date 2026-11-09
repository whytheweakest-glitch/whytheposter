import { errorMessage } from "@/lib/logger";

/**
 * Минимальный клиент Telegram Bot API для публикации и скачивания файлов.
 * Различает три исхода, это важно для защиты от дублей:
 *  - TelegramApiError: Telegram ответил ошибкой → пост точно не вышел;
 *  - TelegramNetworkError: ответа нет (таймаут, обрыв) → неизвестно, вышел ли пост.
 */
export class TelegramApiError extends Error {
  constructor(public code: number, public description: string, public retryAfter?: number) {
    super(`Telegram ${code}: ${description}`);
  }
}
export class TelegramNetworkError extends Error {}

export type SentMessage = { message_id: number; chat: { id: number; username?: string } };

export interface TelegramPublisherApi {
  sendMessage(chatId: string, html: string): Promise<SentMessage>;
  sendPhoto(chatId: string, photo: { data: Buffer; fileName: string }, captionHtml: string): Promise<SentMessage>;
}

export interface TelegramFileApi {
  getFile(fileId: string): Promise<{ file_path?: string; file_size?: number }>;
  downloadFile(filePath: string): Promise<Buffer>;
}

export class BotApi implements TelegramPublisherApi, TelegramFileApi {
  constructor(private token: string, private baseUrl = "https://api.telegram.org", private timeoutMs = 30_000) {}

  private async call<T>(method: string, body: Record<string, unknown> | FormData): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/bot${this.token}/${method}`, {
        method: "POST",
        headers: body instanceof FormData ? undefined : { "content-type": "application/json" },
        body: body instanceof FormData ? body : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      throw new TelegramNetworkError(errorMessage(e));
    }
    let json: { ok: boolean; result?: T; error_code?: number; description?: string; parameters?: { retry_after?: number } };
    try {
      json = await res.json();
    } catch (e) {
      // ответ пришёл, но не читается: результат неизвестен
      throw new TelegramNetworkError(`Нечитаемый ответ Telegram (${res.status}): ${errorMessage(e)}`);
    }
    if (!json.ok) throw new TelegramApiError(json.error_code ?? res.status, json.description ?? "unknown", json.parameters?.retry_after);
    return json.result as T;
  }

  sendMessage(chatId: string, html: string) {
    return this.call<SentMessage>("sendMessage", { chat_id: chatId, text: html, parse_mode: "HTML", link_preview_options: { is_disabled: false } });
  }

  sendPhoto(chatId: string, photo: { data: Buffer; fileName: string }, captionHtml: string) {
    const fd = new FormData();
    fd.set("chat_id", chatId);
    fd.set("caption", captionHtml);
    fd.set("parse_mode", "HTML");
    fd.set("photo", new Blob([new Uint8Array(photo.data)]), photo.fileName);
    return this.call<SentMessage>("sendPhoto", fd);
  }

  getFile(fileId: string) {
    return this.call<{ file_path?: string; file_size?: number }>("getFile", { file_id: fileId });
  }

  async downloadFile(filePath: string) {
    try {
      const res = await fetch(`${this.baseUrl}/file/bot${this.token}/${filePath}`, { signal: AbortSignal.timeout(120_000) });
      if (!res.ok) throw new TelegramApiError(res.status, "file download failed");
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      if (e instanceof TelegramApiError) throw e;
      throw new TelegramNetworkError(errorMessage(e));
    }
  }
}
