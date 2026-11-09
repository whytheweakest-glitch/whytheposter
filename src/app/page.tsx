import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/web/auth";
import { Shell, fmtDate, Empty, StatusBadge } from "@/components/shell";
import { POST_STATUS_LABEL, type PostStatus } from "@/core/posts/states";
import { getAiProvider } from "@/core/ai/provider";
import { newPost } from "./actions";

export const dynamic = "force-dynamic";

export default async function Overview() {
  await requireUser();
  const [inbox, drafts, review, problems, upcoming, activity, hb] = await Promise.all([
    db.material.count({ where: { status: { in: ["inbox", "processing", "ready", "failed"] } } }),
    db.post.count({ where: { status: "draft" } }),
    db.post.count({ where: { status: "review" } }),
    db.post.findMany({ where: { status: { in: ["publish_unknown", "failed"] } }, orderBy: { updatedAt: "desc" } }),
    db.post.findMany({ where: { status: { in: ["approved", "scheduled"] } }, orderBy: { scheduledAt: "asc" }, take: 5 }),
    db.activityLog.findMany({ orderBy: { createdAt: "desc" }, take: 12 }),
    db.setting.findUnique({ where: { key: "worker.heartbeat" } }),
  ]);
  const ai = getAiProvider();
  const aiOk = ai ? await ai.ping() : null;
  const workerOk = hb && Date.now() - new Date(JSON.parse(hb.value)).getTime() < 120_000;

  return (
    <Shell active="/" title="Обзор">
      {problems.map((p) => (
        <p key={p.id} className="notice notice-danger">
          {p.status === "publish_unknown" ? "Неизвестно, вышел ли пост. " : "Публикация не удалась. "}
          <Link href={`/posts/${p.id}`}>Разобраться</Link>
        </p>
      ))}
      <div className="stats">
        <Link href="/inbox" className="stat"><b>{inbox}</b><span>новых материалов</span></Link>
        <Link href="/posts?status=draft" className="stat"><b>{drafts}</b><span>черновиков</span></Link>
        <Link href="/posts?status=review" className="stat"><b>{review}</b><span>ждут подтверждения</span></Link>
        <Link href="/calendar" className="stat"><b>{upcoming.length}</b><span>в очереди публикации</span></Link>
      </div>
      <div className="row" style={{ marginTop: 16 }}>
        <form action={newPost}><button className="btn btn-primary">Новый пост</button></form>
        <Link className="btn" href="/inbox">Добавить материал</Link>
        <Link className="btn" href="/ideas">Записать идею</Link>
      </div>
      <div className="grid grid-2">
        <section>
          <h2>Ближайшие публикации</h2>
          {upcoming.length ? upcoming.map((p) => (
            <div className="card" key={p.id}>
              <div className="card-head"><Link href={`/posts/${p.id}`}>{p.body.replace(/<[^>]+>/g, "").slice(0, 70) || "(пусто)"}</Link><StatusBadge status={p.status} label={POST_STATUS_LABEL[p.status as PostStatus]} /></div>
              <div className="meta">{p.scheduledAt ? fmtDate(p.scheduledAt) : "сразу после подтверждения"}</div>
            </div>
          )) : <Empty>Очередь пуста</Empty>}
          <h2>Состояние системы</h2>
          <ul className="checks">
            <li className={workerOk ? "" : "error"}>Worker: {workerOk ? "работает" : "не отвечает (запустите npm run worker)"}</li>
            <li className={aiOk === false ? "warning" : ""}>AI: {ai ? (aiOk ? `${ai.model} доступна` : `${ai.model} недоступна, ручная работа не блокируется`) : "выключен"}</li>
            <li className={process.env.TELEGRAM_BOT_TOKEN ? "" : "error"}>Telegram-бот: {process.env.TELEGRAM_BOT_TOKEN ? "токен задан" : "токен не задан"}</li>
          </ul>
        </section>
        <section>
          <h2>Последние действия</h2>
          <table><tbody>
            {activity.map((a) => (
              <tr key={a.id}><td className="meta">{fmtDate(a.createdAt)}</td><td>{a.action}</td><td className="meta hide-sm">{a.actorType}</td></tr>
            ))}
          </tbody></table>
        </section>
      </div>
    </Shell>
  );
}
