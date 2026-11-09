import { db } from "@/lib/db";

type Entity = string | { type: string; text: string; href?: string };
type ExportMessage = { id: number; type: string; date: string; text?: string | Entity[]; forwarded_from?: string };
export type TelegramExport = { name?: string; messages?: ExportMessage[] };

export function exportTextToPlain(text: ExportMessage["text"]): string {
  if (!text) return "";
  if (typeof text === "string") return text;
  return text.map((e) => (typeof e === "string" ? e : e.type === "text_link" && e.href ? `${e.text} (${e.href})` : e.text)).join("");
}

/**
 * Импорт канала-образца из экспорта Telegram Desktop (JSON).
 * Берутся только собственные сообщения канала с текстом от 40 символов, без пересланных.
 * Повторный импорт не создаёт дубликатов.
 */
export async function importReferenceExport(data: TelegramExport, channelName?: string) {
  const channel = channelName ?? data.name ?? "reference";
  let imported = 0;
  let skipped = 0;
  for (const m of data.messages ?? []) {
    const text = exportTextToPlain(m.text).trim();
    if (m.type !== "message" || m.forwarded_from || text.length < 40) {
      skipped++;
      continue;
    }
    await db.referencePost.upsert({
      where: { channel_messageId: { channel, messageId: m.id } },
      update: { text },
      create: { channel, messageId: m.id, date: new Date(m.date), text },
    });
    imported++;
  }
  return { channel, imported, skipped };
}
