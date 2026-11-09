import { db } from "@/lib/db";
import { logActivity } from "@/core/activity/log";

/** Владельцы из OWNER_TELEGRAM_IDS всегда активны и могут подтверждать публикации. */
export async function ensureOwners(ids: bigint[]) {
  for (const id of ids) {
    const existing = await db.user.findUnique({ where: { telegramUserId: id } });
    if (!existing) {
      const u = await db.user.create({ data: { telegramUserId: id, displayName: "WHYTHEWEAKEST", role: "owner", canApprove: true, isActive: true } });
      await logActivity({ actorType: "system", action: "user.owner_created", entityType: "user", entityId: u.id });
    } else if (existing.role !== "owner" || !existing.canApprove || !existing.isActive) {
      await db.user.update({ where: { id: existing.id }, data: { role: "owner", canApprove: true, isActive: true } });
    }
  }
}

/** Проверка на сервере для каждого обновления бота. Неизвестные и отключённые пользователи → null. */
export async function findAllowedUser(telegramUserId: number | bigint | undefined | null) {
  if (telegramUserId === undefined || telegramUserId === null) return null;
  const u = await db.user.findUnique({ where: { telegramUserId: BigInt(telegramUserId) } });
  return u && u.isActive ? u : null;
}
