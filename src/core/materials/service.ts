import { Prisma } from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import { sha256 } from "@/lib/crypto";
import { logActivity } from "@/core/activity/log";
import { enqueueJob } from "@/core/jobs/queue";
import { normalizeUrl, urlHash } from "./url";
import type { MaterialType } from "./states";

export type IncomingAttachment = {
  kind: "image" | "video" | "audio" | "voice" | "document";
  telegramFileId: string;
  telegramFileUniqueId: string;
  mime?: string | null;
  sizeBytes?: number | null;
  fileName?: string | null;
};

export type IntakeInput = {
  sourceKind: "telegram_bot" | "manual" | "upload";
  type: MaterialType;
  url?: string | null;
  text?: string | null;
  title?: string | null;
  sourceName?: string | null;
  ownerNote?: string | null;
  attachments?: IncomingAttachment[];
  telegramUpdateId?: string | null;
  actorUserId?: string | null;
};

export type IntakeResult =
  | { status: "created"; materialId: string }
  | { status: "duplicate"; materialId: string };

async function sourceId(tx: Tx, kind: IntakeInput["sourceKind"]) {
  const names = { telegram_bot: "Telegram-бот", manual: "Вручную", upload: "Загрузка файла" } as const;
  const s = await tx.source.upsert({ where: { kind }, update: {}, create: { kind, name: names[kind] } });
  return s.id;
}

/**
 * Сохраняет материал. Не зависит от AI и сети: после коммита материал уже не потеряется,
 * а обработка (скачивание файлов, классификация) ставится в очередь.
 * Повторная ссылка не создаёт новую запись: счётчик и заметка добавляются к существующей.
 */
export async function intakeMaterial(input: IntakeInput): Promise<IntakeResult> {
  const normalized = input.url ? normalizeUrl(input.url) : null;
  const hash = normalized ? urlHash(normalized) : null;
  const text = input.text?.trim() || null;

  const findDuplicate = async (tx: Tx) => (hash ? tx.material.findUnique({ where: { normalizedUrlHash: hash } }) : null);

  const markDuplicate = async (tx: Tx, id: string, note: string | null) => {
    const existing = await tx.material.findUniqueOrThrow({ where: { id } });
    const ownerNote = note && !existing.ownerNote?.includes(note) ? [existing.ownerNote, note].filter(Boolean).join("\n\n") : existing.ownerNote;
    await tx.material.update({
      where: { id },
      data: {
        duplicateCount: { increment: 1 },
        ownerNote,
        // удалённый материал, присланный снова, возвращается во входящие
        ...(existing.status === "deleted" ? { status: "inbox", deletedAt: null } : {}),
      },
    });
    await logActivity({ actorType: "bot", actorUserId: input.actorUserId, action: "material.duplicate_received", entityType: "material", entityId: id }, tx);
  };

  try {
    return await db.$transaction(async (tx) => {
      const dup = await findDuplicate(tx);
      if (dup) {
        await markDuplicate(tx, dup.id, input.ownerNote ?? null);
        return { status: "duplicate" as const, materialId: dup.id };
      }
      const material = await tx.material.create({
        data: {
          sourceId: await sourceId(tx, input.sourceKind),
          telegramUpdateId: input.telegramUpdateId ?? null,
          type: input.type,
          status: "inbox",
          originalUrl: input.url ?? null,
          normalizedUrlHash: hash,
          contentHash: text ? sha256(text) : null,
          title: input.title ?? null,
          sourceName: input.sourceName ?? null,
          ownerNote: input.ownerNote ?? null,
          text,
          attachments: input.attachments?.length
            ? {
                create: input.attachments.map((a, i) => ({
                  kind: a.kind,
                  telegramFileId: a.telegramFileId,
                  telegramFileUniqueId: a.telegramFileUniqueId,
                  mime: a.mime ?? null,
                  sizeBytes: a.sizeBytes ?? null,
                  fileName: a.fileName ?? null,
                  sortOrder: i,
                })),
              }
            : undefined,
        },
        include: { attachments: true },
      });
      await logActivity({ actorType: input.sourceKind === "telegram_bot" ? "bot" : "user", actorUserId: input.actorUserId, action: "material.created", entityType: "material", entityId: material.id, data: { type: input.type } }, tx);
      for (const a of material.attachments) {
        await enqueueJob({ kind: "download_attachment", payload: { attachmentId: a.id }, dedupKey: `download:${a.id}` }, tx);
      }
      await enqueueJob({ kind: "classify_material", payload: { materialId: material.id }, dedupKey: `classify:${material.id}`, maxAttempts: 3 }, tx);
      return { status: "created" as const, materialId: material.id };
    });
  } catch (e) {
    // Гонка: та же ссылка пришла одновременно дважды. Уникальный индекс отработал, отдаём существующую.
    if (hash && e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const existing = await db.material.findUnique({ where: { normalizedUrlHash: hash } });
      if (existing) return { status: "duplicate", materialId: existing.id };
    }
    throw e;
  }
}

/** Мягкое удаление. Окончательная очистка выполняется отдельным действием. */
export async function softDeleteMaterial(id: string, actorUserId: string) {
  await db.$transaction(async (tx) => {
    await tx.material.update({ where: { id }, data: { status: "deleted", deletedAt: new Date() } });
    await logActivity({ actorType: "user", actorUserId, action: "material.deleted", entityType: "material", entityId: id }, tx);
  });
}

export async function setMaterialStatus(id: string, status: "archived" | "ready" | "inbox", actorUserId: string) {
  await db.$transaction(async (tx) => {
    await tx.material.update({ where: { id }, data: { status, deletedAt: null } });
    await logActivity({ actorType: "user", actorUserId, action: `material.${status}`, entityType: "material", entityId: id }, tx);
  });
}

export async function setMaterialCategory(id: string, categoryId: string | null, actorUserId: string) {
  await db.$transaction(async (tx) => {
    await tx.material.update({ where: { id }, data: { categoryId, categorySetBy: "user", categoryConfidence: null } });
    await logActivity({ actorType: "user", actorUserId, action: "material.category_set", entityType: "material", entityId: id, data: { categoryId } }, tx);
  });
}
