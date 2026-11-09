/**
 * Подмножество Telegram HTML (parse_mode=HTML). Используется и для отправки, и для предпросмотра,
 * поэтому предпросмотр показывает ровно то, что уйдёт в канал.
 */
export const TEXT_LIMIT = 4096;
export const CAPTION_LIMIT = 1024;

const ALLOWED = new Set(["b", "strong", "i", "em", "u", "ins", "s", "strike", "del", "a", "code", "pre", "blockquote", "tg-spoiler"]);
const TAG_RE = /<\/?([a-zA-Z-]+)([^>]*)>/g;

export type HtmlCheck = { ok: true } | { ok: false; error: string };

export function checkTelegramHtml(html: string): HtmlCheck {
  const stack: string[] = [];
  for (const m of html.matchAll(TAG_RE)) {
    const [full, rawName, attrs] = m;
    const name = rawName.toLowerCase();
    if (!ALLOWED.has(name)) return { ok: false, error: `Тег <${name}> Telegram не поддерживает` };
    if (full.startsWith("</")) {
      if (stack.pop() !== name) return { ok: false, error: `Тег </${name}> закрыт не по порядку` };
      continue;
    }
    if (name === "a") {
      const href = /href\s*=\s*"([^"]*)"/i.exec(attrs)?.[1];
      if (!href || !/^(https?:\/\/|tg:\/\/)/i.test(href)) return { ok: false, error: "У ссылки нет корректного href (http, https или tg)" };
    } else if (attrs.trim() && !(name === "pre" || name === "code" || name === "blockquote")) {
      return { ok: false, error: `У тега <${name}> не должно быть атрибутов` };
    }
    stack.push(name);
  }
  if (stack.length) return { ok: false, error: `Тег <${stack[stack.length - 1]}> не закрыт` };
  const stray = html.replace(TAG_RE, "");
  if (/<|>/.test(stray)) return { ok: false, error: "Символы < и > в тексте нужно записывать как &lt; и &gt;" };
  if (/&(?!(lt|gt|amp|quot|#\d+|#x[0-9a-f]+);)/i.test(stray)) return { ok: false, error: "Символ & в тексте нужно записывать как &amp;" };
  return { ok: true };
}

export function decodeEntities(s: string) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");
}

/** Длина так, как её считает Telegram: видимый текст в UTF-16. */
export function visibleLength(html: string) {
  return decodeEntities(html.replace(TAG_RE, "")).length;
}

export function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export type PostCheck = { level: "error" | "warning"; message: string };

/** Проверки перед подтверждением. Ошибки блокируют подтверждение, предупреждения нет. */
export function checkPost(body: string, format: "text" | "photo", opts: { sourceUrls?: string[] } = {}): PostCheck[] {
  const out: PostCheck[] = [];
  const trimmed = body.trim();
  if (!trimmed && format === "text") out.push({ level: "error", message: "Пустой текст" });
  const html = checkTelegramHtml(body);
  if (!html.ok) out.push({ level: "error", message: html.error });
  const len = visibleLength(body);
  const limit = format === "photo" ? CAPTION_LIMIT : TEXT_LIMIT;
  if (len > limit) out.push({ level: "error", message: `Длина ${len} из ${limit} символов${format === "photo" ? " (подпись к фото)" : ""}` });
  const emoji = body.match(/\p{Extended_Pictographic}/gu)?.length ?? 0;
  if (emoji > 5) out.push({ level: "warning", message: `Много эмодзи: ${emoji}` });
  const tags = body.match(/(^|\s)#[\p{L}\d_]+/gu)?.length ?? 0;
  if (tags > 3) out.push({ level: "warning", message: `Много хештегов: ${tags}` });
  for (const url of opts.sourceUrls ?? []) {
    let host = url;
    try {
      host = new URL(url).hostname.replace(/^www\./, "");
    } catch {}
    if (!body.includes(host)) out.push({ level: "warning", message: `В тексте нет ссылки на источник (${host})` });
  }
  return out;
}

/** Безопасный HTML для предпросмотра в Dashboard (только белый список, ссылки с rel). */
export function previewHtml(body: string): string {
  if (!checkTelegramHtml(body).ok) return escapeHtml(body).replace(/\n/g, "<br>");
  return body
    .replace(TAG_RE, (full, rawName: string, attrs: string) => {
      const name = rawName.toLowerCase();
      const closing = full.startsWith("</");
      if (name === "tg-spoiler") return closing ? "</span>" : '<span class="tg-spoiler">';
      if (name === "a" && !closing) {
        const href = /href\s*=\s*"([^"]*)"/i.exec(attrs)?.[1] ?? "#";
        return `<a href="${href.replace(/"/g, "&quot;")}" target="_blank" rel="noopener noreferrer nofollow">`;
      }
      return closing ? `</${name}>` : `<${name}>`;
    })
    .replace(/\n/g, "<br>");
}
