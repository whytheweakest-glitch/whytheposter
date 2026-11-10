/**
 * Проверка перед первым запуском: npm run setup:check -- @тестовый_канал
 *  1. токен бота рабочий;
 *  2. показывает Telegram ID тех, кто недавно писал боту (напишите боту любое сообщение перед запуском);
 *  3. находит ID тестового канала и проверяет, что бот там администратор с правом публикации.
 * Ничего не публикует. Запускайте, пока `npm run bot` остановлен, иначе бот заберёт сообщения раньше.
 */
type Res<T> = { ok: boolean; result?: T; description?: string };

const token = process.env.TELEGRAM_BOT_TOKEN;
const api = process.env.TELEGRAM_API_URL ?? "https://api.telegram.org";

async function call<T>(method: string, params: Record<string, unknown> = {}): Promise<Res<T>> {
  const res = await fetch(`${api}/bot${token}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(params), signal: AbortSignal.timeout(15_000) });
  return (await res.json()) as Res<T>;
}

const ok = (s: string) => console.log(`  ✓ ${s}`);
const bad = (s: string) => {
  console.log(`  ✗ ${s}`);
  process.exitCode = 1;
};

async function main() {
  if (!token) return bad("TELEGRAM_BOT_TOKEN не задан в .env");
  console.log("Бот");
  const me = await call<{ id: number; username: string }>("getMe");
  if (!me.ok || !me.result) return bad(`токен не принят Telegram: ${me.description}`);
  ok(`@${me.result.username}`);

  console.log("\nКто писал боту (OWNER_TELEGRAM_IDS)");
  const upd = await call<{ message?: { from?: { id: number; username?: string; first_name?: string }; text?: string } }[]>("getUpdates", { limit: 50, timeout: 0, allowed_updates: ["message"] });
  const senders = new Map<number, string>();
  for (const u of upd.result ?? []) if (u.message?.from) senders.set(u.message.from.id, u.message.from.username ? `@${u.message.from.username}` : (u.message.from.first_name ?? ""));
  if (!senders.size) console.log("  Сообщений нет. Напишите боту любое сообщение и запустите проверку ещё раз.");
  for (const [id, name] of senders) console.log(`  ${id}  ${name}`);
  if (process.env.OWNER_TELEGRAM_IDS) ok(`в .env уже указано: ${process.env.OWNER_TELEGRAM_IDS}`);

  const channelArg = process.argv[2] ?? process.env.TEST_CHANNEL_ID;
  console.log("\nТестовый канал");
  if (!channelArg) return console.log("  Укажите канал: npm run setup:check -- @имя_канала");
  const chatId = /^-?\d+$/.test(channelArg) ? channelArg : "@" + channelArg.replace(/^https?:\/\/t\.me\//, "").replace(/^@/, "");
  const chat = await call<{ id: number; title: string; type: string }>("getChat", { chat_id: chatId });
  if (!chat.ok || !chat.result) return bad(`канал не найден или бот не добавлен: ${chat.description}`);
  ok(`«${chat.result.title}», TEST_CHANNEL_ID=${chat.result.id}`);
  const member = await call<{ status: string; can_post_messages?: boolean }>("getChatMember", { chat_id: chat.result.id, user_id: me.result.id });
  if (!member.ok || !member.result) return bad(`не удалось проверить права бота: ${member.description}`);
  if (member.result.status !== "administrator") bad(`бот не администратор канала (статус: ${member.result.status})`);
  else if (member.result.can_post_messages === false) bad("бот администратор, но без права «Публикация сообщений»");
  else ok("бот администратор с правом публикации");
  if (process.env.TEST_CHANNEL_ID && process.env.TEST_CHANNEL_ID !== String(chat.result.id)) bad(`в .env TEST_CHANNEL_ID=${process.env.TEST_CHANNEL_ID}, а у канала ${chat.result.id}`);
}

main().catch((e) => bad(e instanceof Error ? e.message.replace(/bot\d+:[\w-]+/g, "bot[redacted]") : String(e)));
