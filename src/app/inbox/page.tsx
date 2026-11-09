import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/web/auth";
import { Shell, fmtDate, Empty, StatusBadge } from "@/components/shell";
import { MATERIAL_STATUS_LABEL, type MaterialStatus } from "@/core/materials/states";
import { addManualMaterial, materialAction, bulkCategory } from "../actions";

export const dynamic = "force-dynamic";

type SP = { q?: string; category?: string; source?: string; status?: string; confirmDelete?: string; error?: string };

export default async function Inbox({ searchParams }: { searchParams: Promise<SP> }) {
  await requireUser();
  const sp = await searchParams;
  const status = sp.status ?? "active";
  const where: Prisma.MaterialWhereInput = {
    status: status === "active" ? { in: ["inbox", "processing", "ready", "failed"] } : status,
    ...(sp.category ? { categoryId: sp.category === "none" ? null : sp.category } : {}),
    ...(sp.source ? { source: { kind: sp.source } } : {}),
    ...(sp.q ? { OR: [{ title: { contains: sp.q } }, { text: { contains: sp.q } }, { originalUrl: { contains: sp.q } }, { summary: { contains: sp.q } }, { ownerNote: { contains: sp.q } }] } : {}),
  };
  const [items, categories, sources] = await Promise.all([
    db.material.findMany({ where, orderBy: { createdAt: "desc" }, take: 100, include: { category: true, source: true, attachments: true } }),
    db.category.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
    db.source.findMany(),
  ]);

  return (
    <Shell active="/inbox" title="Входящие" error={sp.error}>
      <form action={addManualMaterial} className="row">
        <input name="text" placeholder="Ссылка или заметка" style={{ flex: 1, minWidth: 220 }} required />
        <button className="btn btn-primary">Добавить</button>
      </form>
      <form className="row" style={{ marginTop: 12 }}>
        <input name="q" placeholder="Поиск" defaultValue={sp.q} />
        <select name="category" defaultValue={sp.category ?? ""}>
          <option value="">Все категории</option>
          <option value="none">Без категории</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select name="source" defaultValue={sp.source ?? ""}>
          <option value="">Все источники</option>
          {sources.map((s) => <option key={s.id} value={s.kind}>{s.name}</option>)}
        </select>
        <select name="status" defaultValue={status}>
          <option value="active">Во входящих</option>
          <option value="archived">В архиве</option>
          <option value="deleted">Удалённые</option>
        </select>
        <button className="btn">Показать</button>
      </form>

      <form action={bulkCategory} id="bulk" className="row" style={{ marginTop: 12 }}>
        <span className="meta">Отмеченным:</span>
        <select name="categoryId">{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <button className="btn btn-sm">Назначить категорию</button>
      </form>

      <div style={{ marginTop: 12 }}>
        {items.length ? items.map((m) => (
          <article className="card" key={m.id}>
            <div className="card-head">
              <div className="row">
                <input type="checkbox" name="ids" value={m.id} form="bulk" aria-label="Отметить" />
                <strong className="clip">{m.title ?? m.originalUrl ?? m.text?.slice(0, 90) ?? `${m.type}`}</strong>
              </div>
              <StatusBadge status={m.status} label={MATERIAL_STATUS_LABEL[m.status as MaterialStatus]} />
            </div>
            {m.originalUrl && <div className="clip"><a href={m.originalUrl} target="_blank" rel="noopener noreferrer nofollow">{m.originalUrl}</a></div>}
            {m.summary && <p>{m.summary}</p>}
            {m.text && m.text !== m.title && <p className="clip" style={{ whiteSpace: "pre-wrap" }}>{m.text.slice(0, 500)}</p>}
            {m.ownerNote && <p className="meta">Заметка: {m.ownerNote}</p>}
            {m.attachments.map((a) => a.storageKey && a.kind === "image" ? <img key={a.id} className="thumb" src={`/api/files/${a.storageKey}`} alt="" /> : <span key={a.id} className="meta">{a.kind}{a.downloadError ? `: ${a.downloadError}` : a.storageKey ? "" : " (скачивается)"} </span>)}
            {m.processingError && <p className="meta" style={{ color: "var(--warn)" }}>{m.processingError}</p>}
            <div className="meta">
              {fmtDate(m.createdAt)} · {m.source.name} · {m.category ? `${m.category.name}${m.categorySetBy === "ai" ? ` (AI, ${Math.round((m.categoryConfidence ?? 0) * 100)}%)` : ""}` : "без категории"}
              {m.duplicateCount > 0 && ` · присылали ещё ${m.duplicateCount} раз`}
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <form action={materialAction}><input type="hidden" name="id" value={m.id} /><input type="hidden" name="op" value="draft" /><button className="btn btn-sm btn-primary">Создать черновик</button></form>
              <form action={materialAction} className="row">
                <input type="hidden" name="id" value={m.id} /><input type="hidden" name="op" value="category" />
                <select name="categoryId" defaultValue={m.categoryId ?? ""}><option value="">—</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
                <button className="btn btn-sm">OK</button>
              </form>
              <form action={materialAction}><input type="hidden" name="id" value={m.id} /><input type="hidden" name="op" value="reclassify" /><button className="btn btn-sm">AI ещё раз</button></form>
              {m.status === "archived" || m.status === "deleted"
                ? <form action={materialAction}><input type="hidden" name="id" value={m.id} /><input type="hidden" name="op" value="restore" /><button className="btn btn-sm">Вернуть</button></form>
                : <form action={materialAction}><input type="hidden" name="id" value={m.id} /><input type="hidden" name="op" value="archive" /><button className="btn btn-sm">В архив</button></form>}
              {m.status !== "deleted" && (sp.confirmDelete === m.id ? (
                <form action={materialAction} className="row">
                  <input type="hidden" name="id" value={m.id} /><input type="hidden" name="confirm" value="yes" />
                  <span className="meta">Точно удалить?</span>
                  <input type="hidden" name="op" value="delete" /><button className="btn btn-sm btn-danger">Да, удалить</button>
                  <Link className="btn btn-sm btn-ghost" href="/inbox">Отмена</Link>
                </form>
              ) : (
                <form action={materialAction}><input type="hidden" name="id" value={m.id} /><input type="hidden" name="op" value="delete" /><button className="btn btn-sm btn-danger">Удалить</button></form>
              ))}
            </div>
            <details style={{ marginTop: 6 }}>
              <summary className="meta">Заметка</summary>
              <form action={materialAction} className="row"><input type="hidden" name="id" value={m.id} /><input type="hidden" name="op" value="note" /><input name="note" defaultValue={m.ownerNote ?? ""} style={{ flex: 1 }} /><button className="btn btn-sm">Сохранить</button></form>
            </details>
          </article>
        )) : <Empty>Пусто. Перешлите что-нибудь боту или добавьте ссылку выше.</Empty>}
      </div>
    </Shell>
  );
}
