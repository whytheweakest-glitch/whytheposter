import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/web/auth";
import { Shell, fmtDate, StatusBadge, toLocalInput } from "@/components/shell";
import { Editor } from "@/components/editor";
import { POST_STATUS_LABEL, EDITABLE, type PostStatus } from "@/core/posts/states";
import { checkPost } from "@/core/publishing/telegram-html";
import { FORMAT_LABEL, type PostFormat } from "@/core/publishing/format";
import { getValidApproval } from "@/core/posts/service";
import { postAction, savePostMeta, useVariant, requestAiVariants } from "../../actions";

export const dynamic = "force-dynamic";

export default async function PostPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; info?: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const post = await db.post.findUnique({
    where: { id },
    include: {
      channel: true, category: true,
      postMaterials: { include: { material: { include: { attachments: true } } } },
      attachments: { where: { deletedAt: null } },
      drafts: { where: { origin: "ai" }, orderBy: { version: "desc" }, take: 6 },
      approvals: { orderBy: { createdAt: "desc" }, take: 10, include: { user: true } },
      publishAttempts: { orderBy: { startedAt: "desc" }, take: 5 },
    },
  });
  if (!post) notFound();
  const [categories, channels, approval, pendingAi] = await Promise.all([
    db.category.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
    db.channel.findMany({ orderBy: { kind: "desc" } }),
    getValidApproval(id),
    db.job.findFirst({ where: { kind: "generate_draft", status: { in: ["queued", "running"] }, activeDedupKey: `draft:${id}` } }),
  ]);
  const status = post.status as PostStatus;
  const editable = EDITABLE.includes(status);
  const sourceUrls = post.postMaterials.map((pm) => pm.material.originalUrl).filter((u): u is string => !!u);
  const checks = checkPost(post.body, post.format, { sourceUrls });
  const hasErrors = checks.some((c) => c.level === "error");
  const available = post.postMaterials.flatMap((pm) => pm.material.attachments.filter((a) => !a.deletedAt));
  const selectedSha = new Set(post.attachments.map((a) => a.sha256));
  const media = post.attachments.filter((a) => a.storageKey).map((a) => ({ kind: a.kind, url: `/api/files/${a.storageKey}`, name: a.fileName ?? a.kind }));
  const hidden = <input type="hidden" name="id" value={post.id} />;

  return (
    <Shell active="/posts" title="Публикация" error={sp.error} info={sp.info}>
      <div className="row" style={{ marginBottom: 12 }}>
        <StatusBadge status={status} label={POST_STATUS_LABEL[status]} />
        {post.scheduledAt && <span className="meta">дата: {fmtDate(post.scheduledAt)}</span>}
        {post.publishedUrl && <a href={post.publishedUrl} target="_blank" rel="noopener noreferrer">Открыть в Telegram</a>}
        {post.lastError && <span className="meta" style={{ color: "var(--danger)" }}>{post.lastError}</span>}
      </div>

      {status === "publish_unknown" && (
        <div className="notice notice-danger stack">
          <p><b>Связь оборвалась во время отправки, поэтому неизвестно, вышел ли пост.</b> Откройте канал и проверьте. Система не будет отправлять его повторно сама.</p>
          <form action={postAction} className="row">{hidden}<input name="publishedUrl" placeholder="Ссылка на пост (если вышел)" /><input type="hidden" name="op" value="resolve_published" /><button className="btn">Пост вышел</button></form>
          <form action={postAction}>{hidden}<input type="hidden" name="op" value="resolve_not_published" /><button className="btn btn-danger">Не вышел, вернуть на проверку</button></form>
        </div>
      )}

      <Editor postId={post.id} initialBody={post.body} editable={editable} format={post.format} channelTitle={post.channel?.title ?? "Канал не выбран"} media={media} />

      <form id="meta" action={savePostMeta} className="row" style={{ marginTop: 12 }}>
        {hidden}
        <select name="categoryId" defaultValue={post.categoryId ?? ""} disabled={!editable} aria-label="Категория">
          <option value="">Без категории</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select name="channelId" defaultValue={post.channelId ?? ""} disabled={!editable} aria-label="Канал">
          <option value="">Канал не выбран</option>
          {channels.map((c) => <option key={c.id} value={c.id}>{c.title}{c.kind === "test" ? " (тест)" : ""}{c.isPublishEnabled ? "" : " — выключен"}</option>)}
        </select>
        <button className="btn" disabled={!editable}>Сохранить</button>
        <span className="meta">Формат: {FORMAT_LABEL[post.format as PostFormat] ?? post.format}</span>
      </form>
      {available.length > 0 && (
        <fieldset className="card" form="meta" style={{ marginTop: 8 }} disabled={!editable}>
          <legend className="meta">Вложения из материалов (до 10, порядок как в списке). Сохраните, чтобы применить</legend>
          <input type="hidden" name="attachmentsTouched" value="1" form="meta" />
          <div className="row">
            {available.map((a) => (
              <label key={a.id} className="row" style={{ color: "var(--ink)", margin: 0 }}>
                <input type="checkbox" name="attachmentIds" value={a.id} form="meta" defaultChecked={!!a.sha256 && selectedSha.has(a.sha256)} disabled={!a.storageKey} />
                {a.kind === "image" && a.storageKey ? <img className="thumb" src={`/api/files/${a.storageKey}`} alt="" /> : <span>{a.kind}: {a.fileName ?? ""}</span>}
                {!a.storageKey && <span className="meta">{a.downloadError ?? "скачивается"}</span>}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <h2>Проверки</h2>
      {checks.length ? <ul className="checks">{checks.map((c, i) => <li key={i} className={c.level}>{c.message}</li>)}</ul> : <p className="meta">Замечаний нет.</p>}

      <h2>Действия</h2>
      <div className="stack">
        {(status === "draft" || status === "failed" || status === "rejected") && (
          <div className="row">
            {status === "draft" && <form action={postAction}>{hidden}<input type="hidden" name="op" value="review" /><button className="btn btn-primary" disabled={hasErrors}>Отправить на проверку</button></form>}
            {status !== "draft" && <form action={postAction}>{hidden}<input type="hidden" name="op" value="draft" /><button className="btn">Вернуть в черновики</button></form>}
            <form action={postAction}>{hidden}<input type="hidden" name="op" value="archive" /><button className="btn btn-ghost">В архив</button></form>
          </div>
        )}
        {status === "failed" && <form action={postAction}>{hidden}<input type="hidden" name="op" value="review" /><button className="btn">Снова на проверку</button></form>}
        {status === "review" && (
          <div className="card stack">
            <p><b>Подтверждение публикации.</b> Пост уйдёт в «{post.channel?.title ?? "канал не выбран"}» ровно в том виде, как в предпросмотре. Подтвердить можно и кнопкой в боте.</p>
            <form action={postAction} className="stack">
              {hidden}
              <input type="hidden" name="contentHash" value={post.contentHash} />
              <div><label htmlFor="when">Когда (пусто — сразу)</label><input id="when" type="datetime-local" name="scheduledAt" defaultValue={toLocalInput(post.scheduledAt)} /></div>
              <label style={{ color: "var(--ink)" }}><input type="checkbox" name="confirm" value="yes" required /> Я проверил текст и предпросмотр</label>
              <input type="hidden" name="op" value="approve" />
              <button className="btn btn-primary" disabled={hasErrors || !user.canApprove}>Подтвердить публикацию</button>
              {!user.canApprove && <p className="meta">У вас нет права подтверждать публикации.</p>}
            </form>
            <div className="row">
              <form action={postAction}>{hidden}<input type="hidden" name="op" value="draft" /><button className="btn">В черновики</button></form>
              <form action={postAction}>{hidden}<input type="hidden" name="op" value="reject" /><button className="btn btn-danger">Отклонить</button></form>
            </div>
          </div>
        )}
        {(status === "approved" || status === "scheduled") && (
          <div className="card stack">
            <p>Подтверждено{approval ? `: ${approval.user.displayName}, ${fmtDate(approval.createdAt)}, через ${approval.via === "bot" ? "бота" : "Dashboard"}` : ""}. {status === "approved" ? "Worker опубликует пост в ближайшие секунды." : `Выйдет ${fmtDate(post.scheduledAt)}.`}</p>
            <div className="row">
              <form action={postAction} className="row">{hidden}<input type="hidden" name="op" value="reschedule" />
                <input type="datetime-local" name="scheduledAt" defaultValue={toLocalInput(post.scheduledAt)} />
                <button className="btn">Перенести</button>
              </form>
              <form action={postAction}>{hidden}<input type="hidden" name="op" value="reject" /><button className="btn btn-danger">Отменить публикацию</button></form>
            </div>
            <p className="meta">Любая правка текста снимает подтверждение.</p>
          </div>
        )}
      </div>

      {editable && (
        <>
          <h2>Варианты от AI</h2>
          <form action={requestAiVariants}>{hidden}<button className="btn" disabled={!!pendingAi}>{pendingAi ? "Модель думает…" : "Предложить варианты"}</button></form>
          {post.drafts.map((d) => (
            <div className="card" key={d.id}>
              <div className="clip" style={{ whiteSpace: "pre-wrap", fontSize: 14 }}>{d.body}</div>
              <form action={useVariant} style={{ marginTop: 6 }}>{hidden}<input type="hidden" name="draftId" value={d.id} /><button className="btn btn-sm">Взять этот вариант</button></form>
            </div>
          ))}
        </>
      )}

      <h2>Исходные материалы</h2>
      {post.postMaterials.length ? post.postMaterials.map(({ material: m }) => (
        <div className="card" key={m.id}>
          <div className="clip"><b>{m.title ?? m.text?.slice(0, 80) ?? (m.originalUrl ? new URL(m.originalUrl).hostname : m.type)}</b></div>
          {m.originalUrl && <a className="clip" href={m.originalUrl} target="_blank" rel="noopener noreferrer nofollow">{m.originalUrl}</a>}
          {m.summary && <p>{m.summary}</p>}
          {m.ownerNote && <p className="meta">Заметка: {m.ownerNote}</p>}
        </div>
      )) : <p className="meta">Пост без исходных материалов.</p>}

      <h2>История подтверждений</h2>
      <table><tbody>
        {post.approvals.map((a) => <tr key={a.id}><td className="meta">{fmtDate(a.createdAt)}</td><td>{a.action}</td><td>{a.user.displayName}</td><td className="meta">{a.via}</td></tr>)}
        {post.publishAttempts.map((a) => <tr key={a.id}><td className="meta">{fmtDate(a.startedAt)}</td><td>отправка: {a.outcome ?? "идёт"}</td><td colSpan={2} className="meta">{a.errorText}</td></tr>)}
      </tbody></table>
      <p style={{ marginTop: 20 }}><Link href="/posts">← Все публикации</Link></p>
    </Shell>
  );
}
