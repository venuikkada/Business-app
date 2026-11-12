import { Db, TenantDb, json, withTx } from "../../db/pool.js";
import type { TenantCtx } from "../../http/context.js";
import { badRequest, conflict, forbidden, notFound } from "../../lib/errors.js";
import { audit } from "../audit/service.js";
import { normalizeMobile } from "../auth/service.js";
import { env } from "../../config/env.js";
import { effectivePermissions } from "../../lib/permissions.js";

export interface MemberInput {
  roleId?: number;
  allBranches?: boolean;
  branchIds?: number[];
  status?: "active" | "disabled";
  displayName?: string | null;
}

function memberOut(r: any, branches: Map<number, number[]>) {
  return {
    id: Number(r.id),
    userId: Number(r.user_id),
    name: r.display_name || r.user_name || "",
    mobile: r.mobile,
    email: r.email,
    status: r.status,
    role: { id: Number(r.role_id), key: r.role_key, name: r.role_name },
    allBranches: !!r.all_branches,
    branchIds: branches.get(Number(r.id)) ?? [],
    joinedAt: r.joined_at,
    lastLoginAt: r.last_login_at,
  };
}

export async function listMembers(ctx: TenantCtx) {
  const rows = await ctx.tdb.all(
    `SELECT m.id, m.user_id, m.display_name, m.status, m.all_branches, m.joined_at, m.role_id,
            u.name AS user_name, u.mobile, u.email, u.last_login_at, r.role_key, r.name AS role_name
       FROM memberships m
       JOIN users u ON u.id = m.user_id
       JOIN roles r ON r.id = m.role_id AND r.tenant_id = m.tenant_id
      WHERE m.tenant_id = :tenantId
      ORDER BY FIELD(m.status,'active','invited','disabled'), u.name`,
  );
  const mb = await ctx.tdb.all("SELECT membership_id, branch_id FROM membership_branches WHERE tenant_id = :tenantId");
  const map = new Map<number, number[]>();
  for (const x of mb) map.set(Number(x.membership_id), [...(map.get(Number(x.membership_id)) ?? []), Number(x.branch_id)]);
  return rows.map((r) => memberOut(r, map));
}

async function loadRole(tdb: TenantDb, roleId: number) {
  const role = await tdb.one("SELECT id, role_key, name, permissions FROM roles WHERE tenant_id = :tenantId AND id = :id", { id: roleId });
  if (!role) throw badRequest("invalid_role", "Choose a valid role.");
  return role;
}

/** Owner role can only be given by an owner; others only roles whose permissions they hold. */
function checkCanAssign(ctx: TenantCtx, role: any) {
  if (role.role_key === "owner") {
    if (ctx.role.key !== "owner") throw forbidden("owner_only", "Only an owner can make someone an owner.");
    return;
  }
  const perms = effectivePermissions(role.role_key, json<string[]>(role.permissions, []));
  const missing = perms.filter((p) => !ctx.permissions.has(p));
  if (missing.length) throw forbidden("cannot_grant", "You cannot give a role with more access than your own.");
}

async function setBranches(tdb: TenantDb, membershipId: number, allBranches: boolean, branchIds: number[]) {
  await tdb.exec("DELETE FROM membership_branches WHERE tenant_id = :tenantId AND membership_id = :mid", { mid: membershipId });
  if (allBranches) return;
  if (!branchIds.length) throw badRequest("branch_required", "Choose at least one branch, or allow all branches.");
  const valid = await tdb.all("SELECT id FROM branches WHERE tenant_id = :tenantId AND id IN (:ids)", { ids: branchIds });
  if (valid.length !== new Set(branchIds).size) throw badRequest("invalid_branch", "One of the branches is not valid.");
  for (const b of new Set(branchIds)) {
    await tdb.exec("INSERT INTO membership_branches (tenant_id, membership_id, branch_id) VALUES (:tenantId, :mid, :bid)", { mid: membershipId, bid: b });
  }
}

/**
 * Adds a person by mobile number. They become active the first time they sign in
 * with OTP. Returns a WhatsApp link the owner can tap to tell them.
 */
export async function inviteMember(
  ctx: TenantCtx,
  input: { mobile: string; name: string; roleId: number; allBranches: boolean; branchIds: number[] },
) {
  const mobile = normalizeMobile(input.mobile);
  return withTx(async (conn) => {
    const tdb = new TenantDb(conn, ctx.tenantId);
    const role = await loadRole(tdb, input.roleId);
    checkCanAssign(ctx, role);
    const count = await tdb.one("SELECT COUNT(*) AS n FROM memberships WHERE tenant_id = :tenantId AND status <> 'disabled'");
    if (Number(count.n) >= 200) throw badRequest("team_limit", "Team limit reached.");

    // users is a platform table (no tenant_id): one person can work in many businesses.
    const pdb = new Db(conn);
    let user = await pdb.one("SELECT id FROM users WHERE mobile = :mobile FOR UPDATE", { mobile });
    if (!user) {
      const r = await pdb.exec("INSERT INTO users (name, mobile) VALUES (:name, :mobile)", { name: input.name, mobile });
      user = { id: r.insertId };
    }
    const existing = await tdb.one("SELECT id FROM memberships WHERE tenant_id = :tenantId AND user_id = :uid", { uid: user.id });
    if (existing) throw conflict("already_member", "This person is already in your team.");
    const m = await tdb.exec(
      `INSERT INTO memberships (tenant_id, user_id, role_id, status, all_branches, display_name, invited_by)
       VALUES (:tenantId, :uid, :rid, 'invited', :all, :name, :by)`,
      { uid: user.id, rid: role.id, all: input.allBranches ? 1 : 0, name: input.name, by: ctx.userId },
    );
    await setBranches(tdb, m.insertId, input.allBranches, input.branchIds);
    await audit(tdb, ctx, {
      action: "create", entityType: "membership", entityId: m.insertId,
      summary: `Invited ${input.name} as ${role.name}`,
      after: { name: input.name, mobile, role: role.name, all_branches: input.allBranches, branch_ids: input.branchIds },
    });
    const msg = `Hello ${input.name}, you have been added to ${ctx.tenant.name} as ${role.name}. Sign in with your mobile number ${mobile.slice(3)} using OTP: ${env().APP_ORIGIN}/login`;
    return {
      membershipId: m.insertId,
      whatsappLink: `https://wa.me/${mobile.replace("+", "")}?text=${encodeURIComponent(msg)}`,
    };
  });
}

/** Rules: nobody edits their own access; only owners touch owners; at least one active owner remains. */
export async function updateMember(ctx: TenantCtx, membershipId: number, input: MemberInput) {
  return withTx(async (conn) => {
    const tdb = new TenantDb(conn, ctx.tenantId);
    const before = await tdb.one(
      `SELECT m.*, r.role_key, r.name AS role_name FROM memberships m JOIN roles r ON r.id = m.role_id AND r.tenant_id = m.tenant_id
        WHERE m.tenant_id = :tenantId AND m.id = :id FOR UPDATE`,
      { id: membershipId },
    );
    if (!before) throw notFound("Team member");
    const accessChange = input.roleId !== undefined || input.status !== undefined || input.allBranches !== undefined || input.branchIds !== undefined;
    if (accessChange && Number(before.user_id) === ctx.userId) throw forbidden("own_access", "You cannot change your own role, branches or status.");
    if (before.role_key === "owner" && ctx.role.key !== "owner") throw forbidden("owner_only", "Only an owner can change another owner.");

    let newRole = { id: before.role_id, role_key: before.role_key, name: before.role_name };
    if (input.roleId !== undefined && input.roleId !== Number(before.role_id)) {
      newRole = await loadRole(tdb, input.roleId);
      checkCanAssign(ctx, newRole);
    }
    const newStatus = input.status ?? before.status;
    const losingOwner = before.role_key === "owner" && (newRole.role_key !== "owner" || newStatus === "disabled");
    if (losingOwner) await assertAnotherOwner(tdb, membershipId);
    if (input.status === "active" && before.status === "invited") throw badRequest("still_invited", "This person becomes active when they first sign in.");

    await tdb.exec(
      `UPDATE memberships SET role_id = :rid, status = :status, display_name = :name, all_branches = :all
        WHERE tenant_id = :tenantId AND id = :id`,
      {
        id: membershipId, rid: newRole.id, status: newStatus,
        name: input.displayName !== undefined ? input.displayName : before.display_name,
        all: input.allBranches !== undefined ? (input.allBranches ? 1 : 0) : before.all_branches,
      },
    );
    const oldBranches = (await tdb.all("SELECT branch_id FROM membership_branches WHERE tenant_id = :tenantId AND membership_id = :mid", { mid: membershipId })).map((r) => Number(r.branch_id));
    if (input.allBranches !== undefined || input.branchIds !== undefined) {
      await setBranches(tdb, membershipId, input.allBranches ?? !!before.all_branches, input.branchIds ?? oldBranches);
    }
    const after = await tdb.one("SELECT * FROM memberships WHERE tenant_id = :tenantId AND id = :id", { id: membershipId });
    const newBranches = (await tdb.all("SELECT branch_id FROM membership_branches WHERE tenant_id = :tenantId AND membership_id = :mid", { mid: membershipId })).map((r) => Number(r.branch_id));
    await audit(tdb, ctx, {
      action: "update", entityType: "membership", entityId: membershipId,
      summary: `Updated team member ${after.display_name ?? ""}`.trim(),
      before: { role: before.role_name, status: before.status, all_branches: !!before.all_branches, branch_ids: oldBranches, display_name: before.display_name },
      after: { role: newRole.name, status: after.status, all_branches: !!after.all_branches, branch_ids: newBranches, display_name: after.display_name },
    });
  });
}

export async function removeMember(ctx: TenantCtx, membershipId: number) {
  return withTx(async (conn) => {
    const tdb = new TenantDb(conn, ctx.tenantId);
    const before = await tdb.one(
      `SELECT m.*, r.role_key, r.name AS role_name, u.name AS user_name FROM memberships m
         JOIN roles r ON r.id = m.role_id AND r.tenant_id = m.tenant_id
         JOIN users u ON u.id = m.user_id
        WHERE m.tenant_id = :tenantId AND m.id = :id FOR UPDATE`,
      { id: membershipId },
    );
    if (!before) throw notFound("Team member");
    if (Number(before.user_id) === ctx.userId) throw forbidden("own_access", "You cannot remove yourself.");
    if (before.role_key === "owner") {
      if (ctx.role.key !== "owner") throw forbidden("owner_only", "Only an owner can remove another owner.");
      await assertAnotherOwner(tdb, membershipId);
    }
    await tdb.exec("DELETE FROM membership_branches WHERE tenant_id = :tenantId AND membership_id = :id", { id: membershipId });
    await tdb.exec("DELETE FROM memberships WHERE tenant_id = :tenantId AND id = :id", { id: membershipId });
    // Close the business on that person's devices.
    await tdb.exec("UPDATE sessions SET tenant_id = NULL WHERE tenant_id = :tenantId AND user_id = :uid", { uid: before.user_id });
    await audit(tdb, ctx, {
      action: "delete", entityType: "membership", entityId: membershipId,
      summary: `Removed ${before.display_name || before.user_name} (${before.role_name}) from the team`,
      before: { name: before.display_name || before.user_name, role: before.role_name, status: before.status },
    });
  });
}

async function assertAnotherOwner(tdb: TenantDb, exceptMembershipId: number) {
  const r = await tdb.one(
    `SELECT COUNT(*) AS n FROM memberships m JOIN roles r ON r.id = m.role_id AND r.tenant_id = m.tenant_id
      WHERE m.tenant_id = :tenantId AND r.role_key = 'owner' AND m.status = 'active' AND m.id <> :id`,
    { id: exceptMembershipId },
  );
  if (Number(r.n) < 1) throw badRequest("last_owner", "A business must always have at least one active owner.");
}
