import { db } from "../../src/lib/db";
import { createLoginToken } from "../../src/core/auth/sessions";

(async () => {
  const u = await db.user.findFirstOrThrow({ where: { role: "owner" } });
  console.log(await createLoginToken(u.id));
  await db.$disconnect();
})();
