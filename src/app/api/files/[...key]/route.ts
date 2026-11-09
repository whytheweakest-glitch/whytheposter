import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { readStoredFile } from "@/core/storage/files";
import { currentUser } from "@/lib/web/auth";

/** Отдаёт вложения только авторизованному пользователю. */
export async function GET(_req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  if (!(await currentUser())) return new NextResponse("Unauthorized", { status: 401 });
  const key = (await params).key.join("/");
  const att = await db.attachment.findFirst({ where: { storageKey: key, deletedAt: null } });
  if (!att) return new NextResponse("Not found", { status: 404 });
  const data = await readStoredFile(key);
  return new NextResponse(new Uint8Array(data), { headers: { "content-type": att.mime ?? "application/octet-stream", "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff", "content-disposition": "inline" } });
}
