import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth, withTenant, AppError, businesses, type Tenant, type ClientMeta } from "@cba/server";

export const SESSION_COOKIE = "cba_session";
export const BUSINESS_COOKIE = "cba_biz";

export async function clientMeta(): Promise<ClientMeta> {
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || h.get("x-real-ip") || null;
  return { ip: ip && /^[0-9a-fA-F:.]{3,45}$/.test(ip) ? ip : null, userAgent: h.get("user-agent") };
}

/** Current signed-in user (cached for the duration of one request). */
export const getAuth = cache(async () => {
  const c = await cookies();
  return auth.authenticate(c.get(SESSION_COOKIE)?.value);
});

export async function requireAuth() {
  const a = await getAuth();
  if (!a) redirect("/login");
  return a;
}

export const getBusinessId = cache(async () => (await cookies()).get(BUSINESS_COOKIE)?.value ?? null);

export const getMyBusinesses = cache(async () => {
  const a = await getAuth();
  return a ? businesses.listMyBusinesses(a.user) : [];
});

/**
 * Runs `fn` in the selected business. Redirects to onboarding / business
 * picker when no business is selected or membership is gone.
 */
export async function tenant<T>(fn: (t: Tenant) => Promise<T>): Promise<T> {
  const a = await requireAuth();
  let bid = await getBusinessId();
  const mine = await getMyBusinesses();
  if (!mine.length) redirect("/onboarding");
  if (!bid || !mine.some((b) => b.id === bid)) {
    if (mine.length === 1) bid = mine[0]!.id;
    else redirect("/select-business");
  }
  try {
    return await withTenant(a.user, bid!, await clientMeta(), fn);
  } catch (e) {
    if (e instanceof AppError && e.code === "FORBIDDEN" && /not a member|Select a business/.test(e.message)) redirect("/select-business");
    throw e;
  }
}

/** For pages: turns permission/plan errors into a friendly page instead of a crash. */
export async function tenantOrError<T>(fn: (t: Tenant) => Promise<T>): Promise<{ ok: true; data: T } | { ok: false; code: string; message: string }> {
  try {
    return { ok: true, data: await tenant(fn) };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, code: e.code, message: e.message };
    throw e;
  }
}
