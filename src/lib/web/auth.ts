import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, userBySessionToken } from "@/core/auth/sessions";

/** Проверка сессии на сервере для каждой страницы и каждого действия. */
export async function currentUser() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return userBySessionToken(token);
}

export async function requireUser() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}
