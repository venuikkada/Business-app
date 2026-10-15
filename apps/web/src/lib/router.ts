import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { AppError, auth, businesses, withTenant, idempotent, env, type Tenant, type AuthUser, type AuthSession, type ClientMeta } from "@cba/server";
import { SESSION_COOKIE, BUSINESS_COOKIE } from "./session";

export type Level = "public" | "user" | "tenant";

export interface Ctx {
  req: NextRequest;
  params: Record<string, string>;
  query: Record<string, string>;
  meta: ClientMeta;
  body: () => Promise<unknown>;
  raw: () => Promise<string>;
  user: AuthUser;
  session: AuthSession;
  token: string;
  t: Tenant;
  viaCookie: boolean;
}

type Handler = (c: Ctx) => Promise<unknown>;
interface Route {
  method: string;
  segments: string[];
  level: Level;
  handler: Handler;
  idempotent: boolean;
}

export class Router {
  private routes: Route[] = [];
  add(method: string, pattern: string, level: Level, handler: Handler, opts: { idempotent?: boolean } = {}) {
    this.routes.push({ method, segments: pattern.split("/").filter(Boolean), level, handler, idempotent: opts.idempotent ?? (method === "POST" && level === "tenant") });
    return this;
  }
  get = (p: string, l: Level, h: Handler) => this.add("GET", p, l, h);
  post = (p: string, l: Level, h: Handler, o?: { idempotent?: boolean }) => this.add("POST", p, l, h, o);
  put = (p: string, l: Level, h: Handler) => this.add("PUT", p, l, h);
  patch = (p: string, l: Level, h: Handler) => this.add("PATCH", p, l, h);
  del = (p: string, l: Level, h: Handler) => this.add("DELETE", p, l, h);

  match(method: string, path: string[]) {
    let methodMismatch = false;
    for (const r of this.routes) {
      if (r.segments.length !== path.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < path.length; i++) {
        const s = r.segments[i]!;
        if (s.startsWith(":")) params[s.slice(1)] = decodeURIComponent(path[i]!);
        else if (s !== path[i]) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      if (r.method !== method) {
        methodMismatch = true;
        continue;
      }
      return { route: r, params };
    }
    return methodMismatch ? "method" : null;
  }
}

export function errorResponse(code: string, message: string, status: number, details?: unknown) {
  return NextResponse.json({ error: { code, message, details } }, { status, headers: { "cache-control": "no-store" } });
}

function metaFrom(req: NextRequest): ClientMeta {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || req.headers.get("x-real-ip") || null;
  return { ip: ip && /^[0-9a-fA-F:.]{3,45}$/.test(ip) ? ip : null, userAgent: req.headers.get("user-agent") };
}

/** Cookie-authenticated writes must come from our own origin with the custom header. */
function csrfOk(req: NextRequest): boolean {
  if (req.headers.get("x-cba-csrf") !== "1") return false;
  const origin = req.headers.get("origin");
  if (!origin) return true; // same-origin fetch from older browsers; header check still applies
  try {
    const o = new URL(origin);
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    return o.host === host || origin === env.appUrl;
  } catch {
    return false;
  }
}

export function toResponse(e: unknown) {
  if (e instanceof AppError) return errorResponse(e.code, e.message, e.status, e.details);
  if (e instanceof ZodError) {
    const first = e.issues[0];
    return errorResponse("VALIDATION", first ? `${first.path.join(".") || "input"}: ${first.message}` : "Invalid input", 422, { issues: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
  }
  if (e instanceof SyntaxError) return errorResponse("VALIDATION", "Malformed JSON body", 400);
  // Never leak internals to the client.
  console.error("[api] unhandled error", e);
  return errorResponse("INTERNAL", "Something went wrong. Please try again.", 500);
}

export async function dispatch(router: Router, req: NextRequest, path: string[]) {
  const m = router.match(req.method, path);
  if (m === "method") return errorResponse("NOT_FOUND", "Method not allowed", 405);
  if (!m) return errorResponse("NOT_FOUND", "Unknown endpoint", 404);
  const { route, params } = m;
  let rawCache: string | null = null;
  const raw = async () => (rawCache ??= await req.text());
  const body = async () => {
    const r = await raw();
    if (!r) return {};
    if (r.length > 2_000_000) throw new AppError("VALIDATION", "Request body too large");
    return JSON.parse(r) as unknown;
  };
  const ctx = { req, params, query: Object.fromEntries(req.nextUrl.searchParams), meta: metaFrom(req), body, raw } as Ctx;
  try {
    if (route.level !== "public") {
      const bearer = /^Bearer (cba_[\w-]+)$/.exec(req.headers.get("authorization") ?? "")?.[1];
      const cookie = req.cookies.get(SESSION_COOKIE)?.value;
      const token = bearer ?? cookie;
      const a = await auth.authenticate(token);
      if (!a || a.session.kind === "admin") return errorResponse("UNAUTHENTICATED", "Please sign in", 401);
      ctx.viaCookie = !bearer;
      if (ctx.viaCookie && req.method !== "GET" && req.method !== "HEAD" && !csrfOk(req)) return errorResponse("FORBIDDEN", "Cross-site request blocked", 403);
      ctx.user = a.user;
      ctx.session = a.session;
      ctx.token = token!;
    }
    let result: unknown;
    if (route.level === "tenant") {
      let businessId = req.headers.get("x-business-id") ?? req.cookies.get(BUSINESS_COOKIE)?.value;
      if (!businessId) {
        // Single-business users do not need to pick one.
        const mine = await businesses.listMyBusinesses(ctx.user);
        if (mine.length === 1) businessId = mine[0]!.id;
        else return errorResponse("FORBIDDEN", mine.length ? "Select a business first" : "Create a business first", 403);
      }
      result = await withTenant(ctx.user, businessId, ctx.meta, async (t) => {
        ctx.t = t;
        const key = req.headers.get("idempotency-key");
        if (route.idempotent && key) return idempotent(t, key, { p: path.join("/"), b: await raw() }, () => route.handler(ctx));
        return route.handler(ctx);
      });
    } else {
      result = await route.handler(ctx);
    }
    if (result instanceof Response) return result;
    return NextResponse.json(result ?? { ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return toResponse(e);
  }
}

export function fileResponse(data: Buffer, mime: string, filename: string, inline = false) {
  return new Response(new Uint8Array(data), {
    headers: {
      "content-type": mime,
      "content-length": String(data.length),
      "content-disposition": `${inline ? "inline" : "attachment"}; filename="${filename.replace(/[^\w.\-]/g, "_")}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export function sessionCookie(token: string, expiresAt: string) {
  return {
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    secure: env.isProd,
    sameSite: "lax" as const,
    path: "/",
    expires: new Date(expiresAt),
  };
}
