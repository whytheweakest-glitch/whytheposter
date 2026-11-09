import { db } from "@/lib/db";
import { requireUser } from "@/lib/web/auth";
import { Shell, fmtDate, Empty } from "@/components/shell";
import { addIdea, ideaToPost, ideaStatus } from "../actions";

export const dynamic = "force-dynamic";

const LABEL: Record<string, string> = { open: "Открыта", in_progress: "В работе", used: "Использована", dropped: "Отложена" };

export default async function Ideas() {
  await requireUser();
  const [ideas, categories] = await Promise.all([
    db.idea.findMany({ where: { deletedAt: null }, orderBy: [{ status: "asc" }, { createdAt: "desc" }], include: { category: true, originMaterial: true } }),
    db.category.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
  ]);
  return (
    <Shell active="/ideas" title="Идеи">
      <form action={addIdea} className="stack">
        <textarea name="text" placeholder="Мысль, тема, незаконченная идея…" style={{ minHeight: 90 }} required />
        <div className="row">
          <select name="categoryId"><option value="">Без категории</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <button className="btn btn-primary">Сохранить идею</button>
        </div>
      </form>
      <p className="meta">Из бота: <code>/idea текст</code></p>
      <div style={{ marginTop: 12 }}>
        {ideas.length ? ideas.map((i) => (
          <div className="card" key={i.id}>
            <div style={{ whiteSpace: "pre-wrap" }}>{i.text}</div>
            <div className="meta">{fmtDate(i.createdAt)} · {LABEL[i.status] ?? i.status} · {i.category?.name ?? "без категории"}</div>
            <div className="row" style={{ marginTop: 6 }}>
              <form action={ideaToPost}><input type="hidden" name="id" value={i.id} /><button className="btn btn-sm btn-primary">В черновик</button></form>
              <form action={ideaStatus} className="row"><input type="hidden" name="id" value={i.id} />
                <select name="status" defaultValue={i.status}>{Object.entries(LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                <button className="btn btn-sm">OK</button>
              </form>
            </div>
          </div>
        )) : <Empty>Идей пока нет</Empty>}
      </div>
    </Shell>
  );
}
