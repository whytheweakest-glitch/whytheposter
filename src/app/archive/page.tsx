import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/web/auth";
import { Shell, fmtDate, Empty } from "@/components/shell";

export const dynamic = "force-dynamic";

export default async function Archive({ searchParams }: { searchParams: Promise<{ q?: string; category?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  const [posts, categories] = await Promise.all([
    db.post.findMany({
      where: { status: "published", ...(sp.q ? { body: { contains: sp.q } } : {}), ...(sp.category ? { categoryId: sp.category } : {}) },
      orderBy: { publishedAt: "desc" },
      take: 200,
      include: { category: true, postMaterials: { include: { material: true } } },
    }),
    db.category.findMany({ orderBy: { sortOrder: "asc" } }),
  ]);
  return (
    <Shell active="/archive" title="Архив">
      <form className="row">
        <input name="q" placeholder="Поиск по тексту" defaultValue={sp.q} />
        <select name="category" defaultValue={sp.category ?? ""}><option value="">Все категории</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <button className="btn">Найти</button>
      </form>
      <div style={{ marginTop: 12 }}>
        {posts.length ? posts.map((p) => (
          <article className="card" key={p.id}>
            <div className="card-head">
              <Link href={`/posts/${p.id}`} className="clip">{p.body.replace(/<[^>]+>/g, "").slice(0, 140)}</Link>
              {p.publishedUrl && <a href={p.publishedUrl} target="_blank" rel="noopener noreferrer">в канале ↗</a>}
            </div>
            <div className="meta">{fmtDate(p.publishedAt)} · {p.category?.name ?? "без категории"}</div>
            {p.postMaterials.map(({ material: m }) => m.originalUrl && <div key={m.id} className="meta clip">источник: <a href={m.originalUrl} target="_blank" rel="noopener noreferrer nofollow">{m.originalUrl}</a></div>)}
          </article>
        )) : <Empty>Опубликованных постов пока нет</Empty>}
      </div>
      <p className="meta" style={{ marginTop: 16 }}>Архивированные материалы без публикации: <Link href="/inbox?status=archived">во входящих, фильтр «В архиве»</Link>.</p>
    </Shell>
  );
}
