import { sha256 } from "@/lib/crypto";

const TRACKING_PARAMS = /^(utm_[a-z]+|fbclid|gclid|yclid|mc_cid|mc_eid|igshid|si|ref_src|_hsenc|_hsmi|spm)$/i;

/**
 * Нормализует ссылку для поиска дубликатов: хост в нижнем регистре, без www, без якоря,
 * без трекинговых параметров, параметры отсортированы, без завершающего слеша.
 * Возвращает null для всего, что не http(s).
 */
export function normalizeUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  u.protocol = "https:";
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");
  u.hash = "";
  u.username = "";
  u.password = "";
  if (u.port === "443" || u.port === "80") u.port = "";
  const params = [...u.searchParams.entries()].filter(([k]) => !TRACKING_PARAMS.test(k));
  params.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  u.search = "";
  for (const [k, v] of params) u.searchParams.append(k, v);
  // youtu.be/ID и youtube.com/watch?v=ID считаем одной ссылкой
  if (u.hostname === "youtu.be") {
    const id = u.pathname.slice(1);
    return `https://youtube.com/watch?v=${id}`;
  }
  let path = u.pathname.replace(/\/{2,}/g, "/");
  if (path.length > 1) path = path.replace(/\/+$/, "");
  return `${u.protocol}//${u.host}${path === "/" ? "" : path}${u.search}`;
}

export function urlHash(normalized: string) {
  return sha256(normalized);
}

const URL_RE = /https?:\/\/[^\s<>"'«»]+/gi;

/** Находит ссылки в тексте, отрезая завершающую пунктуацию. */
export function extractUrls(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(URL_RE)) {
    const cleaned = m[0].replace(/[.,;:!?)\]}]+$/, "");
    if (!out.includes(cleaned)) out.push(cleaned);
  }
  return out;
}
