"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { autosavePost } from "@/app/actions";
import { CAPTION_LIMIT, TEXT_LIMIT, checkTelegramHtml, previewHtml, visibleLength } from "@/core/publishing/telegram-html";

type Props = {
  postId: string;
  initialBody: string;
  editable: boolean;
  format: "text" | "photo";
  channelTitle: string;
  imageUrl: string | null;
};

/** Редактор с автосохранением (через 1,5 с после паузы) и живым предпросмотром Telegram. */
export function Editor({ postId, initialBody, editable, format, channelTitle, imageUrl }: Props) {
  const [body, setBody] = useState(initialBody);
  const [state, setState] = useState<{ text: string; tone: "ok" | "warn" | "danger" }>({ text: "Сохранено", tone: "ok" });
  const [, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saved = useRef(initialBody);

  useEffect(() => {
    if (!editable || body === saved.current) return;
    setState({ text: "Есть несохранённые изменения…", tone: "warn" });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      start(async () => {
        const r = await autosavePost(postId, body);
        if (r.ok) {
          saved.current = body;
          setState({ text: r.approvalRevoked ? "Сохранено. Подтверждение снято: текст изменился, нужно подтвердить заново" : `Сохранено в ${new Date(r.savedAt).toLocaleTimeString("ru-RU")}`, tone: r.approvalRevoked ? "warn" : "ok" });
          if (r.approvalRevoked) window.location.reload();
        } else {
          setState({ text: `Не сохранено: ${r.error}`, tone: "danger" });
        }
      });
    }, 1500);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [body, editable, postId]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (body !== saved.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [body]);

  const limit = format === "photo" ? CAPTION_LIMIT : TEXT_LIMIT;
  const len = visibleLength(body);
  const html = checkTelegramHtml(body);

  return (
    <div className="grid grid-2">
      <div className="stack">
        <label htmlFor="body">Текст (Telegram HTML: &lt;b&gt;, &lt;i&gt;, &lt;a href=&quot;…&quot;&gt;, &lt;blockquote&gt;)</label>
        <textarea id="body" name="body" form="meta" value={body} onChange={(e) => setBody(e.target.value)} readOnly={!editable} spellCheck lang="ru" />
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className={`counter ${len > limit ? "over" : ""}`}>{len} / {limit}</span>
          <span className={`notice notice-${state.tone}`} style={{ padding: "2px 8px", fontSize: 13 }} aria-live="polite">{editable ? state.text : "Только чтение"}</span>
        </div>
        {!html.ok && <p className="notice notice-danger">{html.error}</p>}
      </div>
      <div>
        <label>Предпросмотр: {channelTitle}</label>
        <div className="tg">
          <div className="tg-bubble">
            {format === "photo" && imageUrl && <img src={imageUrl} alt="" />}
            <div className="tg-channel">{channelTitle}</div>
            <div dangerouslySetInnerHTML={{ __html: previewHtml(body) || "<i style='color:#999'>пусто</i>" }} />
            <div className="tg-meta">👁 — · 12:00</div>
          </div>
        </div>
        <p className="meta">Просмотры в предпросмотре не показываются: Bot API их не отдаёт.</p>
      </div>
    </div>
  );
}
