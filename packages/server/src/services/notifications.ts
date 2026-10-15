import type { Tenant } from "../context";
import { camelize } from "../util";

export async function listNotifications(t: Tenant, unreadOnly = false) {
  const rows = await t.db.query(
    `select id, kind, title, body, entity_type, entity_id, read_at, created_at from notifications
      where ($1 = false or read_at is null) order by created_at desc limit 100`,
    [unreadOnly],
  );
  const { n } = await t.db.one<{ n: number }>("select count(*)::int n from notifications where read_at is null");
  return { items: camelize(rows), unread: n };
}

export async function markNotificationsRead(t: Tenant, ids: string[] | "all") {
  if (ids === "all") await t.db.exec("update notifications set read_at = now() where read_at is null");
  else await t.db.exec("update notifications set read_at = now() where id = any($1) and read_at is null", [ids]);
}
