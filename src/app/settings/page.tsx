import { db } from "@/lib/db";
import { requireUser } from "@/lib/web/auth";
import { Shell } from "@/components/shell";
import { getAiProvider } from "@/core/ai/provider";
import { addCategory, toggleCategory, toggleChannel } from "../actions";

export const dynamic = "force-dynamic";

/** Секрет показывается только как «задан / не задан» и последние 4 символа. */
function secretState(v: string | undefined) {
  return v ? `задан (…${v.slice(-4)})` : "не задан";
}

export default async function Settings({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const [channels, categories, users, refCount] = await Promise.all([
    db.channel.findMany({ orderBy: { kind: "desc" } }),
    db.category.findMany({ orderBy: { sortOrder: "asc" } }),
    db.user.findMany({ orderBy: { createdAt: "asc" } }),
    db.referencePost.count(),
  ]);
  const ai = getAiProvider();
  return (
    <Shell active="/settings" title="Настройки" error={sp.error}>
      <h2>Telegram</h2>
      <table><tbody>
        <tr><td>Токен бота</td><td>{secretState(process.env.TELEGRAM_BOT_TOKEN)}</td></tr>
        <tr><td>Цель публикации</td><td>{process.env.PUBLISH_TARGET === "main" ? "основной канал" : "тестовый канал"} (PUBLISH_TARGET в .env)</td></tr>
        <tr><td>Разрешение на основной канал</td><td>{process.env.MAIN_CHANNEL_PUBLISH_CONFIRMED === "true" ? "есть" : "нет (MAIN_CHANNEL_PUBLISH_CONFIRMED=false)"}</td></tr>
      </tbody></table>

      <h2>Каналы</h2>
      {channels.length ? channels.map((c) => (
        <div className="card row" key={c.id} style={{ justifyContent: "space-between" }}>
          <div><b>{c.title}</b> <span className="meta">{c.kind === "main" ? "основной" : "тестовый"} · {String(c.telegramChatId)} · публикация {c.isPublishEnabled ? "включена" : "выключена"}</span></div>
          {user.role === "owner" && (
            <form action={toggleChannel} className="row">
              <input type="hidden" name="id" value={c.id} />
              <input type="hidden" name="enable" value={c.isPublishEnabled ? "false" : "true"} />
              {!c.isPublishEnabled && c.kind === "main" && <input name="confirm" placeholder="введите ВКЛЮЧИТЬ" />}
              <button className={`btn btn-sm ${c.kind === "main" && !c.isPublishEnabled ? "btn-danger" : ""}`}>{c.isPublishEnabled ? "Выключить" : "Включить"}</button>
            </form>
          )}
        </div>
      )) : <p className="meta">Каналов нет. Укажите TEST_CHANNEL_ID (и позже MAIN_CHANNEL_ID) в .env и перезапустите worker.</p>}

      <h2>AI</h2>
      <table><tbody>
        <tr><td>Провайдер</td><td>{ai ? `${ai.name}, модель ${ai.model}` : "выключен"}</td></tr>
        <tr><td>Доступность</td><td>{ai ? ((await ai.ping()) ? "отвечает" : "не отвечает: запустите Ollama") : "—"}</td></tr>
        <tr><td>Канал-образец</td><td>{refCount} постов (импорт: <code>npm run import:reference -- result.json</code>)</td></tr>
      </tbody></table>

      <h2>Категории</h2>
      {categories.map((c) => (
        <div className="card row" key={c.id} style={{ justifyContent: "space-between" }}>
          <div><b style={{ color: c.color }}>■</b> {c.name} <span className="meta">{c.descriptionForAi}</span></div>
          <form action={toggleCategory}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="active" value={c.isActive ? "false" : "true"} /><button className="btn btn-sm">{c.isActive ? "Скрыть" : "Показать"}</button></form>
        </div>
      ))}
      <form action={addCategory} className="row" style={{ marginTop: 8 }}>
        <input name="name" placeholder="WHYTHE…" required />
        <input name="description" placeholder="Описание для AI" style={{ flex: 1 }} />
        <button className="btn">Добавить категорию</button>
      </form>

      <h2>Доступ</h2>
      <table><tbody>
        {users.map((u) => <tr key={u.id}><td>{u.displayName}</td><td>{u.role}</td><td>{u.canApprove ? "может подтверждать" : "без права подтверждения"}</td><td>{u.isActive ? "активен" : "отключён"}</td></tr>)}
      </tbody></table>
      <p className="meta">Владельцы задаются в OWNER_TELEGRAM_IDS. Бэкапы базы: ежедневно в BACKUP_DIR, вручную <code>npm run backup</code>.</p>
    </Shell>
  );
}
