import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { AppError, env } from "@cba/server";
import * as P from "@cba/server/platform";
import { ADMIN_COOKIE } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function err(code: string, message: string, status: number, details?: unknown) {
  return NextResponse.json({ error: { code, message, details } }, { status, headers: { "cache-control": "no-store" } });
}

function meta(req: NextRequest) {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || null;
  return { ip: ip && /^[0-9a-fA-F:.]{3,45}$/.test(ip) ? ip : null, userAgent: req.headers.get("user-agent") };
}

type Ctx = { req: NextRequest; body: Record<string, unknown>; id?: string; admin: P.AdminCtx };
type H = (c: Ctx) => Promise<unknown>;
const routes: Array<{ m: string; p: RegExp; level: "public" | "setup" | "admin"; h: H }> = [];
const on = (m: string, p: string, level: "public" | "setup" | "admin", h: H) => routes.push({ m, p: new RegExp(`^${p.replace(":id", "([0-9a-f-]{36})")}$`), level, h });

on("POST", "login", "public", async (c) => {
  const r = await P.adminLogin(c.body as never, meta(c.req));
  const res = NextResponse.json({ ok: true, mfaVerified: r.session.mfaVerified });
  res.cookies.set({ name: ADMIN_COOKIE, value: r.token, httpOnly: true, secure: env.isProd, sameSite: "strict", path: "/", expires: new Date(r.session.expiresAt) });
  return res;
});
on("POST", "logout", "setup", async (c) => {
  const token = c.req.cookies.get(ADMIN_COOKIE)?.value;
  if (token) await P.adminLogout(token);
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(ADMIN_COOKIE);
  return res;
});
on("POST", "totp/begin", "setup", (c) => P.adminBeginTotp(c.admin.user.id));
on("POST", "totp/confirm", "setup", async (c) => {
  await P.adminConfirmTotp(c.admin.user.id, c.admin.session.id, String(c.body.code ?? ""));
  return { ok: true };
});
on("POST", "businesses/:id/status", "admin", async (c) => {
  await P.setBusinessStatus(c.admin, c.id!, c.body.status === "active" ? "active" : "suspended", String(c.body.reason ?? ""));
  return { ok: true };
});
on("POST", "businesses/:id/subscription", "admin", async (c) => {
  await P.overrideSubscription(c.admin, c.id!, c.body as never);
  return { ok: true };
});
on("POST", "businesses/:id/support-access", "admin", (c) => P.requestSupportAccess(c.admin, c.id!, String(c.body.reason ?? "")));
on("POST", "plans", "admin", async (c) => {
  await P.savePlan(c.admin, c.body as never);
  return { ok: true };
});
on("POST", "settings", "admin", async (c) => {
  await P.setPlatformSetting(c.admin, String(c.body.key ?? ""), c.body.value);
  return { ok: true };
});
on("POST", "users/:id/status", "admin", async (c) => {
  await P.setUserStatus(c.admin, c.id!, c.body.status === "active" ? "active" : "disabled", String(c.body.reason ?? ""));
  return { ok: true };
});
on("POST", "support/:id/reply", "admin", async (c) => {
  await P.replySupportTicketAdmin(c.admin, c.id!, String(c.body.body ?? ""), !!c.body.close);
  return { ok: true };
});
on("POST", "jobs/daily", "admin", () => P.runDailyJobs());

async function handle(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const path = (await params).path.join("/");
  const r = routes.find((x) => x.m === req.method && x.p.test(path));
  if (!r) return err("NOT_FOUND", "Unknown endpoint", 404);
  // Same-origin only: custom header + matching Origin.
  if (req.headers.get("x-cba-csrf") !== "1") return err("FORBIDDEN", "Cross-site request blocked", 403);
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host")) return err("FORBIDDEN", "Cross-site request blocked", 403);
  try {
    const raw = await req.text();
    const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    const ctx = { req, body, id: r.p.exec(path)?.[1] } as Ctx;
    if (r.level !== "public") {
      const a = await P.authenticateAdmin(req.cookies.get(ADMIN_COOKIE)?.value, meta(req), r.level === "setup");
      if (!a) return err("UNAUTHENTICATED", "Sign in again", 401);
      ctx.admin = a;
    }
    const out = await r.h(ctx);
    return out instanceof Response ? out : NextResponse.json(out ?? { ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    if (e instanceof AppError) return err(e.code, e.message, e.status, e.details);
    if (e instanceof ZodError) return err("VALIDATION", e.issues[0] ? `${e.issues[0].path.join(".")}: ${e.issues[0].message}` : "Invalid input", 422);
    console.error("[admin-api]", e);
    return err("INTERNAL", "Something went wrong", 500);
  }
}

export const POST = handle;
