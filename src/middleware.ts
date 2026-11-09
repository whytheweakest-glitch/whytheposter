import { NextResponse, type NextRequest } from "next/server";

/** Быстрый отсев без cookie. Настоящая проверка сессии в requireUser() на сервере. */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/login") || pathname === "/api/health") return NextResponse.next();
  if (!req.cookies.get("wtw_session")) return NextResponse.redirect(new URL("/login", req.url));
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/|favicon.ico).*)"] };
