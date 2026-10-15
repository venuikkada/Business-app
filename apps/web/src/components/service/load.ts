import "server-only";
import type { Tenant } from "@cba/server";

/** Members who can be assigned tickets (anyone with service.edit). */
export async function technicians(t: Tenant) {
  return t.db.query<{ userId: string; fullName: string }>(
    `select u.id as "userId", u.full_name as "fullName" from memberships m join users u on u.id = m.user_id join roles r on r.id = m.role_id
      where m.status = 'active' and 'service.edit' = any(r.permissions) order by u.full_name`,
  );
}
