import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/web/auth";
import { Shell, fmtDate, Empty, StatusBadge } from "@/components/shell";
import { POST_STATUSES, POST_STATUS_LABEL, type PostStatus } from "@/core/posts/states";
import { newPost } from "../actions";

export const dynamic = "force-dynamic";

export default async function Posts({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireUser();
  const { status } = await searchParams;
  const posts = await db.post.findMany({
    where: status ? { status } : { status: { notIn: ["published", "archived"] } },
    orderBy: { updatedAt: "desc" },
    take: 100,
    include: { category: true, channel: true },
  });
  return (
    <Shell active="/posts" title="Публикации">
      <div className="row">
        <form action={newPost}><button className="btn btn-primary">Новый пост</button></form>
        <Link className={`btn btn-sm ${!status ? "btn-primary" : ""}`} href="/posts">В работе</Link>
        {POST_STATUSES.map((s) => <Link key={s} className={`btn btn-sm ${status === s ? "btn-primary" : ""}`} href={`/posts?status=${s}`}>{POST_STATUS_LABEL[s]}</Link>)}
      </div>
      <div style={{ marginTop: 12 }}>
        {posts.length ? posts.map((p) => (
          <div className="card" key={p.id}>
            <div className="card-head">
              <Link href={`/posts/${p.id}`} className="clip">{p.body.replace(/<[^>]+>/g, "").slice(0, 120) || "(пустой черновик)"}</Link>
              <StatusBadge status={p.status} label={POST_STATUS_LABEL[p.status as PostStatus]} />
            </div>
            <div className="meta">{p.category?.name ?? "без категории"} · {p.channel?.title ?? "канал не выбран"} · изменён {fmtDate(p.updatedAt)}{p.scheduledAt ? ` · дата ${fmtDate(p.scheduledAt)}` : ""}</div>
          </div>
        )) : <Empty>Публикаций нет</Empty>}
      </div>
    </Shell>
  );
}
