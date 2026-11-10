import { decodeEntities } from "@/core/publishing/telegram-html";
import type { TelegramExport } from "./import";

/**
 * Импорт публичного канала по ссылке через его веб-превью t.me/s/<канал>.
 * Только публичные посты, без входа в аккаунт, с паузой между страницами.
 */
export type PreviewMessage = { id: number; date: string; text: string; forwarded: boolean };

export function parseChannelName(input: string): string {
  const m = /^(?:https?:\/\/)?(?:t\.me|telegram\.me)\/(?:s\/)?([A-Za-z0-9_]{4,})/.exec(input.trim()) ?? /^@?([A-Za-z0-9_]{4,})$/.exec(input.trim());
  if (!m) throw new Error(`Не похоже на ссылку на публичный канал: ${input}`);
  return m[1];
}

function htmlToText(html: string) {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi, (_m, href: string, label: string) => {
        const text = label.replace(/<[^>]+>/g, "");
        return /^https?:/.test(text) || text === href ? text : `${text} (${href})`;
      })
      .replace(/<[^>]+>/g, ""),
  ).trim();
}

/** Разбирает одну страницу t.me/s/<канал>. Чистая функция, покрыта тестом. */
export function parsePreviewPage(html: string, channel: string): PreviewMessage[] {
  const out: PreviewMessage[] = [];
  const blocks = html.split(/<div class="tgme_widget_message_wrap/).slice(1);
  for (const b of blocks) {
    const post = new RegExp(`data-post="${channel}/(\\d+)"`, "i").exec(b);
    if (!post) continue;
    const textMatch = /<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(b);
    const date = /<time[^>]*datetime="([^"]+)"/.exec(b)?.[1] ?? new Date(0).toISOString();
    out.push({ id: Number(post[1]), date, text: textMatch ? htmlToText(textMatch[1]) : "", forwarded: b.includes("tgme_widget_message_forwarded_from") });
  }
  return out;
}

export async function fetchPublicChannel(input: string, opts: { maxPosts?: number; delayMs?: number; fetchImpl?: typeof fetch } = {}): Promise<TelegramExport> {
  const channel = parseChannelName(input);
  const f = opts.fetchImpl ?? fetch;
  const maxPosts = opts.maxPosts ?? 2000;
  const seen = new Map<number, PreviewMessage>();
  let before: number | null = null;
  for (let page = 0; page < 200 && seen.size < maxPosts; page++) {
    const url = `https://t.me/s/${channel}${before ? `?before=${before}` : ""}`;
    const res = await f(url, { headers: { "user-agent": "Mozilla/5.0 (WTW-OS reference import)" }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`t.me ответил ${res.status} для ${url}`);
    const items = parsePreviewPage(await res.text(), channel);
    const fresh = items.filter((m) => !seen.has(m.id));
    if (!fresh.length) break;
    for (const m of fresh) seen.set(m.id, m);
    before = Math.min(...items.map((m) => m.id));
    if (before <= 1) break;
    await new Promise((r) => setTimeout(r, opts.delayMs ?? 1200));
  }
  return {
    name: channel,
    messages: [...seen.values()].map((m) => ({ id: m.id, type: "message", date: m.date, text: m.text, ...(m.forwarded ? { forwarded_from: "forward" } : {}) })),
  };
}
