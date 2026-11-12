import { TenantDb, json, withTx } from "../../db/pool.js";
import type { TenantCtx } from "../../http/context.js";
import { AppError, badRequest, conflict, forbidden, notFound } from "../../lib/errors.js";
import { OWNER_ONLY, PERMISSION_GROUPS, effectivePermissions, isPermission, isSystemRoleKey } from "../../lib/permissions.js";
import { audit } from "../audit/service.js";

/** Permission checkboxes for the role editor, limited to modules this business uses. */
export async function permissionCatalogue(ctx: TenantCtx) {
  const mods = await ctx.tdb.all("SELECT module_key FROM tenant_modules WHERE tenant_id = :tenantId");
  const enabled = new Set(mods.map((m) => m.module_key));
  return PERMISSION_GROUPS.filter((g) => !g.sector || enabled.has(g.sector)).map((g) => ({
    key: g.key,
    label: g.label,
    actions: Object.entries(g.actions).map(([a, label]) => ({ key: `${g.key}.${a}`, label, ownerOnly: OWNER_ONLY.has(`${g.key}.${a}`) })),
  }));
}

function roleOut(r: any) {
  return {
    id: Number(r.id),
    key: r.role_key,
    name: r.name,
    description: r.description,
    isSystem: !!r.is_system,
    permissions: effectivePermissions(r.role_key, json<string[]>(r.permissions, [])).sort(),
    memberCount: Number(r.member_count ?? 0),
  };
}

export async function listRoles(ctx: TenantCtx) {
  const rows = await ctx.tdb.all(
    `SELECT r.*, (SELECT COUNT(*) FROM memberships m WHERE m.tenant_id = r.tenant_id AND m.role_id = r.id AND m.status <> 'disabled') AS member_count
       FROM roles r WHERE r.tenant_id = :tenantId
      ORDER BY r.is_system DESC, FIELD(r.role_key, 'owner','admin','manager','accountant','cashier'), r.name`,
  );
  return rows.map(roleOut);
}

/**
 * A person can only hand out permissions they hold themselves (no privilege
 * escalation), and owner-only permissions can never go into a custom role.
 */
function checkGrant(ctx: TenantCtx, perms: string[]) {
  const unknown = perms.filter((p) => !isPermission(p));
  if (unknown.length) throw badRequest("unknown_permission", `Unknown permission: ${unknown.join(", ")}`);
  const ownerOnly = perms.filter((p) => OWNER_ONLY.has(p));
  if (ownerOnly.length) throw badRequest("owner_only_permission", "Subscription permissions can only belong to the owner.");
  const missing = perms.filter((p) => !ctx.permissions.has(p));
  if (missing.length) throw new AppError(403, "cannot_grant", "You cannot give permissions that you do not have.", { missing });
}

export async function createRole(ctx: TenantCtx, input: { name: string; description?: string | null; permissions: string[] }) {
  const perms = [...new Set(input.permissions)];
  checkGrant(ctx, perms);
  return withTx(async (conn) => {
    const tdb = new TenantDb(conn, ctx.tenantId);
    const dup = await tdb.one("SELECT id FROM roles WHERE tenant_id = :tenantId AND name = :name", { name: input.name });
    if (dup) throw conflict("role_name_taken", "A role with this name already exists.");
    const count = await tdb.one("SELECT COUNT(*) AS n FROM roles WHERE tenant_id = :tenantId AND is_system = 0");
    if (Number(count.n) >= 30) throw badRequest("too_many_roles", "Up to 30 custom roles are allowed.");
    const key = `custom_${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
    const r = await tdb.exec(
      "INSERT INTO roles (tenant_id, role_key, name, description, is_system, permissions) VALUES (:tenantId, :key, :name, :desc, 0, :perms)",
      { key, name: input.name, desc: input.description ?? null, perms: JSON.stringify(perms) },
    );
    const after = await tdb.one("SELECT * FROM roles WHERE tenant_id = :tenantId AND id = :id", { id: r.insertId });
    await audit(tdb, ctx, {
      action: "create", entityType: "role", entityId: r.insertId, summary: `Created role "${input.name}"`,
      after: { name: input.name, permissions: perms },
    });
    return roleOut(after);
  });
}

export async function updateRole(ctx: TenantCtx, id: number, input: { name?: string; description?: string | null; permissions?: string[] }) {
  return withTx(async (conn) => {
    const tdb = new TenantDb(conn, ctx.tenantId);
    const before = await tdb.one("SELECT * FROM roles WHERE tenant_id = :tenantId AND id = :id FOR UPDATE", { id });
    if (!before) throw notFound("Role");
    if (before.is_system || isSystemRoleKey(before.role_key)) throw forbidden("system_role", "Built-in roles cannot be changed. Create a custom role instead.");
    if (ctx.role.id === id) throw forbidden("own_role", "You cannot change your own role's permissions.");
    const perms = input.permissions ? [...new Set(input.permissions)] : json<string[]>(before.permissions, []);
    if (input.permissions) {
      // Only newly added permissions need to be held by the editor.
      const old = new Set(json<string[]>(before.permissions, []));
      checkGrant(ctx, perms.filter((p) => !old.has(p)));
      const ownerOnly = perms.filter((p) => OWNER_ONLY.has(p));
      if (ownerOnly.length) throw badRequest("owner_only_permission", "Subscription permissions can only belong to the owner.");
    }
    if (input.name && input.name !== before.name) {
      const dup = await tdb.one("SELECT id FROM roles WHERE tenant_id = :tenantId AND name = :name AND id <> :id", { name: input.name, id });
      if (dup) throw conflict("role_name_taken", "A role with this name already exists.");
    }
    await tdb.exec(
      "UPDATE roles SET name = :name, description = :desc, permissions = :perms WHERE tenant_id = :tenantId AND id = :id",
      { id, name: input.name ?? before.name, desc: input.description !== undefined ? input.description : before.description, perms: JSON.stringify(perms) },
    );
    const after = await tdb.one("SELECT * FROM roles WHERE tenant_id = :tenantId AND id = :id", { id });
    await audit(tdb, ctx, {
      action: "update", entityType: "role", entityId: id, summary: `Updated role "${after.name}"`,
      before: { name: before.name, description: before.description, permissions: json(before.permissions, []) },
      after: { name: after.name, description: after.description, permissions: json(after.permissions, []) },
    });
    return roleOut(after);
  });
}

export async function deleteRole(ctx: TenantCtx, id: number) {
  return withTx(async (conn) => {
    const tdb = new TenantDb(conn, ctx.tenantId);
    const before = await tdb.one("SELECT * FROM roles WHERE tenant_id = :tenantId AND id = :id FOR UPDATE", { id });
    if (!before) throw notFound("Role");
    if (before.is_system) throw forbidden("system_role", "Built-in roles cannot be deleted.");
    const used = await tdb.one("SELECT COUNT(*) AS n FROM memberships WHERE tenant_id = :tenantId AND role_id = :id", { id });
    if (Number(used.n) > 0) throw conflict("role_in_use", "Move the people in this role to another role first.");
    await tdb.exec("DELETE FROM roles WHERE tenant_id = :tenantId AND id = :id", { id });
    await audit(tdb, ctx, {
      action: "delete", entityType: "role", entityId: id, summary: `Deleted role "${before.name}"`,
      before: { name: before.name, permissions: json(before.permissions, []) },
    });
  });
}
