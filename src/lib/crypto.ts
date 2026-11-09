import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const sha256 = (v: string | Buffer) => createHash("sha256").update(v).digest("hex");
export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");
export const hmacHex = (secret: string, payload: string) => createHmac("sha256", secret).update(payload).digest("hex");

export function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
