import type { Request } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { db, getPool, json, TenantDb } from "../db/pool.js";
import { forbidden, unauthorized, AppError } from "../lib/errors.js";
import { effectivePermissions } from "../lib/permissions.js";
import { requestMeta, type TenantCtx, type UserCtx } from "./context.js";

export const COOKIE_ACCESS = "ba_at";
export const COOKIE_REFRESH = "ba_rt";
export const COOKIE_CSRF = "ba_csrf";
export const JWT_ISSUER = "bizapp";
export const JWT_AUDIENCE = "bizapp-web";

interface AccessClaims {
  sub: string;
  sid: number;
}

export async function resolveUser(req: Request): Promise<UserCtx> {
  const token = req.cookies?.[COOKIE_ACCESS];
  if (!token) throw unauthorized("no_session", "Please sign in.");
  let claims: AccessClaims;
  try {
    claims = jwt.verify(token, env().JWT_SECRET, {
      algorithms: ["HS256"],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    }) as unknown as AccessClaims;
  } catch (e: any) {
    throw unauthorized(e?.name === "TokenExpiredError" ? "token_expired" : "invalid_token", "Please sign in again.");
  }
  const row = await db().one(
    `SELECT s.id, s.user_id, s.tenant_id, s.revoked_at, s.expires_at, s.last_seen_at,
            u.status, u.name, u.mobile, u.email, u.language
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = :sid AND s.user_id = :uid`,
    { sid: claims.sid, uid: Number(claims.sub) },
  );
  if (!row || row.revoked_at || new Date(row.expires_at) < new Date() || row.status !== "active") {
    throw unauthorized("session_revoked", "This device was signed out. Please sign in again.");
  }
  // Update "last seen" at most every 5 minutes to avoid a write per request.
  if (Date.now() - new Date(row.last_seen_at).getTime() > 5 * 60_000) {
    db().exec("UPDATE sessions SET last_seen_at = CURRENT_TIMESTAMP(3), ip = :ip WHERE id = :id", { id: row.id, ip: req.ip ?? null }).catch(() => {});
  }
  return {
    kind: "user",
    meta: requestMeta(req),
    userId: Number(row.user_id),
    sessionId: Number(row.id),
    sessionTenantId: row.tenant_id ? Number(row.tenant_id) : null,
    user: { id: Number(row.user_id), name: row.name, mobile: row.mobile, email: row.email, language: row.language },
  };
}

/**
 * The open business comes from the X-Tenant-Id header (one per browser tab) or the
 * session. Membership, role and branch access are re-checked on every request.
 */
export async function resolveTenant(req: Request, u: UserCtx): Promise<TenantCtx> {
  const header = req.get("x-tenant-id");
  const tenantId = header && /^\d{1,18}$/.test(header) ? Number(header) : u.sessionTenantId;
  if (!tenantId) throw forbidden("no_business_selected", "Open a business first.");
  const row = await db().one(
    `SELECT m.id AS membership_id, m.status AS m_status, m.all_branches,
            r.id AS role_id, r.role_key, r.name AS role_name, r.permissions,
            t.name AS t_name, t.status AS t_status, t.sector, t.state_code, t.fy_start_month,
            t.subscription_status
       FROM memberships m
       JOIN roles r   ON r.id = m.role_id AND r.tenant_id = m.tenant_id
       JOIN tenants t ON t.id = m.tenant_id
      WHERE m.tenant_id = :tenantId AND m.user_id = :userId`,
    { tenantId, userId: u.userId },
  );
  if (!row || row.m_status !== "active") throw forbidden("no_business_access", "You do not have access to this business.");
  if (row.t_status !== "active") throw forbidden("business_suspended", "This business is not active.");
  let branchIds: number[] | null = null;
  if (!row.all_branches) {
    const rows = await db().all(
      "SELECT branch_id FROM membership_branches WHERE tenant_id = :tenantId AND membership_id = :mid",
      { tenantId, mid: row.membership_id },
    );
    branchIds = rows.map((r) => Number(r.branch_id));
  }
  return {
    ...u,
    kind: "tenant",
    tenantId,
    tdb: new TenantDb(getPool(), tenantId),
    tenant: {
      id: tenantId,
      name: row.t_name,
      sector: row.sector,
      stateCode: row.state_code,
      fyStartMonth: Number(row.fy_start_month),
      subscriptionStatus: row.subscription_status,
    },
    membershipId: Number(row.membership_id),
    role: { id: Number(row.role_id), key: row.role_key, name: row.role_name },
    permissions: new Set(effectivePermissions(row.role_key, json<string[]>(row.permissions, []))),
    branchIds,
  };
}

export function requirePermission(ctx: TenantCtx, perm: string | string[]) {
  const list = Array.isArray(perm) ? perm : [perm];
  if (!list.some((p) => ctx.permissions.has(p))) {
    throw new AppError(403, "permission_denied", "Your role does not allow this.", { needs: list });
  }
}
