import { inviteSchema, roleSchema, branchSchema, isPermission } from "@cba/core";
import type { z } from "zod";
import { assertLimit, type Tenant } from "../context";
import { AppError, notFound, forbidden } from "../errors";
import { camelize } from "../util";
import { randomToken, sha256 } from "../auth/crypto";
import { sendMail } from "../mailer";
import { env } from "../env";
import { rateLimit } from "../rate-limit";

export async function listMembers(t: Tenant) {
  t.require("team.view");
  const members = await t.db.query(
    `select m.id, m.user_id, m.status, m.branch_ids, m.joined_at, u.full_name, u.email, u.phone, u.last_login_at, r.id as role_id, r.name as role_name, r.key as role_key
       from memberships m join users u on u.id = m.user_id join roles r on r.id = m.role_id order by m.joined_at`,
  );
  const invites = await t.db.query(
    `select i.id, i.email, i.expires_at, i.created_at, r.name as role_name from invitations i join roles r on r.id = i.role_id
      where i.accepted_at is null and i.revoked_at is null and i.expires_at > now() order by i.created_at desc`,
  );
  return { members: camelize(members), invitations: camelize(invites) };
}

async function seatsUsedSql() {
  return `select ((select count(*) from memberships where status = 'active') +
                  (select count(*) from invitations where accepted_at is null and revoked_at is null and expires_at > now()))::int n`;
}

export async function inviteMember(t: Tenant, input: z.input<typeof inviteSchema>) {
  t.require("team.create");
  t.requireFeature("employees");
  const d = inviteSchema.parse(input);
  await rateLimit(t.db, `invite:${t.businessId}`, 30, 3600);
  const role = await t.db.maybe<{ key: string | null; name: string }>("select key, name from roles where id = $1", [d.roleId]);
  if (!role) throw new AppError("VALIDATION", "Role not found");
  if (role.key === "owner" && t.roleKey !== "owner") throw forbidden("Only an owner can invite another owner");
  if (d.branchIds?.length) {
    const { n } = await t.db.one<{ n: number }>("select count(*)::int n from branches where id = any($1)", [d.branchIds]);
    if (n !== d.branchIds.length) throw new AppError("VALIDATION", "Branch not found");
  }
  const existing = await t.db.maybe("select 1 from memberships m join users u on u.id = m.user_id where u.email = $1 and m.status = 'active'", [d.email]);
  if (existing) throw new AppError("CONFLICT", "This person is already a member");
  await assertLimit(t, "users", await seatsUsedSql());
  const token = randomToken(32);
  const inv = await t.db.one<{ id: string }>(
    `insert into invitations(business_id, email, role_id, branch_ids, token_hash, invited_by, expires_at)
     values ($1,$2,$3,$4,$5,$6, now() + interval '7 days') returning id`,
    [t.businessId, d.email, d.roleId, d.branchIds?.length ? d.branchIds : null, sha256(token), t.userId],
  );
  await sendMail({
    to: d.email,
    subject: `${t.user.fullName} invited you to ${t.business.name} on CRAZY BUSINESS APP`,
    text: `You have been invited to join ${t.business.name} as ${role.name}.\n\nAccept the invitation (valid for 7 days):\n${env.appUrl}/invite?token=${token}\n\nIf you don't have an account yet, sign up with this email address first.`,
  });
  await t.audit("member.invite", "invitation", inv.id, `Invited ${d.email} as ${role.name}`);
  return { id: inv.id, inviteUrl: `${env.appUrl}/invite?token=${token}` };
}

export async function revokeInvitation(t: Tenant, id: string) {
  t.require("team.delete");
  const n = await t.db.exec("update invitations set revoked_at = now() where id = $1 and accepted_at is null and revoked_at is null", [id]);
  if (!n) throw notFound("Invitation");
  await t.audit("member.invite_revoke", "invitation", id);
}

async function ownerCount(t: Tenant) {
  const { n } = await t.db.one<{ n: number }>("select count(*)::int n from memberships m join roles r on r.id = m.role_id where r.key = 'owner' and m.status = 'active'");
  return n;
}

export async function updateMember(t: Tenant, membershipId: string, input: { roleId?: string; branchIds?: string[] | null; status?: "active" | "disabled" }) {
  t.require("team.edit");
  const m = await t.db.maybe<{ user_id: string; role_key: string | null; status: string }>(
    "select m.user_id, r.key as role_key, m.status from memberships m join roles r on r.id = m.role_id where m.id = $1 for update",
    [membershipId],
  );
  if (!m) throw notFound("Member");
  if (m.user_id === t.userId && (input.roleId || input.status)) throw new AppError("BUSINESS_RULE", "You cannot change your own role or status");
  if (m.role_key === "owner" && t.roleKey !== "owner") throw forbidden("Only an owner can change another owner");
  if (input.roleId) {
    const role = await t.db.maybe<{ key: string | null; name: string }>("select key, name from roles where id = $1", [input.roleId]);
    if (!role) throw new AppError("VALIDATION", "Role not found");
    if (role.key === "owner" && t.roleKey !== "owner") throw forbidden("Only an owner can make someone an owner");
    if (m.role_key === "owner" && role.key !== "owner" && (await ownerCount(t)) <= 1) throw new AppError("BUSINESS_RULE", "A business must have at least one owner");
    await t.db.exec("update memberships set role_id = $2 where id = $1", [membershipId, input.roleId]);
  }
  if (input.branchIds !== undefined) {
    await t.db.exec("update memberships set branch_ids = $2 where id = $1", [membershipId, input.branchIds?.length ? input.branchIds : null]);
  }
  if (input.status) {
    if (input.status === "active" && m.status !== "active") await assertLimit(t, "users", await seatsUsedSql());
    if (input.status === "disabled" && m.role_key === "owner" && (await ownerCount(t)) <= 1) throw new AppError("BUSINESS_RULE", "A business must have at least one owner");
    await t.db.exec("update memberships set status = $2 where id = $1", [membershipId, input.status]);
  }
  await t.audit("member.update", "membership", membershipId, undefined, undefined, input);
}

export async function removeMember(t: Tenant, membershipId: string) {
  t.require("team.delete");
  const m = await t.db.maybe<{ user_id: string; role_key: string | null }>("select m.user_id, r.key role_key from memberships m join roles r on r.id = m.role_id where m.id = $1", [membershipId]);
  if (!m) throw notFound("Member");
  if (m.user_id === t.userId) throw new AppError("BUSINESS_RULE", "You cannot remove yourself");
  if (m.role_key === "owner" && t.roleKey !== "owner") throw forbidden("Only an owner can remove an owner");
  if (m.role_key === "owner" && (await ownerCount(t)) <= 1) throw new AppError("BUSINESS_RULE", "A business must have at least one owner");
  await t.db.exec("delete from memberships where id = $1", [membershipId]);
  await t.audit("member.remove", "membership", membershipId, `Removed user ${m.user_id}`);
}

// ------------------------------------------------------------------- roles
export async function listRoles(t: Tenant) {
  t.require("team.view");
  return camelize(await t.db.query("select r.*, (select count(*)::int from memberships m where m.role_id = r.id) as member_count from roles r order by r.is_system desc, r.name"));
}

export async function saveRole(t: Tenant, id: string | null, input: z.input<typeof roleSchema>) {
  t.require(id ? "team.edit" : "team.create");
  t.requireFeature("custom_roles");
  const d = roleSchema.parse(input);
  const perms = [...new Set(d.permissions)].filter(isPermission);
  // Nobody can grant permissions they do not hold themselves.
  const escalation = perms.filter((p) => !t.can(p));
  if (escalation.length) throw forbidden(`You cannot grant permissions you do not have: ${escalation.slice(0, 5).join(", ")}`);
  if (id) {
    const r = await t.db.maybe<{ key: string | null }>("select key from roles where id = $1", [id]);
    if (!r) throw notFound("Role");
    if (r.key === "owner") throw new AppError("BUSINESS_RULE", "The owner role always has every permission");
    await t.db.exec("update roles set name = $2, description = $3, permissions = $4 where id = $1", [id, d.name, d.description, perms]);
    await t.audit("role.update", "role", id, `Role ${d.name} updated`, undefined, { permissions: perms });
    return { id };
  }
  const r = await t.db.one<{ id: string }>("insert into roles(business_id, name, description, permissions) values ($1,$2,$3,$4) returning id", [t.businessId, d.name, d.description, perms]);
  await t.audit("role.create", "role", r.id, `Role ${d.name} created`, undefined, { permissions: perms });
  return r;
}

export async function deleteRole(t: Tenant, id: string) {
  t.require("team.delete");
  const r = await t.db.maybe<{ is_system: boolean; name: string }>("select is_system, name from roles where id = $1", [id]);
  if (!r) throw notFound("Role");
  if (r.is_system) throw new AppError("BUSINESS_RULE", "Built-in roles cannot be deleted");
  const used = await t.db.maybe("select 1 from memberships where role_id = $1 union all select 1 from invitations where role_id = $1 and accepted_at is null limit 1", [id]);
  if (used) throw new AppError("BUSINESS_RULE", "Move members off this role before deleting it");
  await t.db.exec("delete from roles where id = $1", [id]);
  await t.audit("role.delete", "role", id, `Role ${r.name} deleted`);
}

// ---------------------------------------------------------------- branches
export async function listBranches(t: Tenant) {
  return camelize(await t.db.query("select * from branches order by is_default desc, archived_at nulls first, name"));
}

export async function saveBranch(t: Tenant, id: string | null, input: z.input<typeof branchSchema>) {
  t.require("settings.edit");
  const d = branchSchema.parse(input);
  if (d.gstin && d.gstin.slice(0, 2) !== d.stateCode) throw new AppError("VALIDATION", "GSTIN state code does not match the branch state");
  const vals = [d.name, d.code ?? null, d.gstin, d.phone, d.address.line1, d.address.line2, d.address.city, d.stateCode, d.address.pincode];
  if (id) {
    const n = await t.db.exec("update branches set name=$2, code=$3, gstin=$4, phone=$5, address_line1=$6, address_line2=$7, city=$8, state_code=$9, pincode=$10 where id=$1", [id, ...vals]);
    if (!n) throw notFound("Branch");
    await t.audit("branch.update", "branch", id, d.name);
    return { id };
  }
  t.requireFeature("multi_branch");
  await assertLimit(t, "branches", "select count(*)::int n from branches where archived_at is null");
  const r = await t.db.one<{ id: string }>(
    "insert into branches(business_id, name, code, gstin, phone, address_line1, address_line2, city, state_code, pincode) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id",
    [t.businessId, ...vals],
  );
  await t.audit("branch.create", "branch", r.id, d.name);
  return r;
}

export async function archiveBranch(t: Tenant, id: string) {
  t.require("settings.edit");
  const b = await t.db.maybe<{ is_default: boolean }>("select is_default from branches where id = $1", [id]);
  if (!b) throw notFound("Branch");
  if (b.is_default) throw new AppError("BUSINESS_RULE", "The main branch cannot be archived");
  const stock = await t.db.maybe("select 1 from stock_levels where branch_id = $1 and quantity <> 0 limit 1", [id]);
  if (stock) throw new AppError("BUSINESS_RULE", "Transfer the branch's stock to another branch first");
  await t.db.exec("update branches set archived_at = now() where id = $1", [id]);
  await t.audit("branch.archive", "branch", id);
}

// ---------------------------------------------------- support access grants
export async function listSupportGrants(t: Tenant) {
  t.require("settings.view");
  return camelize(
    await t.db.query(
      `select g.id, g.reason, g.requested_at, g.approved_at, g.expires_at, g.revoked_at, u.full_name as staff_name, u.email as staff_email
         from support_access_grants g join users u on u.id = g.platform_user_id order by g.requested_at desc limit 50`,
    ),
  );
}

export async function decideSupportGrant(t: Tenant, id: string, approve: boolean, hours = 24) {
  if (t.roleKey !== "owner") throw forbidden("Only the owner can grant support access");
  if (approve) {
    const h = Math.min(Math.max(hours, 1), 72);
    const n = await t.db.exec("update support_access_grants set approved_by = $2, approved_at = now(), expires_at = now() + make_interval(hours => $3) where id = $1 and approved_at is null and revoked_at is null", [id, t.userId, h]);
    if (!n) throw notFound("Support request");
    await t.audit("support.grant", "support_access", id, `Support access granted for ${h} hours`);
  } else {
    const n = await t.db.exec("update support_access_grants set revoked_at = now() where id = $1 and revoked_at is null", [id]);
    if (!n) throw notFound("Support request");
    await t.audit("support.revoke", "support_access", id, "Support access revoked/denied");
  }
}

// ---------------------------------------------------------------- audit
export async function listAudit(t: Tenant, query: { page?: number; entityType?: string; entityId?: string; userId?: string } = {}) {
  t.require("audit.view");
  const page = Math.max(1, Number(query.page ?? 1));
  const params: unknown[] = [];
  const where = ["true"];
  if (query.entityType) {
    params.push(query.entityType);
    where.push(`a.entity_type = $${params.length}`);
  }
  if (query.entityId && /^[0-9a-f-]{36}$/.test(query.entityId)) {
    params.push(query.entityId);
    where.push(`a.entity_id = $${params.length}`);
  }
  if (query.userId && /^[0-9a-f-]{36}$/.test(query.userId)) {
    params.push(query.userId);
    where.push(`a.user_id = $${params.length}`);
  }
  params.push(50, (page - 1) * 50);
  const rows = await t.db.query(
    `select a.id, a.action, a.entity_type, a.entity_id, a.summary, a.ip::text, a.via_support, a.created_at, u.full_name as user_name
       from audit_logs a left join users u on u.id = a.user_id where ${where.join(" and ")}
      order by a.created_at desc limit $${params.length - 1} offset $${params.length}`,
    params,
  );
  return { items: camelize(rows), page };
}

export async function auditDetail(t: Tenant, id: number) {
  t.require("audit.view");
  const r = await t.db.maybe("select a.*, u.full_name as user_name from audit_logs a left join users u on u.id = a.user_id where a.id = $1", [id]);
  if (!r) throw notFound("Audit entry");
  return camelize(r);
}
