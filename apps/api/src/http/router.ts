import { Router, type NextFunction, type Request, type RequestHandler, type Response } from "express";
import type { ZodType, ZodTypeDef } from "zod";
import { AppError } from "../lib/errors.js";
import { resolveTenant, resolveUser, requirePermission } from "./auth-middleware.js";
import { requestMeta, type RequestMeta, type TenantCtx, type UserCtx } from "./context.js";

/**
 * Every API route MUST say who may call it. There is no default:
 *  - { access: "public" }        no sign-in (login, OTP, health)
 *  - { access: "user" }          signed in, no business needed (profile, business list)
 *  - { perm: "team.view" }       signed in + member of the open business + this permission
 *  - { perm: ["a","b"] }         any one of these permissions
 *  - { perm: "any_member" }      any active member of the open business
 * The registry below is checked by an automated test.
 */
export type Access = { access: "public" } | { access: "user" } | { perm: string | string[] };

type CtxFor<A extends Access> = A extends { access: "public" } ? null : A extends { access: "user" } ? UserCtx : TenantCtx;

export interface RouteOptions<A extends Access, B, Q> {
  body?: ZodType<B, ZodTypeDef, unknown>;
  query?: ZodType<Q, ZodTypeDef, unknown>;
  /** extra middleware that runs after auth (e.g. multer upload) */
  before?: RequestHandler[];
  /** allow writes while the subscription is expired (billing, settings) */
  allowWhenExpired?: boolean;
  access: A;
}

export interface HandlerArgs<A extends Access, B, Q> {
  req: Request;
  res: Response;
  body: B;
  query: Q;
  params: Record<string, string>;
  ctx: CtxFor<A>;
  meta: RequestMeta;
}

export interface RegisteredRoute {
  method: string;
  path: string;
  access: "public" | "user" | "tenant";
  perm: string[] | null;
}

export const ROUTE_REGISTRY: RegisteredRoute[] = [];

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export class ApiRouter {
  readonly router = Router();
  constructor(private readonly prefix = "") {}

  get<A extends Access, Q = unknown>(path: string, o: RouteOptions<A, unknown, Q>, h: (a: HandlerArgs<A, unknown, Q>) => Promise<unknown>) {
    this.add("get", path, o, h);
  }
  post<A extends Access, B = unknown, Q = unknown>(path: string, o: RouteOptions<A, B, Q>, h: (a: HandlerArgs<A, B, Q>) => Promise<unknown>) {
    this.add("post", path, o, h);
  }
  patch<A extends Access, B = unknown, Q = unknown>(path: string, o: RouteOptions<A, B, Q>, h: (a: HandlerArgs<A, B, Q>) => Promise<unknown>) {
    this.add("patch", path, o, h);
  }
  put<A extends Access, B = unknown, Q = unknown>(path: string, o: RouteOptions<A, B, Q>, h: (a: HandlerArgs<A, B, Q>) => Promise<unknown>) {
    this.add("put", path, o, h);
  }
  delete<A extends Access, B = unknown, Q = unknown>(path: string, o: RouteOptions<A, B, Q>, h: (a: HandlerArgs<A, B, Q>) => Promise<unknown>) {
    this.add("delete", path, o, h);
  }

  private add<A extends Access, B, Q>(
    method: "get" | "post" | "patch" | "put" | "delete",
    path: string,
    o: RouteOptions<A, B, Q>,
    handler: (a: HandlerArgs<A, B, Q>) => Promise<unknown>,
  ) {
    const access = o.access as Access;
    const kind: RegisteredRoute["access"] = "access" in access ? access.access : "tenant";
    const perms = "perm" in access ? (Array.isArray(access.perm) ? access.perm : [access.perm]) : null;
    if (kind === "tenant" && (!perms || perms.length === 0)) throw new Error(`Route ${method} ${path} has no permission`);
    ROUTE_REGISTRY.push({ method: method.toUpperCase(), path: this.prefix + (path === "/" ? "" : path), access: kind, perm: perms });

    const auth = async (req: Request, _res: Response, next: NextFunction) => {
      if (kind === "public") return next();
      const user = await resolveUser(req);
      if (kind === "user") {
        (req as any).ctx = user;
        return next();
      }
      const ctx = await resolveTenant(req, user);
      if (perms && !(perms.length === 1 && perms[0] === "any_member")) requirePermission(ctx, perms);
      if (ctx.tenant.subscriptionStatus === "expired" && UNSAFE.has(req.method) && !o.allowWhenExpired) {
        throw new AppError(402, "subscription_expired", "Your plan has expired. Renew to keep adding records — your data is safe and still visible.");
      }
      (req as any).ctx = ctx;
      next();
    };

    const run = async (req: Request, res: Response) => {
      const body = o.body ? o.body.parse(req.body ?? {}) : (undefined as B);
      const query = o.query ? o.query.parse(req.query ?? {}) : (undefined as Q);
      const out = await handler({
        req,
        res,
        body,
        query,
        params: req.params as Record<string, string>,
        ctx: (req as any).ctx ?? null,
        meta: requestMeta(req),
      });
      if (res.headersSent) return;
      if (out === undefined) res.status(204).end();
      else res.json({ data: out });
    };

    this.router[method](path, auth, ...(o.before ?? []), run);
  }
}

/** Parses a numeric :id route parameter. */
export function idParam(params: Record<string, string>, name = "id"): number {
  const v = params[name];
  if (!v || !/^\d{1,18}$/.test(v)) throw new AppError(404, "not_found", "Record not found.");
  return Number(v);
}
