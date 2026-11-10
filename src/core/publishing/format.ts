/** Формат поста вычисляется из вложений, автор выбирает только вложения. */
export type PostFormat = "text" | "photo" | "video" | "document" | "album";
export const MEDIA_FORMATS: readonly PostFormat[] = ["photo", "video", "document", "album"];
export const ALBUM_MAX = 10;

export type FormatResult = { ok: true; format: PostFormat } | { ok: false; error: string };

export function deriveFormat(kinds: string[]): FormatResult {
  if (!kinds.length) return { ok: true, format: "text" };
  if (kinds.some((k) => k === "voice" || k === "audio")) return { ok: false, error: "Аудио и голосовые пока нельзя публиковать" };
  if (kinds.length > ALBUM_MAX) return { ok: false, error: `В альбоме не больше ${ALBUM_MAX} файлов` };
  if (kinds.length === 1) return { ok: true, format: kinds[0] === "image" ? "photo" : kinds[0] === "video" ? "video" : "document" };
  const docs = kinds.filter((k) => k === "document").length;
  if (docs && docs !== kinds.length) return { ok: false, error: "Документы нельзя смешивать в альбоме с фото и видео" };
  return { ok: true, format: "album" };
}

export const FORMAT_LABEL: Record<PostFormat, string> = { text: "Текст", photo: "Фото с подписью", video: "Видео с подписью", document: "Файл с подписью", album: "Альбом" };
