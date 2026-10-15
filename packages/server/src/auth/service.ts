import { registerSchema, loginSchema, forgotPasswordSchema, resetPasswordSchema, changePasswordSchema } from "@cba/core";
import type { z } from "zod";
import { appTx, type Db, type TxContext } from "../db";
import { env } from "../env";
import { AppError } from "../errors";
import { rateLimit } from "../rate-limit";
import { sendMail } from "../mailer";
import { burnPasswordCheck, decryptSecret, encryptSecret, hashPassword, randomToken, sha256, verifyPassword } from "./crypto";
import { generateTotpSecret, otpauthUri, verifyTotp } from "./totp";

export type SessionKind = "web" | "mobile" | "admin";
type Runner = <T>(ctx: TxContext, fn: (db: Db) => Promise<T>) => Promise<T>;

export interface ClientMeta {
  ip?: string | null;
  userAgent?: string | null;
}

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  emailVerified: boolean;
  isPlatformAdmin: boolean;
  totpEnabled: boolean;
}

export interface AuthSession {
  id: string;
  kind: SessionKind;
  mfaVerified: boolean;
  expiresAt: string;
}

const SESSION_TTL_DAYS: Record<SessionKind, number> = { web: 30, mobile: 90, admin: 0.5 };
const MAX_FAILED = 10;
const LOCK_MINUTES = 15;

function ipBucket(ip?: string | null) {
  return ip ? ip.slice(0, 64) : "unknown";
}

function toUser(r: Record<string, unknown>): AuthUser {
  return {
    id: r.id as string,
    email: r.email as string,
    fullName: r.full_name as string,
    phone: (r.phone as string) ?? null,
    emailVerified: !!r.email_verified_at,
    isPlatformAdmin: !!r.is_platform_admin,
    totpEnabled: !!r.totp_enabled_at,
  };
}

async function createSession(db: Db, userId: string, kind: SessionKind, mfaVerified: boolean, meta: ClientMeta) {
  const token = `cba_${randomToken(32)}`;
  const s = await db.one<{ id: string; expires_at: string }>(
    `insert into sessions(user_id, token_hash, kind, mfa_verified, ip, user_agent, expires_at)
     values ($1, $2, $3, $4, $5::inet, $6, now() + make_interval(hours => $7))
     returning id, expires_at`,
    [userId, sha256(token), kind, mfaVerified, meta.ip ?? null, meta.userAgent?.slice(0, 300) ?? null, Math.round(SESSION_TTL_DAYS[kind] * 24)],
  );
  return { token, session: { id: s.id, kind, mfaVerified, expiresAt: s.expires_at } satisfies AuthSession };
}

async function issueToken(db: Db, userId: string, purpose: "password_reset" | "email_verify", hours: number) {
  const token = randomToken(32);
  await db.exec("update user_tokens set used_at = now() where user_id = $1 and purpose = $2 and used_at is null", [userId, purpose]);
  await db.exec(
    "insert into user_tokens(user_id, purpose, token_hash, expires_at) values ($1, $2, $3, now() + make_interval(hours => $4))",
    [userId, purpose, sha256(token), hours],
  );
  return token;
}

export async function register(input: z.input<typeof registerSchema>, meta: ClientMeta) {
  const data = registerSchema.parse(input);
  const passwordHash = await hashPassword(data.password);
  return appTx({}, async (db) => {
    await rateLimit(db, `register:ip:${ipBucket(meta.ip)}`, 10, 3600);
    const exists = await db.maybe("select 1 from users where email = $1", [data.email]);
    if (exists) throw new AppError("CONFLICT", "An account with this email already exists. Try signing in or resetting your password.");
    const u = await db.one(
      `insert into users(email, password_hash, full_name, phone) values ($1, $2, $3, $4) returning *`,
      [data.email, passwordHash, data.fullName, data.phone],
    );
    const verifyToken = await issueToken(db, u.id as string, "email_verify", 72);
    await sendMail({
      to: data.email,
      subject: "Verify your email — CRAZY BUSINESS APP",
      text: `Hi ${data.fullName},\n\nPlease verify your email address:\n${env.appUrl}/verify-email?token=${verifyToken}\n\nThis link expires in 3 days.`,
    });
    const { token, session } = await createSession(db, u.id as string, "web", false, meta);
    return { user: toUser(u), token, session };
  });
}

export async function login(input: z.input<typeof loginSchema>, kind: SessionKind, meta: ClientMeta, run: Runner = appTx) {
  const data = loginSchema.parse(input);
  // Rate limits are committed even when the login fails.
  await run({}, async (db) => {
    await rateLimit(db, `login:ip:${ipBucket(meta.ip)}`, 30, 900);
    await rateLimit(db, `login:email:${data.email}`, 10, 900);
  });
  const result = await run({}, async (db) => {
    const u = await db.maybe<Record<string, unknown>>("select * from users where email = $1 for update", [data.email]);
    if (!u || u.status !== "active") {
      await burnPasswordCheck(data.password);
      return { ok: false as const };
    }
    if (u.locked_until && new Date(u.locked_until as string) > new Date()) {
      return { ok: false as const, locked: true };
    }
    const valid = await verifyPassword(data.password, u.password_hash as string);
    if (!valid) {
      await db.exec(
        `update users set failed_login_count = failed_login_count + 1,
           locked_until = case when failed_login_count + 1 >= $2 then now() + make_interval(mins => $3) else locked_until end
         where id = $1`,
        [u.id, MAX_FAILED, LOCK_MINUTES],
      );
      return { ok: false as const };
    }
    if (kind === "admin" && !u.is_platform_admin) return { ok: false as const };

    // Platform admins must use TOTP. Business users may opt in.
    let mfaVerified = false;
    if (u.totp_enabled_at) {
      if (!data.totp) return { ok: false as const, mfaRequired: true };
      if (!verifyTotp(decryptSecret(u.totp_secret_enc as string), data.totp)) return { ok: false as const, mfaRequired: true, badCode: true };
      mfaVerified = true;
    }
    await db.exec("update users set failed_login_count = 0, locked_until = null, last_login_at = now() where id = $1", [u.id]);
    const { token, session } = await createSession(db, u.id as string, kind, mfaVerified, meta);
    return { ok: true as const, user: toUser(u), token, session };
  });
  if (!result.ok) {
    if ("locked" in result && result.locked) throw new AppError("RATE_LIMITED", "Account temporarily locked after repeated failed attempts. Try again in 15 minutes or reset your password.");
    if ("mfaRequired" in result && result.mfaRequired) {
      throw new AppError("MFA_REQUIRED", "badCode" in result && result.badCode ? "The authenticator code is incorrect" : "Enter the 6-digit code from your authenticator app");
    }
    throw new AppError("UNAUTHENTICATED", "Invalid email or password");
  }
  return result;
}

/** Validates a session token and returns the user. Slides web sessions. */
export async function authenticate(token: string | null | undefined, run: Runner = appTx): Promise<{ user: AuthUser; session: AuthSession } | null> {
  if (!token || !token.startsWith("cba_") || token.length > 100) return null;
  return run({}, async (db) => {
    const r = await db.maybe<Record<string, unknown>>(
      `select s.id as session_id, s.kind, s.mfa_verified, s.expires_at, s.last_seen_at, u.*
         from sessions s join users u on u.id = s.user_id
        where s.token_hash = $1 and s.revoked_at is null and s.expires_at > now() and u.status = 'active'`,
      [sha256(token)],
    );
    if (!r) return null;
    if (Date.now() - new Date(r.last_seen_at as string).getTime() > 5 * 60_000) {
      await db.exec(
        `update sessions set last_seen_at = now(),
           expires_at = case when kind = 'web' then greatest(expires_at, now() + interval '30 days') else expires_at end
         where id = $1`,
        [r.session_id],
      );
    }
    return {
      user: toUser(r),
      session: { id: r.session_id as string, kind: r.kind as SessionKind, mfaVerified: !!r.mfa_verified, expiresAt: r.expires_at as string },
    };
  });
}

export async function logout(token: string, run: Runner = appTx) {
  await run({}, (db) => db.exec("update sessions set revoked_at = now() where token_hash = $1", [sha256(token)]));
}

export async function logoutAll(userId: string, exceptSessionId?: string) {
  await appTx({}, (db) =>
    db.exec("update sessions set revoked_at = now() where user_id = $1 and revoked_at is null and id is distinct from $2", [userId, exceptSessionId ?? null]),
  );
}

export async function listSessions(userId: string) {
  return appTx({}, (db) =>
    db.query(
      `select id, kind, ip::text, user_agent, created_at, last_seen_at, expires_at
         from sessions where user_id = $1 and revoked_at is null and expires_at > now() order by last_seen_at desc`,
      [userId],
    ),
  );
}

export async function revokeSession(userId: string, sessionId: string) {
  await appTx({}, (db) => db.exec("update sessions set revoked_at = now() where id = $1 and user_id = $2", [sessionId, userId]));
}

export async function requestPasswordReset(input: z.input<typeof forgotPasswordSchema>, meta: ClientMeta, run: Runner = appTx) {
  const { email } = forgotPasswordSchema.parse(input);
  await run({}, async (db) => {
    await rateLimit(db, `forgot:ip:${ipBucket(meta.ip)}`, 10, 3600);
    await rateLimit(db, `forgot:email:${email}`, 3, 3600);
  });
  await run({}, async (db) => {
    const u = await db.maybe<{ id: string; full_name: string }>("select id, full_name from users where email = $1 and status = 'active'", [email]);
    // Always behave the same so the endpoint cannot be used to discover accounts.
    if (!u) return;
    const token = await issueToken(db, u.id, "password_reset", 1);
    await sendMail({
      to: email,
      subject: "Reset your password — CRAZY BUSINESS APP",
      text: `Hi ${u.full_name},\n\nUse this link to set a new password (valid for 1 hour):\n${env.appUrl}/reset-password?token=${token}\n\nIf you did not ask for this, you can ignore this email.`,
    });
  });
}

export async function resetPassword(input: z.input<typeof resetPasswordSchema>, run: Runner = appTx) {
  const data = resetPasswordSchema.parse(input);
  const hash = await hashPassword(data.password);
  await run({}, async (db) => {
    const t = await db.maybe<{ id: string; user_id: string }>(
      `select id, user_id from user_tokens where token_hash = $1 and purpose = 'password_reset' and used_at is null and expires_at > now() for update`,
      [sha256(data.token)],
    );
    if (!t) throw new AppError("VALIDATION", "This reset link is invalid or has expired. Request a new one.");
    await db.exec("update user_tokens set used_at = now() where id = $1", [t.id]);
    await db.exec("update users set password_hash = $2, failed_login_count = 0, locked_until = null where id = $1", [t.user_id, hash]);
    await db.exec("update sessions set revoked_at = now() where user_id = $1 and revoked_at is null", [t.user_id]);
  });
}

export async function verifyEmail(token: string) {
  await appTx({}, async (db) => {
    const t = await db.maybe<{ id: string; user_id: string }>(
      `select id, user_id from user_tokens where token_hash = $1 and purpose = 'email_verify' and used_at is null and expires_at > now() for update`,
      [sha256(token)],
    );
    if (!t) throw new AppError("VALIDATION", "This verification link is invalid or has expired.");
    await db.exec("update user_tokens set used_at = now() where id = $1", [t.id]);
    await db.exec("update users set email_verified_at = coalesce(email_verified_at, now()) where id = $1", [t.user_id]);
  });
}

export async function resendVerification(userId: string) {
  await appTx({}, async (db) => {
    await rateLimit(db, `verify:user:${userId}`, 3, 3600);
    const u = await db.one<{ email: string; full_name: string; email_verified_at: string | null }>("select email, full_name, email_verified_at from users where id = $1", [userId]);
    if (u.email_verified_at) return;
    const token = await issueToken(db, userId, "email_verify", 72);
    await sendMail({ to: u.email, subject: "Verify your email — CRAZY BUSINESS APP", text: `Verify your email:\n${env.appUrl}/verify-email?token=${token}` });
  });
}

export async function changePassword(userId: string, sessionId: string, input: z.input<typeof changePasswordSchema>) {
  const data = changePasswordSchema.parse(input);
  const hash = await hashPassword(data.newPassword);
  await appTx({}, async (db) => {
    await rateLimit(db, `chpw:user:${userId}`, 10, 3600);
    const u = await db.one<{ password_hash: string }>("select password_hash from users where id = $1", [userId]);
    if (!(await verifyPassword(data.currentPassword, u.password_hash))) throw new AppError("VALIDATION", "Current password is incorrect");
    await db.exec("update users set password_hash = $2 where id = $1", [userId, hash]);
    await db.exec("update sessions set revoked_at = now() where user_id = $1 and id <> $2 and revoked_at is null", [userId, sessionId]);
  });
}

export async function updateProfile(userId: string, input: { fullName?: string; phone?: string | null }) {
  return appTx({}, async (db) => {
    const r = await db.one(
      "update users set full_name = coalesce($2, full_name), phone = $3 where id = $1 returning *",
      [userId, input.fullName?.trim() || null, input.phone ?? null],
    );
    return toUser(r);
  });
}

// ------------------------------------------------------------------ TOTP
export async function beginTotpSetup(userId: string, run: Runner = appTx) {
  const secret = generateTotpSecret();
  return run({}, async (db) => {
    const u = await db.one<{ email: string; totp_enabled_at: string | null }>("select email, totp_enabled_at from users where id = $1", [userId]);
    if (u.totp_enabled_at) throw new AppError("CONFLICT", "Two-factor authentication is already enabled");
    await db.exec("update users set totp_secret_enc = $2 where id = $1", [userId, encryptSecret(secret)]);
    return { secret, uri: otpauthUri(secret, u.email) };
  });
}

export async function confirmTotpSetup(userId: string, sessionId: string, code: string, run: Runner = appTx) {
  await run({}, async (db) => {
    const u = await db.one<{ totp_secret_enc: string | null }>("select totp_secret_enc from users where id = $1 for update", [userId]);
    if (!u.totp_secret_enc || !verifyTotp(decryptSecret(u.totp_secret_enc), code)) throw new AppError("VALIDATION", "The code is incorrect. Check your phone's time and try again.");
    await db.exec("update users set totp_enabled_at = now() where id = $1", [userId]);
    await db.exec("update sessions set mfa_verified = true where id = $1", [sessionId]);
  });
}

export async function disableTotp(userId: string, password: string, code: string) {
  await appTx({}, async (db) => {
    const u = await db.one<{ password_hash: string; totp_secret_enc: string | null; is_platform_admin: boolean }>(
      "select password_hash, totp_secret_enc, is_platform_admin from users where id = $1",
      [userId],
    );
    if (u.is_platform_admin) throw new AppError("FORBIDDEN", "Platform administrators must keep two-factor authentication enabled");
    if (!(await verifyPassword(password, u.password_hash))) throw new AppError("VALIDATION", "Password is incorrect");
    if (!u.totp_secret_enc || !verifyTotp(decryptSecret(u.totp_secret_enc), code)) throw new AppError("VALIDATION", "The code is incorrect");
    await db.exec("update users set totp_enabled_at = null, totp_secret_enc = null where id = $1", [userId]);
  });
}

/**
 * Deletes a personal account. Owners must first delete or hand over their
 * businesses. Personal data is anonymised; business records the user
 * created stay with the business (they belong to the business, not the user).
 */
export async function deleteAccount(userId: string, password: string) {
  await appTx({ userId }, async (db) => {
    const u = await db.one<{ password_hash: string }>("select password_hash from users where id = $1", [userId]);
    if (!(await verifyPassword(password, u.password_hash))) throw new AppError("VALIDATION", "Password is incorrect");
    // Roles are tenant-scoped (RLS), so use the definer function that lists the caller's businesses.
    const owned = await db.query<{ name: string }>("select name from app.my_businesses() where role_key = 'owner'");
    if (owned.length) {
      throw new AppError("BUSINESS_RULE", `You own ${owned.map((o) => o.name).join(", ")}. Delete the business or transfer ownership first.`);
    }
    await db.exec("update sessions set revoked_at = now() where user_id = $1 and revoked_at is null", [userId]);
    await db.exec(
      `update users set status = 'deleted', email = 'deleted+' || id || '@deleted.invalid', full_name = 'Deleted user',
         phone = null, password_hash = 'deleted', totp_secret_enc = null, totp_enabled_at = null, deletion_requested_at = now()
       where id = $1`,
      [userId],
    );
  });
}
