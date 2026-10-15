import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { authenticateAdmin, type AdminCtx } from "@cba/server/platform";

export const ADMIN_COOKIE = "cba_admin";

export async function adminMeta() {
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || null;
  return { ip: ip && /^[0-9a-fA-F:.]{3,45}$/.test(ip) ? ip : null, userAgent: h.get("user-agent") };
}

export const getAdmin = cache(async (allowSetup = false) => {
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  return authenticateAdmin(token, await adminMeta(), allowSetup);
});

/** For pages: requires a fully authenticated (TOTP-verified) platform admin. */
export async function requireAdmin(): Promise<AdminCtx> {
  const a = await getAdmin(false);
  if (a) return a;
  const pending = await getAdmin(true);
  redirect(pending ? "/setup-2fa" : "/login");
}
