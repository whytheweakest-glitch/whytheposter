import { db } from "@/lib/db";
import { randomToken, sha256 } from "@/lib/crypto";
import { logActivity } from "@/core/activity/log";

const LOGIN_TTL_MS = 5 * 60_000;
const SESSION_TTL_MS = 30 * 86_400_000;
export const SESSION_COOKIE = "wtw_session";

/** Одноразовая ссылка входа, которую бот присылает по команде /login. */
export async function createLoginToken(userId: string) {
  const token = randomToken(32);
  await db.loginToken.create({ data: { userId, tokenHash: sha256(token), expiresAt: new Date(Date.now() + LOGIN_TTL_MS) } });
  return token;
}

/** Обменивает одноразовый токен на сессию. Повторное использование и просрочка отклоняются. */
export async function consumeLoginToken(token: string, userAgent?: string | null) {
  const hash = sha256(token);
  return db.$transaction(async (tx) => {
    const lt = await tx.loginToken.findUnique({ where: { tokenHash: hash }, include: { user: true } });
    if (!lt || lt.usedAt || lt.expiresAt < new Date() || !lt.user.isActive) return null;
    const used = await tx.loginToken.updateMany({ where: { id: lt.id, usedAt: null }, data: { usedAt: new Date() } });
    if (used.count !== 1) return null;
    const sessionToken = randomToken(32);
    await tx.session.create({ data: { userId: lt.userId, tokenHash: sha256(sessionToken), expiresAt: new Date(Date.now() + SESSION_TTL_MS), userAgent: userAgent?.slice(0, 300) ?? null } });
    await logActivity({ actorType: "user", actorUserId: lt.userId, action: "auth.login", entityType: "user", entityId: lt.userId }, tx);
    return { sessionToken, expiresAt: new Date(Date.now() + SESSION_TTL_MS) };
  });
}

export async function userBySessionToken(token: string | undefined | null) {
  if (!token) return null;
  const s = await db.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!s || s.revokedAt || s.expiresAt < new Date() || !s.user.isActive) return null;
  return s.user;
}

export async function revokeSession(token: string) {
  await db.session.updateMany({ where: { tokenHash: sha256(token) }, data: { revokedAt: new Date() } });
}
