import { json, type TenantDb } from "../../db/pool.js";
import type { TenantCtx } from "../../http/context.js";
import { effectivePermissions } from "../../lib/permissions.js";

/**
 * Creates an in-app notification for one user, or for every active member who holds
 * `permission` (one row each, so "read" is tracked per person).
 */
export async function notify(
  tdb: TenantDb,
  n: { userId?: number | null; permission?: string | null; type: string; title: string; body?: string | null; link?: string | null },
) {
  let userIds: number[];
  if (n.userId) userIds = [n.userId];
  else {
    const members = await tdb.all(
      `SELECT m.user_id, r.role_key, r.permissions FROM memberships m JOIN roles r ON r.id = m.role_id AND r.tenant_id = m.tenant_id
        WHERE m.tenant_id = :tenantId AND m.status = 'active'`,
    );
    userIds = members
      .filter((m) => !n.permission || effectivePermissions(m.role_key, json<string[]>(m.permissions, [])).includes(n.permission))
      .map((m) => Number(m.user_id));
  }
  for (const uid of userIds) {
    await tdb.exec(
      `INSERT INTO notifications (tenant_id, user_id, permission, type, title, body, link)
       VALUES (:tenantId, :userId, :perm, :type, :title, :body, :link)`,
      { userId: uid, perm: n.permission ?? null, type: n.type, title: n.title.slice(0, 200), body: n.body?.slice(0, 500) ?? null, link: n.link ?? null },
    );
  }
  return userIds.length;
}

export async function listNotifications(ctx: TenantCtx, limit = 30) {
  const rows = await ctx.tdb.all(
    `SELECT id, type, title, body, link, read_at, created_at FROM notifications
      WHERE tenant_id = :tenantId AND user_id = :userId ORDER BY id DESC LIMIT :limit`,
    { userId: ctx.userId, limit },
  );
  return rows.map((r) => ({ id: Number(r.id), type: r.type, title: r.title, body: r.body, link: r.link, read: !!r.read_at, createdAt: r.created_at }));
}

/**
 * Cheap check for the app's 15-second poll: unread count and change cursors, so the
 * app only reloads a screen when something actually changed.
 */
export async function pollState(ctx: TenantCtx) {
  const n = await ctx.tdb.one(
    `SELECT COALESCE(SUM(read_at IS NULL), 0) AS unread, COALESCE(MAX(id), 0) AS latest
       FROM notifications WHERE tenant_id = :tenantId AND user_id = :userId`,
    { userId: ctx.userId },
  );
  const a = await ctx.tdb.one("SELECT COALESCE(MAX(id), 0) AS latest FROM audit_logs WHERE tenant_id = :tenantId");
  return {
    serverTime: new Date().toISOString(),
    unreadNotifications: Number(n.unread),
    latestNotificationId: Number(n.latest),
    changeCursor: Number(a.latest), // moves whenever anyone in the business saves something
  };
}

export async function markRead(ctx: TenantCtx, id: number | "all") {
  if (id === "all") {
    await ctx.tdb.exec(
      "UPDATE notifications SET read_at = CURRENT_TIMESTAMP(3) WHERE tenant_id = :tenantId AND user_id = :userId AND read_at IS NULL",
      { userId: ctx.userId },
    );
  } else {
    await ctx.tdb.exec(
      "UPDATE notifications SET read_at = CURRENT_TIMESTAMP(3) WHERE tenant_id = :tenantId AND user_id = :userId AND id = :id",
      { userId: ctx.userId, id },
    );
  }
}
