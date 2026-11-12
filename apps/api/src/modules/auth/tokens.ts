import type { Response } from "express";
import jwt from "jsonwebtoken";
import type { PoolConnection } from "mysql2/promise";
import { cookieSecure, env } from "../../config/env.js";
import { Db, db } from "../../db/pool.js";
import { randomToken, sha256 } from "../../lib/crypto.js";
import { addDaysDate } from "../../lib/dates.js";
import { COOKIE_ACCESS, COOKIE_REFRESH, JWT_AUDIENCE, JWT_ISSUER } from "../../http/auth-middleware.js";

export const ACCESS_TTL_SEC = 15 * 60; // 15 minutes
export const REFRESH_TTL_DAYS = 30; // idle limit: unused for 30 days -> sign in again
export const SESSION_MAX_DAYS = 90; // absolute limit per device
export const REUSE_GRACE_MS = 30_000; // two tabs refreshing at once is not an attack

export function signAccess(userId: number, sessionId: number): string {
  return jwt.sign({ sid: sessionId }, env().JWT_SECRET, {
    algorithm: "HS256",
    subject: String(userId),
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    expiresIn: ACCESS_TTL_SEC,
  });
}

export async function issueRefresh(d: Db, sessionId: number, sessionExpires: Date): Promise<string> {
  const token = randomToken(32);
  const idle = addDaysDate(new Date(), REFRESH_TTL_DAYS);
  await d.exec(
    "INSERT INTO refresh_tokens (session_id, token_hash, expires_at) VALUES (:sid, :hash, :exp)",
    { sid: sessionId, hash: sha256(token), exp: idle < sessionExpires ? idle : sessionExpires },
  );
  return token;
}

export function setAuthCookies(res: Response, access: string, refresh: string) {
  const secure = cookieSecure();
  res.cookie(COOKIE_ACCESS, access, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: ACCESS_TTL_SEC * 1000 });
  res.cookie(COOKIE_REFRESH, refresh, { httpOnly: true, secure, sameSite: "strict", path: "/api/v1/auth", maxAge: REFRESH_TTL_DAYS * 86_400_000 });
}

export function clearAuthCookies(res: Response) {
  const secure = cookieSecure();
  res.clearCookie(COOKIE_ACCESS, { httpOnly: true, secure, sameSite: "lax", path: "/" });
  res.clearCookie(COOKIE_REFRESH, { httpOnly: true, secure, sameSite: "strict", path: "/api/v1/auth" });
}

/** Creates a device session and returns the cookies to set. */
export async function createSession(
  conn: PoolConnection | null,
  userId: number,
  meta: { ip: string | null; userAgent: string | null },
): Promise<{ sessionId: number; access: string; refresh: string }> {
  const d = conn ? new Db(conn) : db();
  // Open the business automatically if the user has exactly one.
  const tenants = await d.all("SELECT tenant_id FROM memberships WHERE user_id = :uid AND status = 'active' LIMIT 2", { uid: userId });
  const expires = addDaysDate(new Date(), SESSION_MAX_DAYS);
  const r = await d.exec(
    `INSERT INTO sessions (user_id, tenant_id, user_agent, ip, expires_at)
     VALUES (:uid, :tid, :ua, :ip, :exp)`,
    { uid: userId, tid: tenants.length === 1 ? tenants[0].tenant_id : null, ua: meta.userAgent, ip: meta.ip, exp: expires },
  );
  const sessionId = r.insertId;
  const refresh = await issueRefresh(d, sessionId, expires);
  return { sessionId, access: signAccess(userId, sessionId), refresh };
}

export async function revokeSession(sessionId: number, reason: string) {
  await db().exec(
    "UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP(3), revoke_reason = :reason WHERE id = :id AND revoked_at IS NULL",
    { id: sessionId, reason },
  );
}

export async function revokeAllSessions(d: Db, userId: number, reason: string, exceptSessionId?: number) {
  await d.exec(
    `UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP(3), revoke_reason = :reason
      WHERE user_id = :uid AND revoked_at IS NULL AND id <> :except`,
    { uid: userId, reason, except: exceptSessionId ?? 0 },
  );
}
