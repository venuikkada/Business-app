import { z } from "zod";
import { randomToken } from "../../lib/crypto.js";
import { cookieSecure } from "../../config/env.js";
import { COOKIE_CSRF, COOKIE_REFRESH, resolveUser } from "../../http/auth-middleware.js";
import { ApiRouter } from "../../http/router.js";
import { db } from "../../db/pool.js";
import { clearAuthCookies, revokeSession, setAuthCookies } from "./tokens.js";
import { loginWithOtp, loginWithPassword, logAuthEvent, refresh, requestOtp, resetPassword } from "./service.js";

export const authRoutes = new ApiRouter("/auth");
const r = authRoutes;

const mobile = z.string().trim().min(10).max(16);
const otp = z.string().trim().regex(/^\d{6}$/, "OTP is 6 digits");

/** The app calls this first. The token must be sent back in the X-CSRF-Token header. */
r.get("/csrf", { access: { access: "public" } }, async ({ req, res }) => {
  let token = req.cookies?.[COOKIE_CSRF];
  if (!token || typeof token !== "string" || token.length < 20) {
    token = randomToken(24);
    res.cookie(COOKIE_CSRF, token, { httpOnly: false, secure: cookieSecure(), sameSite: "strict", path: "/" });
  }
  return { csrfToken: token };
});

r.post(
  "/otp/request",
  { access: { access: "public" }, body: z.object({ mobile, purpose: z.enum(["login", "reset_password"]).default("login") }) },
  async ({ body, meta }) => requestOtp(body.mobile, body.purpose, meta),
);

r.post(
  "/otp/verify",
  { access: { access: "public" }, body: z.object({ mobile, otp, name: z.string().trim().max(120).optional() }) },
  async ({ body, res, meta }) => {
    const s = await loginWithOtp(body.mobile, body.otp, body.name, meta);
    setAuthCookies(res, s.access, s.refresh);
    return { userId: s.userId, isNewUser: s.isNew };
  },
);

r.post(
  "/login",
  { access: { access: "public" }, body: z.object({ identifier: z.string().trim().min(3).max(190), password: z.string().min(1).max(200) }) },
  async ({ body, res, meta }) => {
    const s = await loginWithPassword(body.identifier, body.password, meta);
    setAuthCookies(res, s.access, s.refresh);
    return { userId: s.userId };
  },
);

r.post(
  "/password/reset",
  { access: { access: "public" }, body: z.object({ mobile, otp, newPassword: z.string().min(8).max(72) }) },
  async ({ body, meta }) => {
    await resetPassword(body.mobile, body.otp, body.newPassword, meta);
    return { ok: true };
  },
);

r.post("/refresh", { access: { access: "public" } }, async ({ req, res, meta }) => {
  const out = await refresh(req.cookies?.[COOKIE_REFRESH], meta).catch((e) => {
    if (e?.code === "session_revoked" || e?.code === "no_session") clearAuthCookies(res);
    throw e;
  });
  if (out.revoked) {
    clearAuthCookies(res);
    res.status(401).json({ error: { code: "session_revoked", message: "This device was signed out for safety. Please sign in again." } });
    return;
  }
  setAuthCookies(res, out.access, out.refresh);
  return { ok: true };
});

r.post("/logout", { access: { access: "public" } }, async ({ req, res, meta }) => {
  // Works even with an expired access token; best effort.
  try {
    const u = await resolveUser(req);
    await revokeSession(u.sessionId, "logout");
    await logAuthEvent(db(), { userId: u.userId, event: "logout", success: true, meta });
  } catch {
    /* already signed out */
  }
  clearAuthCookies(res);
  return { ok: true };
});
