import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/web/auth";
import { Shell, Empty, StatusBadge, toLocalInput } from "@/components/shell";
import { POST_STATUS_LABEL, type PostStatus } from "@/core/posts/states";
import { rescheduleFromCalendar } from "../actions";

export const dynamic = "force-dynamic";

/** Базовый календарь: список по дням. Перенос даты не публикует пост и не подтверждает его. */
export default async function Calendar({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  const from = new Date(Date.now() - 14 * 86_400_000);
  const posts = await db.post.findMany({
    where: {
      OR: [
        { status: { in: ["approved", "scheduled", "publishing"] } },
        { status: { in: ["draft", "review"] }, scheduledAt: { not: null } },
        { status: "published", publishedAt: { gte: from } },
      ],
    },
    orderBy: [{ scheduledAt: "asc" }],
  });
  const dayOf = (p: (typeof posts)[number]) => p.publishedAt ?? p.scheduledAt;
  const groups = new Map<string, typeof posts>();
  for (const p of posts.sort((a, b) => (dayOf(a)?.getTime() ?? 0) - (dayOf(b)?.getTime() ?? 0))) {
    const d = dayOf(p);
    const key = d ? d.toLocaleDateString("ru-RU", { weekday: "short", day: "2-digit", month: "long" }) : "Без даты (сразу после подтверждения)";
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  return (
    <Shell active="/calendar" title="Календарь" error={sp.error}>
      <p className="meta">Дата у неподтверждённого поста это только план: он не выйдет, пока вы его не подтвердите.</p>
      {groups.size ? [...groups].map(([day, list]) => (
        <section key={day}>
          <h2>{day}</h2>
          {list.map((p) => (
            <div className="card" key={p.id}>
              <div className="card-head">
                <Link href={`/posts/${p.id}`} className="clip">{p.body.replace(/<[^>]+>/g, "").slice(0, 90) || "(пусто)"}</Link>
                <StatusBadge status={p.status} label={POST_STATUS_LABEL[p.status as PostStatus]} />
              </div>
              {p.status !== "published" && p.status !== "publishing" && (
                <form action={rescheduleFromCalendar} className="row" style={{ marginTop: 6 }}>
                  <input type="hidden" name="id" value={p.id} />
                  <input type="datetime-local" name="scheduledAt" defaultValue={toLocalInput(p.scheduledAt)} />
                  <button className="btn btn-sm">Перенести</button>
                </form>
              )}
            </div>
          ))}
        </section>
      )) : <Empty>В календаре пусто</Empty>}
    </Shell>
  );
}
