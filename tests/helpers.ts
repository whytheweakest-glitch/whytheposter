import { db } from "@/lib/db";
import { DEFAULT_CATEGORIES } from "@/core/categories/defaults";
import type { TelegramPublisherApi, SentMessage } from "@/core/telegram/api";

export async function resetDb() {
  const tables = ["post_materials", "publish_attempts", "approvals", "drafts", "attachments", "ideas", "posts", "materials", "telegram_updates", "sources", "ai_generations", "jobs", "activity_logs", "settings", "sessions", "login_tokens", "users", "channels", "categories", "reference_posts"];
  for (const t of tables) await db.$executeRawUnsafe(`DELETE FROM "${t}"`);
}

export async function seed() {
  for (const [i, c] of DEFAULT_CATEGORIES.entries()) await db.category.create({ data: { ...c, sortOrder: i } });
  const owner = await db.user.create({ data: { telegramUserId: 111n, displayName: "WHYTHEWEAKEST", role: "owner", canApprove: true } });
  const admin = await db.user.create({ data: { telegramUserId: 222n, displayName: "helper", role: "admin", canApprove: false } });
  const test = await db.channel.create({ data: { telegramChatId: -1001n, title: "Тест", kind: "test", isPublishEnabled: true } });
  const main = await db.channel.create({ data: { telegramChatId: -1002n, title: "Основной", kind: "main", isPublishEnabled: false } });
  return { owner, admin, test, main };
}

export class FakeTelegram implements TelegramPublisherApi {
  calls: { method: string; chatId: string; text: string }[] = [];
  next: (() => Promise<SentMessage>) | null = null;
  private id = 100;
  async sendMessage(chatId: string, html: string) {
    this.calls.push({ method: "sendMessage", chatId, text: html });
    if (this.next) return this.next();
    return { message_id: ++this.id, chat: { id: Number(chatId), username: "wtw_test" } };
  }
  async sendPhoto(chatId: string, _p: { data: Buffer; fileName: string }, caption: string) {
    this.calls.push({ method: "sendPhoto", chatId, text: caption });
    if (this.next) return this.next();
    return { message_id: ++this.id, chat: { id: Number(chatId) } };
  }
}
