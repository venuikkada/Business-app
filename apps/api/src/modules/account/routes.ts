import { z } from "zod";
import { ApiRouter, idParam } from "../../http/router.js";
import { db } from "../../db/pool.js";
import { conflict, notFound } from "../../lib/errors.js";
import { setPassword } from "../auth/service.js";
import { revokeAllSessions } from "../auth/tokens.js";
import { listMyTenants } from "../tenants/service.js";

/** The signed-in person's own profile and devices (no business needed). */
export const accountRoutes = new ApiRouter("/me");
const r = accountRoutes;

r.get("/", { access: { access: "user" } }, async ({ ctx }) => {
  const u = await db().one(
    "SELECT id, name, mobile, email, language, password_hash IS NOT NULL AS has_password, created_at FROM users WHERE id = :id",
    { id: ctx.userId },
  );
  return {
    user: { id: Number(u.id), name: u.name, mobile: u.mobile, email: u.email, language: u.language, hasPassword: !!u.has_password, createdAt: u.created_at },
    currentTenantId: ctx.sessionTenantId,
    businesses: await listMyTenants(ctx.userId),
  };
});

r.patch("/",
  {
    access: { access: "user" },
    body: z
      .object({
        name: z.string().trim().min(1).max(120),
        email: z.string().trim().toLowerCase().email().max(190).nullable(),
        language: z.enum(["en", "hi", "te", "hinglish"]),
      })
      .partial(),
  },
  async ({ ctx, body }) => {
    const sets: string[] = [];
    if (body.name !== undefined) sets.push("name = :name");
    if (body.language !== undefined) sets.push("language = :language");
    if (body.email !== undefined) sets.push("email = :email, email_verified_at = NULL");
    if (sets.length) {
      try {
        await db().exec(`UPDATE users SET ${sets.join(", ")} WHERE id = :id`, { ...body, id: ctx.userId });
      } catch (e: any) {
        if (e?.code === "ER_DUP_ENTRY") throw conflict("email_taken", "This email is already used by another account.");
        throw e;
      }
    }
    return { ok: true };
  },
);

r.post(
  "/password",
  { access: { access: "user" }, body: z.object({ currentPassword: z.string().max(200).optional(), newPassword: z.string().min(8).max(72) }) },
  async ({ ctx, body, meta }) => {
    await setPassword(ctx.userId, ctx.sessionId, body.currentPassword, body.newPassword, meta);
    return { ok: true, otherDevicesSignedOut: true };
  },
);

r.get("/sessions", { access: { access: "user" } }, async ({ ctx }) => {
  const rows = await db().all(
    `SELECT id, user_agent, ip, created_at, last_seen_at FROM sessions
      WHERE user_id = :uid AND revoked_at IS NULL AND expires_at > CURRENT_TIMESTAMP(3)
      ORDER BY last_seen_at DESC LIMIT 50`,
    { uid: ctx.userId },
  );
  return rows.map((s) => ({
    id: Number(s.id), userAgent: s.user_agent, ip: s.ip, createdAt: s.created_at, lastSeenAt: s.last_seen_at, current: Number(s.id) === ctx.sessionId,
  }));
});

r.delete("/sessions/:id", { access: { access: "user" } }, async ({ ctx, params }) => {
  const id = idParam(params);
  const res = await db().exec(
    "UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP(3), revoke_reason = 'user_revoked' WHERE id = :id AND user_id = :uid AND revoked_at IS NULL",
    { id, uid: ctx.userId },
  );
  if (!res.affectedRows) throw notFound("Device");
});

r.post("/sessions/revoke-others", { access: { access: "user" } }, async ({ ctx }) => {
  await revokeAllSessions(db(), ctx.userId, "user_revoked_all", ctx.sessionId);
  return { ok: true };
});
