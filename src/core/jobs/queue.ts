import { randomUUID } from "node:crypto";
import { db, type Tx } from "@/lib/db";
import { errorMessage, logger } from "@/lib/logger";

export type JobKind = "download_attachment" | "classify_material" | "generate_draft" | "notify_review" | "notify_text";

export type EnqueueInput = {
  kind: JobKind;
  payload: Record<string, unknown>;
  /** Пока задача с этим ключом в очереди или выполняется, вторая такая же не создаётся. */
  dedupKey?: string;
  runAfter?: Date;
  maxAttempts?: number;
};

export async function enqueueJob(input: EnqueueInput, tx: Tx | typeof db = db) {
  if (input.dedupKey) {
    const active = await tx.job.findUnique({ where: { activeDedupKey: input.dedupKey } });
    if (active) return active;
  }
  return tx.job.create({
    data: {
      kind: input.kind,
      payload: JSON.stringify(input.payload),
      dedupKey: input.dedupKey ?? null,
      activeDedupKey: input.dedupKey ?? null,
      runAfter: input.runAfter ?? new Date(),
      maxAttempts: input.maxAttempts ?? 5,
    },
  });
}

/** Ошибка, после которой повтор бессмыслен. */
export class PermanentJobError extends Error {}

const LEASE_MS = 5 * 60_000;
export const WORKER_ID = `${process.pid}-${randomUUID().slice(0, 8)}`;

/**
 * Захватывает следующую готовую задачу условным UPDATE (аренда). Подходит для SQLite;
 * задачи с истёкшей арендой (worker упал) возвращаются в работу.
 */
export async function claimNextJob(kinds?: JobKind[], now = new Date()) {
  for (let i = 0; i < 5; i++) {
    const candidate = await db.job.findFirst({
      where: {
        ...(kinds ? { kind: { in: kinds } } : {}),
        OR: [
          { status: "queued", runAfter: { lte: now } },
          { status: "running", leaseUntil: { lt: now } },
        ],
      },
      orderBy: { runAfter: "asc" },
    });
    if (!candidate) return null;
    const res = await db.job.updateMany({
      where: { id: candidate.id, status: candidate.status, updatedAt: candidate.updatedAt },
      data: { status: "running", attempt: { increment: 1 }, leaseUntil: new Date(now.getTime() + LEASE_MS), lockedBy: WORKER_ID },
    });
    if (res.count === 1) return db.job.findUniqueOrThrow({ where: { id: candidate.id } });
  }
  return null;
}

export async function completeJob(id: string) {
  await db.job.update({ where: { id }, data: { status: "done", activeDedupKey: null, leaseUntil: null, lastError: null } });
}

export function backoffMs(attempt: number) {
  return Math.min(30 * 60_000, 60_000 * 2 ** Math.max(0, attempt - 1));
}

export async function failJob(id: string, err: unknown, now = new Date()) {
  const job = await db.job.findUniqueOrThrow({ where: { id } });
  const permanent = err instanceof PermanentJobError;
  const giveUp = permanent || job.attempt >= job.maxAttempts;
  await db.job.update({
    where: { id },
    data: giveUp
      ? { status: "failed", activeDedupKey: null, leaseUntil: null, lastError: errorMessage(err) }
      : { status: "queued", leaseUntil: null, runAfter: new Date(now.getTime() + backoffMs(job.attempt)), lastError: errorMessage(err) },
  });
  return { gaveUp: giveUp };
}

export type JobHandler = (payload: Record<string, unknown>, job: { id: string; attempt: number }) => Promise<void>;

/** Выполняет до `limit` готовых задач. Возвращает число выполненных. */
export async function runDueJobs(handlers: Partial<Record<JobKind, JobHandler>>, limit = 5) {
  let done = 0;
  const kinds = Object.keys(handlers) as JobKind[];
  for (let i = 0; i < limit; i++) {
    const job = await claimNextJob(kinds);
    if (!job) break;
    const handler = handlers[job.kind as JobKind]!;
    try {
      await handler(JSON.parse(job.payload), { id: job.id, attempt: job.attempt });
      await completeJob(job.id);
    } catch (e) {
      const { gaveUp } = await failJob(job.id, e);
      logger.warn({ jobId: job.id, kind: job.kind, attempt: job.attempt, gaveUp, err: errorMessage(e) }, "job_failed");
    }
    done++;
  }
  return done;
}
