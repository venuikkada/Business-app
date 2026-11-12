import { normalizeIndianPhone } from "@cba/core";
import { env } from "../../config/env.js";
import { Db, db, withTx } from "../../db/pool.js";
import { hmac, otpCode, safeEqual, sha256 } from "../../lib/crypto.js";
import { addSeconds } from "../../lib/dates.js";
import { AppError, badRequest, unauthorized } from "../../lib/errors.js";
import { maskEmail, maskMobile } from "../../lib/mask.js";
import type { RequestMeta } from "../../http/context.js";
import { hit, limit } from "../../http/rate-limit.js";
import { checkPasswordStrength, hashPassword, verifyPassword } from "./password.js";
import { sms } from "./sms.js";
import { REUSE_GRACE_MS, createSession, issueRefresh, revokeAllSessions, signAccess } from "./tokens.js";

export const OTP_TTL_SEC = 5 * 60;
export const OTP_RESEND_SEC = 30;
export const OTP_MAX_ATTEMPTS = 5;
export const LOCK_AFTER_FAILS = 10;
export const LOCK_MINUTES = 15;

export type OtpPurpose = "login" | "reset_password" | "verify_mobile";

export function normalizeMobile(input: string): string {
  const m = normalizeIndianPhone(input);
  if (!m) throw badRequest("invalid_mobile", "Enter a valid 10-digit Indian mobile number.");
  return m;
}

const otpHash = (mobile: string, purpose: string, code: string) => hmac(env().OTP_SECRET, `${purpose}:${mobile}:${code}`);

export async function logAuthEvent(
  d: Db,
  e: { userId?: number | null; event: string; identifier?: string; success: boolean; meta: RequestMeta },
) {
  await d.exec(
    `INSERT INTO auth_events (user_id, event, identifier, success, ip, user_agent)
     VALUES (:uid, :event, :ident, :ok, :ip, :ua)`,
    { uid: e.userId ?? null, event: e.event, ident: e.identifier ?? null, ok: e.success ? 1 : 0, ip: e.meta.ip, ua: e.meta.userAgent },
  );
}

/**
 * Sends a 6-digit OTP. Limits: 1 per 30 s and 5 per hour and 10 per day per mobile,
 * 20 per hour per IP address. The answer never reveals whether an account exists.
 */
export async function requestOtp(mobileInput: string, purpose: OtpPurpose, meta: RequestMeta) {
  const mobile = normalizeMobile(mobileInput);
  await limit(`otp:ip:${meta.ip}`, 20, 3600, "Too many OTP requests from this network. Try again later.");
  await limit(`otp:cool:${purpose}:${mobile}`, 1, OTP_RESEND_SEC, `Please wait ${OTP_RESEND_SEC} seconds before asking for a new OTP.`);
  await limit(`otp:h:${mobile}`, 5, 3600, "Too many OTPs for this number. Try again in an hour.");
  await limit(`otp:d:${mobile}`, 10, 86_400, "Too many OTPs for this number today.");

  const d = db();
  let send = true;
  if (purpose === "reset_password") {
    const u = await d.one("SELECT id FROM users WHERE mobile = :mobile AND status = 'active'", { mobile });
    send = !!u; // pretend success for unknown numbers
  }
  if (send) {
    const code = otpCode();
    await d.exec(
      "UPDATE otp_codes SET consumed_at = CURRENT_TIMESTAMP(3) WHERE mobile = :mobile AND purpose = :purpose AND consumed_at IS NULL",
      { mobile, purpose },
    );
    await d.exec(
      `INSERT INTO otp_codes (purpose, mobile, code_hash, expires_at, ip)
       VALUES (:purpose, :mobile, :hash, :exp, :ip)`,
      { purpose, mobile, hash: otpHash(mobile, purpose, code), exp: addSeconds(new Date(), OTP_TTL_SEC), ip: meta.ip },
    );
    await sms().sendOtp(mobile, code);
  }
  await logAuthEvent(d, { event: `otp_request_${purpose}`, identifier: maskMobile(mobile), success: true, meta });
  return { sent: true, mobile: maskMobile(mobile), expiresIn: OTP_TTL_SEC, resendAfter: OTP_RESEND_SEC };
}

/**
 * Checks the latest OTP in its own short transaction (so a wrong try is always
 * counted). Max 5 tries per code and 10 checks per hour per number.
 */
export async function verifyOtp(mobile: string, code: string, purpose: OtpPurpose, meta: RequestMeta): Promise<void> {
  await limit(`otpv:${mobile}`, 10, 3600, "Too many wrong OTPs. Try again in an hour.");
  const result = await withTx(async (conn) => {
    const d = new Db(conn);
    const row = await d.one(
      `SELECT id, code_hash, attempts, expires_at FROM otp_codes
        WHERE mobile = :mobile AND purpose = :purpose AND consumed_at IS NULL
        ORDER BY id DESC LIMIT 1 FOR UPDATE`,
      { mobile, purpose },
    );
    if (!row || new Date(row.expires_at) < new Date()) return ["otp_expired", "OTP expired. Ask for a new one."] as const;
    if (row.attempts >= OTP_MAX_ATTEMPTS) return ["otp_too_many_attempts", "Too many wrong tries. Ask for a new OTP."] as const;
    const ok = /^\d{6}$/.test(code) && safeEqual(row.code_hash, otpHash(mobile, purpose, code));
    if (!ok) {
      await d.exec("UPDATE otp_codes SET attempts = attempts + 1 WHERE id = :id", { id: row.id });
      return ["otp_invalid", "Wrong OTP. Please check and try again."] as const;
    }
    await d.exec("UPDATE otp_codes SET consumed_at = CURRENT_TIMESTAMP(3) WHERE id = :id", { id: row.id });
    return null;
  });
  if (result) {
    await logAuthEvent(db(), { event: `otp_verify_${purpose}`, identifier: maskMobile(mobile), success: false, meta });
    throw badRequest(result[0], result[1]);
  }
}

/** Sign in (or sign up) with mobile + OTP. Pending invitations are accepted here. */
export async function loginWithOtp(mobileInput: string, code: string, name: string | undefined, meta: RequestMeta) {
  const mobile = normalizeMobile(mobileInput);
  await verifyOtp(mobile, code, "login", meta);
  return withTx(async (conn) => {
    const d = new Db(conn);
    let user = await d.one("SELECT id, status, name FROM users WHERE mobile = :mobile FOR UPDATE", { mobile });
    let isNew = false;
    if (!user) {
      const r = await d.exec(
        "INSERT INTO users (name, mobile, mobile_verified_at, last_login_at) VALUES (:name, :mobile, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))",
        { name: (name ?? "").trim().slice(0, 120), mobile },
      );
      user = { id: r.insertId, status: "active", name: name ?? "" };
      isNew = true;
    } else {
      if (user.status !== "active") throw new AppError(403, "account_disabled", "This account is disabled.");
      await d.exec(
        `UPDATE users SET mobile_verified_at = COALESCE(mobile_verified_at, CURRENT_TIMESTAMP(3)),
                name = IF(name = '' AND :name <> '', :name, name),
                last_login_at = CURRENT_TIMESTAMP(3), failed_logins = 0, locked_until = NULL
          WHERE id = :id`,
        { id: user.id, name: (name ?? "").trim().slice(0, 120) },
      );
    }
    await acceptInvitations(d, Number(user.id), meta);
    const s = await createSession(conn, Number(user.id), meta);
    await logAuthEvent(d, { userId: user.id, event: "login_otp", identifier: maskMobile(mobile), success: true, meta });
    return { ...s, userId: Number(user.id), isNew };
  });
}

async function acceptInvitations(d: Db, userId: number, meta: RequestMeta) {
  const invites = await d.all("SELECT id, tenant_id FROM memberships WHERE user_id = :uid AND status = 'invited' FOR UPDATE", { uid: userId });
  for (const m of invites) {
    await d.exec("UPDATE memberships SET status = 'active', joined_at = CURRENT_TIMESTAMP(3) WHERE id = :id", { id: m.id });
    await d.exec(
      `INSERT INTO audit_logs (tenant_id, user_id, action, entity_type, entity_id, summary, ip, user_agent, request_id)
       VALUES (:tid, :uid, 'update', 'membership', :mid, 'Accepted invitation (first sign-in)', :ip, :ua, :rid)`,
      { tid: m.tenant_id, uid: userId, mid: m.id, ip: meta.ip, ua: meta.userAgent, rid: meta.requestId },
    );
  }
}

/** Email or mobile + password. Locks the account for 15 min after 10 wrong tries in a row. */
export async function loginWithPassword(identifier: string, password: string, meta: RequestMeta) {
  const ident = identifier.trim().toLowerCase();
  const isEmail = ident.includes("@");
  const key = isEmail ? ident : normalizeIndianPhone(ident) ?? ident;
  await limit(`pw:ip:${meta.ip}`, 30, 900, "Too many sign-in attempts from this network. Try again in 15 minutes.");
  await limit(`pw:id:${sha256(key)}`, 15, 900, "Too many sign-in attempts. Try again in 15 minutes.");

  const d = db();
  const user = await d.one(
    `SELECT id, password_hash, status, failed_logins, locked_until FROM users WHERE ${isEmail ? "email" : "mobile"} = :key`,
    { key },
  );
  const masked = isEmail ? maskEmail(key) : maskMobile(key);
  if (user?.locked_until && new Date(user.locked_until) > new Date()) {
    await logAuthEvent(d, { userId: user.id, event: "login_password_locked", identifier: masked, success: false, meta });
    throw new AppError(423, "account_locked", `Too many wrong passwords. Try again after ${LOCK_MINUTES} minutes or sign in with OTP.`);
  }
  const ok = await verifyPassword(password, user?.password_hash ?? null);
  if (!ok || !user || user.status !== "active") {
    if (user) {
      await d.exec(
        // locked_until first: MySQL evaluates SET left to right with already-updated values.
        `UPDATE users SET locked_until = IF(failed_logins + 1 >= :max, DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL :mins MINUTE), locked_until),
                failed_logins = failed_logins + 1
          WHERE id = :id`,
        { id: user.id, max: LOCK_AFTER_FAILS, mins: LOCK_MINUTES },
      );
    }
    await logAuthEvent(d, { userId: user?.id ?? null, event: "login_password", identifier: masked, success: false, meta });
    throw unauthorized("invalid_credentials", "Wrong email/mobile or password.");
  }
  await d.exec("UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = CURRENT_TIMESTAMP(3) WHERE id = :id", { id: user.id });
  return withTx(async (conn) => {
    const s = await createSession(conn, Number(user.id), meta);
    await logAuthEvent(new Db(conn), { userId: user.id, event: "login_password", identifier: masked, success: true, meta });
    return { ...s, userId: Number(user.id) };
  });
}

/** Forgot password: OTP to the registered mobile, then a new password. Signs out every device. */
export async function resetPassword(mobileInput: string, code: string, newPassword: string, meta: RequestMeta) {
  const mobile = normalizeMobile(mobileInput);
  checkPasswordStrength(newPassword);
  const hash = await hashPassword(newPassword);
  await verifyOtp(mobile, code, "reset_password", meta);
  await withTx(async (conn) => {
    const d = new Db(conn);
    const user = await d.one("SELECT id FROM users WHERE mobile = :mobile FOR UPDATE", { mobile });
    if (!user) throw badRequest("otp_invalid", "Wrong OTP. Please check and try again.");
    await d.exec(
      `UPDATE users SET password_hash = :hash, password_changed_at = CURRENT_TIMESTAMP(3), failed_logins = 0, locked_until = NULL
        WHERE id = :id`,
      { id: user.id, hash },
    );
    await revokeAllSessions(d, Number(user.id), "password_reset");
    await logAuthEvent(d, { userId: user.id, event: "password_reset", identifier: maskMobile(mobile), success: true, meta });
  });
}

/**
 * Swaps a refresh token for a new access + refresh token (rotation).
 * Re-using an old refresh token signs that device out (stolen-token protection).
 */
export async function refresh(token: string | undefined, meta: RequestMeta) {
  if (!token) throw unauthorized("no_session", "Please sign in.");
  const { hits } = await hit(`refresh:ip:${meta.ip}`, 60);
  if (hits > 120) throw new AppError(429, "rate_limited", "Too many requests.");
  return withTx(async (conn) => {
    const d = new Db(conn);
    const row = await d.one(
      `SELECT rt.id, rt.session_id, rt.expires_at, rt.used_at, s.user_id, s.revoked_at, s.expires_at AS s_expires, u.status
         FROM refresh_tokens rt
         JOIN sessions s ON s.id = rt.session_id
         JOIN users u ON u.id = s.user_id
        WHERE rt.token_hash = :hash FOR UPDATE`,
      { hash: sha256(token) },
    );
    if (!row || row.revoked_at || row.status !== "active" || new Date(row.expires_at) < new Date() || new Date(row.s_expires) < new Date()) {
      throw unauthorized("session_revoked", "Please sign in again.");
    }
    if (row.used_at) {
      if (Date.now() - new Date(row.used_at).getTime() > REUSE_GRACE_MS) {
        await d.exec(
          "UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP(3), revoke_reason = 'refresh_reuse' WHERE id = :id",
          { id: row.session_id },
        );
        await logAuthEvent(d, { userId: row.user_id, event: "refresh_reuse_detected", success: false, meta });
        return { revoked: true as const };
      }
      throw unauthorized("refresh_race", "Please retry.");
    }
    await d.exec("UPDATE refresh_tokens SET used_at = CURRENT_TIMESTAMP(3) WHERE id = :id", { id: row.id });
    const newRefresh = await issueRefresh(d, Number(row.session_id), new Date(row.s_expires));
    return {
      revoked: false as const,
      access: signAccess(Number(row.user_id), Number(row.session_id)),
      refresh: newRefresh,
    };
  });
}

export async function setPassword(userId: number, sessionId: number, current: string | undefined, next: string, meta: RequestMeta) {
  checkPasswordStrength(next);
  const d = db();
  const u = await d.one("SELECT password_hash FROM users WHERE id = :id", { id: userId });
  if (u?.password_hash) {
    await limit(`pwchange:${userId}`, 10, 3600);
    if (!current || !(await verifyPassword(current, u.password_hash))) {
      throw badRequest("wrong_current_password", "Current password is wrong.");
    }
  }
  const hash = await hashPassword(next);
  await d.exec("UPDATE users SET password_hash = :hash, password_changed_at = CURRENT_TIMESTAMP(3) WHERE id = :id", { id: userId, hash });
  await revokeAllSessions(d, userId, "password_changed", sessionId);
  await logAuthEvent(d, { userId, event: "password_set", success: true, meta });
}
