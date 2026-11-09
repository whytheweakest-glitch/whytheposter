import { db, type Tx } from "@/lib/db";

export type ActivityInput = {
  actorType: "user" | "system" | "ai" | "bot";
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  data?: Record<string, unknown>;
  severity?: "info" | "warning" | "critical";
};

/** Журнал только для добавления. Не передавайте сюда секреты. */
export function logActivity(input: ActivityInput, tx: Tx | typeof db = db) {
  return tx.activityLog.create({
    data: {
      actorType: input.actorType,
      actorUserId: input.actorUserId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      data: input.data ? JSON.stringify(input.data, (_k, v) => (typeof v === "bigint" ? v.toString() : v)) : null,
      severity: input.severity ?? "info",
    },
  });
}
