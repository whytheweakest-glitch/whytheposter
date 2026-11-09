import { db } from "@/lib/db";
import { getAiProvider } from "@/core/ai/provider";

export const dynamic = "force-dynamic";

export async function GET() {
  const checks: Record<string, string> = {};
  try {
    await db.$queryRaw`SELECT 1`;
    checks.db = "ok";
  } catch {
    checks.db = "error";
  }
  const hb = await db.setting.findUnique({ where: { key: "worker.heartbeat" } }).catch(() => null);
  checks.worker = hb && Date.now() - new Date(JSON.parse(hb.value)).getTime() < 120_000 ? "ok" : "stale";
  const ai = getAiProvider();
  checks.ai = ai ? ((await ai.ping()) ? "ok" : "unavailable") : "disabled";
  return Response.json({ status: checks.db === "ok" ? "ok" : "degraded", checks }, { status: checks.db === "ok" ? 200 : 503 });
}
