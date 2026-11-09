import { NextResponse, type NextRequest } from "next/server";
import { consumeLoginToken, SESSION_COOKIE } from "@/core/auth/sessions";

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const session = await consumeLoginToken(token, req.headers.get("user-agent"));
  if (!session) return NextResponse.redirect(new URL("/login?error=expired", req.url));
  const res = NextResponse.redirect(new URL("/", req.url));
  res.cookies.set(SESSION_COOKIE, session.sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: req.nextUrl.protocol === "https:",
    path: "/",
    expires: session.expiresAt,
  });
  return res;
}
