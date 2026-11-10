import { Bot, InlineKeyboard, type Context } from "grammy";
import type { Message } from "grammy/types";
import { Prisma, type User } from "@prisma/client";
import { db } from "@/lib/db";
import { errorMessage, logger } from "@/lib/logger";
import { logActivity } from "@/core/activity/log";
import { findAllowedUser } from "@/core/auth/users";
import { createLoginToken } from "@/core/auth/sessions";
import { intakeMaterial, softDeleteMaterial, setMaterialStatus, type IncomingAttachment, type IntakeInput } from "@/core/materials/service";
import { extractUrls } from "@/core/materials/url";
import { approvePost, rejectPost, createPost, PostError } from "@/core/posts/service";
import { enqueueJob } from "@/core/jobs/queue";
import { POST_STATUS_LABEL, type PostStatus } from "@/core/posts/states";
import { escapeHtml } from "@/core/publishing/telegram-html";

type Ctx = Context & { appUser?: User; updateRowId?: string };

const HELP = [
  "<b>WHYTHEWEAKEST OS</b>",
  "",
  "Присылайте ссылки, текст, фото, видео, документы и голосовые: всё сохраняется во входящие.",
  "Подпись к файлу или текст рядом со ссылкой станет заметкой к материалу.",
  "",
  "/idea текст — сохранить идею",
  "/inbox — последние входящие",
  "/drafts — черновики и посты на проверке",
  "/queue — подтверждённые и запланированные",
  "/login — одноразовая ссылка для входа в Dashboard",
  "",
  "Ничего не публикуется без вашего подтверждения.",
].join("\n");

export function buildBot(token: string) {
  const bot = new Bot<Ctx>(token);

  // 1. Повторная доставка того же update_id отбрасывается (уникальный индекс).
  bot.use(async (ctx, next) => {
    const from = ctx.from?.id;
    try {
      const row = await db.telegramUpdate.create({
        data: {
          updateId: BigInt(ctx.update.update_id),
          fromUserId: from ? BigInt(from) : null,
          kind: Object.keys(ctx.update).find((k) => k !== "update_id") ?? "unknown",
          payload: JSON.stringify(ctx.update).slice(0, 20_000),
        },
      });
      ctx.updateRowId = row.id;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return; // уже обработано
      throw e;
    }
    await next();
    await db.telegramUpdate.update({ where: { id: ctx.updateRowId! }, data: { processedAt: new Date() } });
  });

  // 2. Доступ только владельцу и разрешённым администраторам. Проверка на сервере, для каждого обновления.
  bot.use(async (ctx, next) => {
    // Посты канала и счётчики реакций приходят без from: обрабатываются отдельно, сейчас просто игнорируются.
    if (!ctx.from) return;
    const user = await findAllowedUser(ctx.from.id);
    if (!user) {
      await logActivity({ actorType: "bot", action: "bot.access_denied", entityType: "telegram_user", entityId: String(ctx.from.id), severity: "warning" });
      return; // молчим
    }
    if (ctx.chat && ctx.chat.type !== "private") return; // работаем только в личке
    ctx.appUser = user;
    await next();
  });

  bot.command(["start", "help"], (ctx) => ctx.reply(HELP, { parse_mode: "HTML" }));

  bot.command("login", async (ctx) => {
    const token = await createLoginToken(ctx.appUser!.id);
    const url = `${process.env.APP_URL ?? "http://localhost:3000"}/login/${token}`;
    await ctx.reply(`Ссылка для входа (действует 5 минут, одноразовая):\n${url}`, { link_preview_options: { is_disabled: true } });
  });

  bot.command("idea", async (ctx) => {
    const text = ctx.match?.toString().trim();
    if (!text) return ctx.reply("Напишите идею после команды: /idea текст");
    const idea = await db.idea.create({ data: { text } });
    await logActivity({ actorType: "bot", actorUserId: ctx.appUser!.id, action: "idea.created", entityType: "idea", entityId: idea.id });
    await ctx.reply("Идея сохранена.");
  });

  bot.command("inbox", async (ctx) => {
    const items = await db.material.findMany({ where: { status: { in: ["inbox", "processing", "ready", "failed"] } }, orderBy: { createdAt: "desc" }, take: 10, include: { category: true } });
    if (!items.length) return ctx.reply("Входящие пусты.");
    for (const m of items) await sendMaterialCard(ctx, m.id);
  });

  bot.command("drafts", async (ctx) => {
    const posts = await db.post.findMany({ where: { status: { in: ["draft", "review", "failed", "publish_unknown"] } }, orderBy: { updatedAt: "desc" }, take: 10 });
    await ctx.reply(posts.length ? posts.map((p) => `• ${POST_STATUS_LABEL[p.status as PostStatus]}: ${escapeHtml(plain(p.body).slice(0, 80) || "(пусто)")}`).join("\n") : "Черновиков нет.", { parse_mode: "HTML" });
  });

  bot.command("queue", async (ctx) => {
    const posts = await db.post.findMany({ where: { status: { in: ["approved", "scheduled", "publishing"] } }, orderBy: { scheduledAt: "asc" }, take: 20 });
    await ctx.reply(
      posts.length
        ? posts.map((p) => `• ${p.scheduledAt ? p.scheduledAt.toLocaleString("ru-RU", { timeZone: "Europe/Moscow" }) : "сразу"}: ${escapeHtml(plain(p.body).slice(0, 80))}`).join("\n")
        : "Очередь пуста.",
      { parse_mode: "HTML" },
    );
  });

  bot.on("message", async (ctx) => {
    const msg = ctx.message;
    const inputs = messageToIntake(msg);
    if (!inputs.length) return ctx.reply("Этот тип сообщения пока не поддерживается.");
    for (const input of inputs) {
      const res = await intakeMaterial({ ...input, telegramUpdateId: ctx.updateRowId, actorUserId: ctx.appUser!.id });
      if (res.status === "album_part") continue; // карточка альбома уже отправлена на первое фото
      if (res.status === "duplicate") {
        await ctx.reply("Уже есть в архиве, заметку добавил к существующему материалу.", { reply_parameters: { message_id: msg.message_id } });
      }
      await sendMaterialCard(ctx, res.materialId, res.status === "created" ? "Сохранено." : undefined);
    }
  });

  bot.on("callback_query:data", async (ctx) => {
    const [action, id, extra] = ctx.callbackQuery.data.split(":");
    const user = ctx.appUser!;
    try {
      switch (action) {
        case "ap": {
          const post = await db.post.findUniqueOrThrow({ where: { id } });
          if (!post.contentHash.startsWith(extra)) throw new PostError("Текст изменился после отправки превью. Откройте пост заново");
          if (post.status === "draft") throw new PostError("Пост ещё черновик");
          await approvePost(id, { userId: user.id, via: "bot", scheduledFor: post.scheduledAt, expectedContentHash: post.contentHash });
          await ctx.answerCallbackQuery({ text: post.scheduledAt && post.scheduledAt > new Date() ? "Подтверждено, пост запланирован" : "Подтверждено, публикую" });
          await ctx.editMessageReplyMarkup({ reply_markup: undefined });
          break;
        }
        case "rj":
          await rejectPost(id, { userId: user.id, via: "bot" });
          await ctx.answerCallbackQuery({ text: "Отклонено" });
          await ctx.editMessageReplyMarkup({ reply_markup: undefined });
          break;
        case "md": {
          const post = await createPost({ materialIds: [id], actorUserId: user.id });
          await enqueueJob({ kind: "generate_draft", payload: { postId: post.id, notifyUserId: user.id }, dedupKey: `draft:${post.id}`, maxAttempts: 2 });
          await ctx.answerCallbackQuery({ text: "Черновик создан" });
          await ctx.reply(`Черновик создан. Варианты текста от AI появятся в Dashboard, когда модель ответит.\n${appUrl(`/posts/${post.id}`)}`);
          break;
        }
        case "ma":
          await setMaterialStatus(id, "archived", user.id);
          await ctx.answerCallbackQuery({ text: "В архиве" });
          await ctx.editMessageReplyMarkup({ reply_markup: undefined });
          break;
        case "mx":
          await ctx.answerCallbackQuery();
          await ctx.reply("Удалить материал? Его можно будет восстановить из Dashboard до окончательной очистки.", {
            reply_markup: new InlineKeyboard().text("Да, удалить", `my:${id}`).text("Отмена", "no:"),
          });
          break;
        case "my":
          await softDeleteMaterial(id, user.id);
          await ctx.answerCallbackQuery({ text: "Удалено" });
          await ctx.editMessageText("Материал удалён.");
          break;
        case "no":
          await ctx.answerCallbackQuery({ text: "Отменено" });
          await ctx.deleteMessage().catch(() => undefined);
          break;
        default:
          await ctx.answerCallbackQuery({ text: "Неизвестное действие" });
      }
    } catch (e) {
      const text = e instanceof PostError ? e.message : "Не получилось. Подробности в журнале";
      if (!(e instanceof PostError)) logger.error({ err: errorMessage(e), action }, "bot_callback_failed");
      await ctx.answerCallbackQuery({ text: text.slice(0, 190), show_alert: true });
    }
  });

  bot.catch((err) => logger.error({ err: errorMessage(err.error), updateId: err.ctx.update.update_id }, "bot_error"));
  return bot;
}

function plain(html: string) {
  return html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function appUrl(path: string) {
  return `${process.env.APP_URL ?? "http://localhost:3000"}${path}`;
}

async function sendMaterialCard(ctx: Ctx, materialId: string, header?: string) {
  const m = await db.material.findUniqueOrThrow({ where: { id: materialId }, include: { category: true } });
  const lines = [
    header && `<b>${escapeHtml(header)}</b>`,
    m.title && escapeHtml(m.title),
    m.originalUrl && escapeHtml(m.originalUrl),
    !m.originalUrl && m.text && escapeHtml(m.text.slice(0, 200)),
    m.category ? `Категория: ${escapeHtml(m.category.name)}${m.categorySetBy === "ai" ? " (предложил AI)" : ""}` : "Категория: определяется…",
  ].filter(Boolean);
  await ctx.reply(lines.join("\n"), {
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    reply_markup: new InlineKeyboard().text("Черновик", `md:${m.id}`).text("В архив", `ma:${m.id}`).text("Удалить", `mx:${m.id}`),
  });
}

/** Превращает сообщение Telegram в один или несколько материалов. Чистая функция, покрыта тестами. */
export function messageToIntake(msg: Message): Omit<IntakeInput, "telegramUpdateId" | "actorUserId">[] {
  const caption = msg.caption ?? null;
  const origin = msg.forward_origin;
  const sourceName =
    origin?.type === "channel" ? origin.chat.title ?? origin.chat.username ?? null : origin?.type === "user" ? "Пересланное сообщение" : origin?.type === "hidden_user" ? origin.sender_user_name : null;
  const forwardUrl = origin?.type === "channel" && origin.chat.username ? `https://t.me/${origin.chat.username}/${origin.message_id}` : null;
  const base = { sourceKind: "telegram_bot" as const, sourceName };

  const file = (kind: IncomingAttachment["kind"], f: { file_id: string; file_unique_id: string; file_size?: number; mime_type?: string; file_name?: string }): IncomingAttachment => ({
    kind,
    telegramFileId: f.file_id,
    telegramFileUniqueId: f.file_unique_id,
    sizeBytes: f.file_size ?? null,
    mime: f.mime_type ?? null,
    fileName: f.file_name ?? null,
  });

  let att: IncomingAttachment | null = null;
  let type: IntakeInput["type"] | null = null;
  if (msg.photo?.length) {
    const biggest = msg.photo[msg.photo.length - 1];
    att = file("image", { ...biggest, mime_type: "image/jpeg", file_name: `photo_${msg.message_id}.jpg` });
    type = "image";
  } else if (msg.video) {
    att = file("video", msg.video);
    type = "video";
  } else if (msg.animation) {
    att = file("video", msg.animation);
    type = "video";
  } else if (msg.document) {
    att = file(msg.document.mime_type?.startsWith("image/") ? "image" : "document", msg.document);
    type = msg.document.mime_type?.startsWith("image/") ? "image" : "document";
  } else if (msg.voice) {
    att = file("voice", { ...msg.voice, file_name: `voice_${msg.message_id}.ogg` });
    type = "voice";
  } else if (msg.audio) {
    att = file("audio", msg.audio);
    type = "voice";
  }
  if (att && type) {
    return [{ ...base, type: forwardUrl ? "forward" : type, url: forwardUrl, text: caption, attachments: [att], mediaGroupId: msg.media_group_id ?? null }];
  }

  const text = msg.text?.trim();
  if (!text) return [];
  const urls = extractUrls(text);
  if (forwardUrl) return [{ ...base, type: "forward", url: forwardUrl, text }];
  if (!urls.length) return [{ ...base, type: "text", text }];
  // текст вокруг ссылок считаем заметкой автора
  let note = text;
  for (const u of urls) note = note.replace(u, "");
  note = note.replace(/\s+/g, " ").trim();
  return urls.map((url) => ({ ...base, type: "link" as const, url, ownerNote: note || null }));
}

/** Превью поста на проверку с кнопками. Вызывается worker-ом. */
export async function sendReviewRequest(api: Bot["api"], postId: string) {
  const post = await db.post.findUniqueOrThrow({ where: { id: postId }, include: { channel: true } });
  if (post.status !== "review") return;
  const approvers = await db.user.findMany({ where: { isActive: true, canApprove: true } });
  const when = post.scheduledAt ? `\nВремя: ${post.scheduledAt.toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })} (МСК)` : "\nВремя: сразу после подтверждения";
  const kb = new InlineKeyboard().text("Подтвердить", `ap:${post.id}:${post.contentHash.slice(0, 16)}`).text("Отклонить", `rj:${post.id}`);
  // Telegram не принимает localhost в URL-кнопках
  if (!/^https?:\/\/(localhost|127\.)/.test(appUrl(""))) kb.row().url("Открыть в Dashboard", appUrl(`/posts/${post.id}`));
  for (const u of approvers) {
    await api.sendMessage(Number(u.telegramUserId), `<b>На проверку</b> → ${escapeHtml(post.channel?.title ?? "канал не выбран")}${when}\n\nНиже превью: так пост будет выглядеть в канале.`, { parse_mode: "HTML" });
    await api.sendMessage(Number(u.telegramUserId), post.body || "(пусто)", { parse_mode: "HTML", reply_markup: kb });
  }
}
