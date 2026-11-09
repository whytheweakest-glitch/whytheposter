import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { sha256 } from "@/lib/crypto";

/** Файлы хранятся отдельно от БД, по sha256: одинаковые файлы лежат один раз. */
export function storageRoot() {
  return path.resolve(process.env.STORAGE_DIR ?? "./storage");
}

export async function saveFile(data: Buffer, ext: string) {
  const hash = sha256(data);
  const safeExt = ext.replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase();
  const key = `${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}${safeExt ? "." + safeExt : ""}`;
  const full = path.join(storageRoot(), key);
  try {
    await stat(full);
  } catch {
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, data);
  }
  return { key, sha256: hash, size: data.length };
}

export async function readStoredFile(key: string) {
  if (key.includes("..") || path.isAbsolute(key)) throw new Error("Некорректный ключ файла");
  return readFile(path.join(storageRoot(), key));
}

export function sniffMime(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (buf.toString("ascii", 0, 4) === "OggS") return "audio/ogg";
  if (buf.toString("ascii", 4, 8) === "ftyp") return "video/mp4";
  if (buf.toString("ascii", 0, 4) === "%PDF") return "application/pdf";
  return null;
}

/**
 * Удаляет EXIF/GPS из JPEG (сегменты APP1). Пиксели не трогаются.
 * Для PNG/WebP метаданные GPS обычно не пишутся; эти форматы возвращаются как есть.
 */
export function stripJpegMetadata(buf: Buffer): Buffer {
  if (!(buf[0] === 0xff && buf[1] === 0xd8)) return buf;
  const parts: Buffer[] = [buf.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) break;
    const marker = buf[i + 1];
    if (marker === 0xda) {
      parts.push(buf.subarray(i));
      return Buffer.concat(parts);
    }
    const len = buf.readUInt16BE(i + 2);
    const seg = buf.subarray(i, i + 2 + len);
    const isExifOrXmp = marker === 0xe1;
    if (!isExifOrXmp) parts.push(seg);
    i += 2 + len;
  }
  return buf;
}
