import { z } from "zod";
import { errorMessage } from "@/lib/logger";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export interface AiProvider {
  readonly name: string;
  readonly model: string;
  /** Возвращает JSON, проверенный схемой. Невалидный ответ это ошибка, а не мусор в БД. */
  json<T>(messages: ChatMessage[], schema: z.ZodType<T>, jsonSchema: Record<string, unknown>): Promise<T>;
  ping(): Promise<boolean>;
}

export class AiUnavailableError extends Error {}
export class AiInvalidOutputError extends Error {}

/** Локальная модель через Ollama (http://127.0.0.1:11434). Токены не тратятся. */
export class OllamaProvider implements AiProvider {
  readonly name = "ollama";
  constructor(public readonly model: string, private baseUrl: string, private timeoutMs = 120_000) {}

  async json<T>(messages: ChatMessage[], schema: z.ZodType<T>, jsonSchema: Record<string, unknown>): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: this.model, messages, stream: false, format: jsonSchema, options: { temperature: 0.7 } }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      throw new AiUnavailableError(`Ollama недоступна: ${errorMessage(e)}`);
    }
    if (!res.ok) throw new AiUnavailableError(`Ollama ответила ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const body = (await res.json()) as { message?: { content?: string } };
    let parsed: unknown;
    try {
      parsed = JSON.parse(body.message?.content ?? "");
    } catch {
      throw new AiInvalidOutputError("Модель вернула не JSON");
    }
    const r = schema.safeParse(parsed);
    if (!r.success) throw new AiInvalidOutputError(`Ответ модели не прошёл проверку: ${r.error.issues[0]?.message}`);
    return r.data;
  }

  async ping() {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
      return res.ok;
    } catch {
      return false;
    }
  }
}

let override: AiProvider | null | undefined;
/** Для тестов. */
export function setAiProvider(p: AiProvider | null | undefined) {
  override = p;
}

export function getAiProvider(): AiProvider | null {
  if (override !== undefined) return override;
  if ((process.env.AI_PROVIDER ?? "ollama") === "disabled") return null;
  return new OllamaProvider(process.env.AI_MODEL ?? "qwen2.5:7b-instruct", process.env.OLLAMA_URL ?? "http://127.0.0.1:11434", Number(process.env.AI_TIMEOUT_MS ?? 120_000));
}
