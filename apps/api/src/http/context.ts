import type { Request } from "express";
import type { TenantDb } from "../db/pool.js";

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
  requestId: string;
}

export interface UserCtx {
  kind: "user";
  meta: RequestMeta;
  userId: number;
  sessionId: number;
  sessionTenantId: number | null;
  user: { id: number; name: string; mobile: string | null; email: string | null; language: string };
}

export interface TenantInfo {
  id: number;
  name: string;
  sector: string;
  stateCode: string;
  fyStartMonth: number;
  subscriptionStatus: string;
}

export interface TenantCtx extends Omit<UserCtx, "kind"> {
  kind: "tenant";
  tenantId: number;
  tdb: TenantDb;
  tenant: TenantInfo;
  membershipId: number;
  role: { id: number; key: string; name: string };
  permissions: Set<string>;
  /** null = may use every branch */
  branchIds: number[] | null;
}

export function requestMeta(req: Request): RequestMeta {
  return {
    ip: req.ip ?? null,
    userAgent: (req.get("user-agent") ?? "").slice(0, 255) || null,
    requestId: (req as any).requestId ?? "",
  };
}

export function can(ctx: TenantCtx, perm: string): boolean {
  return ctx.permissions.has(perm);
}

/** Throws unless the user may work in this branch. */
export function canUseBranch(ctx: TenantCtx, branchId: number): boolean {
  return ctx.branchIds === null || ctx.branchIds.includes(branchId);
}
