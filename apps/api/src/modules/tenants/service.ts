import type { z } from "zod";
import { Db, TenantDb, db, withTx } from "../../db/pool.js";
import { addDaysDate, fyLabel, istDate } from "../../lib/dates.js";
import { AppError, badRequest, conflict, forbidden, notFound } from "../../lib/errors.js";
import { SYSTEM_ROLES, SYSTEM_ROLE_KEYS } from "../../lib/permissions.js";
import { DEFAULT_EXPENSE_CATEGORIES, DEFAULT_UNITS } from "../../lib/sectors.js";
import type { TenantCtx, UserCtx } from "../../http/context.js";
import { audit } from "../audit/service.js";
import { ensureSeries } from "./series.js";
import type { branchInput, createTenantInput, updateTenantInput } from "./schemas.js";

export const TRIAL_DAYS = 30;

type CreateTenant = z.infer<typeof createTenantInput>;
type BranchInput = z.infer<typeof branchInput>;

function branchCode(i: number, given?: string) {
  return given ?? (i === 0 ? "MAIN" : `B${i + 1}`);
}

async function insertBranch(tdb: TenantDb, b: BranchInput, code: string, isDefault: boolean) {
  const r = await tdb.exec(
    `INSERT INTO branches (tenant_id, name, code, gstin, state_code, address_line1, address_line2, city, pincode, phone, is_default)
     VALUES (:tenantId, :name, :code, :gstin, :stateCode, :a1, :a2, :city, :pincode, :phone, :isDefault)`,
    {
      name: b.name, code, gstin: b.gstin ?? null, stateCode: b.stateCode, a1: b.addressLine1, a2: b.addressLine2,
      city: b.city, pincode: b.pincode ?? null, phone: b.phone, isDefault: isDefault ? 1 : 0,
    },
  );
  return r.insertId;
}

/**
 * Onboarding: creates the business with its branches, the 5 system roles, the owner
 * membership, number series for this financial year, default units, expense
 * categories, a cash account and leave types — all in one transaction.
 */
export async function createTenant(u: UserCtx, input: CreateTenant) {
  const owned = await db().one(
    `SELECT COUNT(*) AS n FROM memberships m JOIN roles r ON r.id = m.role_id
      WHERE m.user_id = :uid AND r.role_key = 'owner' AND m.status = 'active'`,
    { uid: u.userId },
  );
  if (Number(owned?.n ?? 0) >= 10) throw badRequest("too_many_businesses", "You can own up to 10 businesses. Contact support for more.");

  return withTx(async (conn) => {
    const d = new Db(conn);
    const t = await d.exec(
      `INSERT INTO tenants (name, legal_name, gstin, pan, state_code, address_line1, address_line2, city, pincode, phone, email,
                            sector, fy_start_month, default_language, subscription_ends_at, created_by)
       VALUES (:name, :legalName, :gstin, :pan, :stateCode, :a1, :a2, :city, :pincode, :phone, :email,
               :sector, :fy, :lang, :trialEnds, :uid)`,
      {
        name: input.name, legalName: input.legalName, gstin: input.gstin ?? null, pan: input.pan ?? (input.gstin ? input.gstin.slice(2, 12) : null),
        stateCode: input.stateCode, a1: input.addressLine1, a2: input.addressLine2, city: input.city, pincode: input.pincode ?? null,
        phone: input.phone, email: input.email ?? null, sector: input.sector, fy: input.fyStartMonth, lang: input.defaultLanguage,
        trialEnds: addDaysDate(new Date(), TRIAL_DAYS), uid: u.userId,
      },
    );
    const tenantId = t.insertId;
    const tdb = new TenantDb(conn, tenantId);
    const ctx = { userId: u.userId, meta: u.meta };

    await tdb.exec("INSERT INTO tenant_modules (tenant_id, module_key) VALUES (:tenantId, :m)", { m: input.sector });

    const fy = fyLabel(istDate(), input.fyStartMonth);
    const branchIds: number[] = [];
    for (const [i, b] of input.branches.entries()) {
      const code = branchCode(i, b.code);
      const id = await insertBranch(tdb, b, code, i === 0);
      branchIds.push(id);
      const invPrefix = b.invoicePrefix ?? (i === 0 ? input.invoicePrefix : `${input.invoicePrefix.slice(0, 5)}${i + 1}`);
      await ensureSeries(tdb, id, fy, { invoice: invPrefix });
    }

    const roleIds: Record<string, number> = {};
    for (const key of SYSTEM_ROLE_KEYS) {
      const def = SYSTEM_ROLES[key];
      const r = await tdb.exec(
        `INSERT INTO roles (tenant_id, role_key, name, description, is_system, permissions)
         VALUES (:tenantId, :key, :name, :desc, 1, :perms)`,
        { key, name: def.name, desc: def.description, perms: JSON.stringify(def.permissions()) },
      );
      roleIds[key] = r.insertId;
    }
    const m = await tdb.exec(
      `INSERT INTO memberships (tenant_id, user_id, role_id, status, all_branches, joined_at)
       VALUES (:tenantId, :uid, :rid, 'active', 1, CURRENT_TIMESTAMP(3))`,
      { uid: u.userId, rid: roleIds.owner },
    );

    for (const [code, name, decimals] of DEFAULT_UNITS) {
      await tdb.exec("INSERT INTO units (tenant_id, code, name, decimals) VALUES (:tenantId, :code, :name, :dec)", { code, name, dec: decimals });
    }
    for (const name of DEFAULT_EXPENSE_CATEGORIES) {
      await tdb.exec("INSERT INTO expense_categories (tenant_id, name) VALUES (:tenantId, :name)", { name });
    }
    await tdb.exec(
      "INSERT INTO accounts (tenant_id, branch_id, account_type, name) VALUES (:tenantId, :bid, 'cash', 'Cash in hand')",
      { bid: branchIds[0] },
    );
    await tdb.exec("INSERT INTO leave_types (tenant_id, name, days_per_year, is_paid) VALUES (:tenantId, 'Casual leave', 12, 1), (:tenantId, 'Sick leave', 6, 1), (:tenantId, 'Unpaid leave', 0, 0)");

    await audit(tdb, ctx, {
      action: "create",
      entityType: "tenant",
      entityId: tenantId,
      summary: `Created business "${input.name}" (${input.sector}) with ${branchIds.length} branch(es)`,
      after: { name: input.name, gstin: input.gstin ?? null, sector: input.sector, state_code: input.stateCode, fy_start_month: input.fyStartMonth },
    });
    await audit(tdb, ctx, { action: "create", entityType: "membership", entityId: m.insertId, summary: "Owner added" });

    // Open the new business on this device.
    await d.exec("UPDATE sessions SET tenant_id = :tid WHERE id = :sid", { tid: tenantId, sid: u.sessionId });
    return { tenantId, branchIds };
  });
}

/** Businesses this user belongs to (for the business switcher). */
export async function listMyTenants(userId: number) {
  const rows = await db().all(
    `SELECT t.id, t.name, t.sector, t.status, t.subscription_status, t.subscription_ends_at,
            m.status AS membership_status, r.role_key, r.name AS role_name
       FROM memberships m
       JOIN tenants t ON t.id = m.tenant_id
       JOIN roles r ON r.id = m.role_id AND r.tenant_id = m.tenant_id
      WHERE m.user_id = :uid AND m.status = 'active' AND t.status <> 'deleted'
      ORDER BY t.name`,
    { uid: userId },
  );
  return rows.map((r) => ({
    id: Number(r.id),
    name: r.name,
    sector: r.sector,
    status: r.status,
    subscriptionStatus: r.subscription_status,
    subscriptionEndsAt: r.subscription_ends_at,
    role: { key: r.role_key, name: r.role_name },
  }));
}

export async function switchTenant(u: UserCtx, tenantId: number) {
  const ok = await db().one(
    `SELECT 1 FROM memberships m JOIN tenants t ON t.id = m.tenant_id
      WHERE m.tenant_id = :tid AND m.user_id = :uid AND m.status = 'active' AND t.status = 'active'`,
    { tid: tenantId, uid: u.userId },
  );
  if (!ok) throw forbidden("no_business_access", "You do not have access to this business.");
  await db().exec("UPDATE sessions SET tenant_id = :tid WHERE id = :sid", { tid: tenantId, sid: u.sessionId });
}

function tenantOut(t: any) {
  return {
    id: Number(t.id),
    name: t.name,
    legalName: t.legal_name,
    gstin: t.gstin,
    pan: t.pan,
    stateCode: t.state_code,
    addressLine1: t.address_line1,
    addressLine2: t.address_line2,
    city: t.city,
    pincode: t.pincode,
    phone: t.phone,
    email: t.email,
    sector: t.sector,
    fyStartMonth: Number(t.fy_start_month),
    timezone: t.timezone,
    currency: t.currency,
    defaultLanguage: t.default_language,
    logoFileId: t.logo_file_id ? Number(t.logo_file_id) : null,
    plan: t.plan,
    subscriptionStatus: t.subscription_status,
    subscriptionEndsAt: t.subscription_ends_at,
    aggregateTurnoverBand: t.aggregate_turnover_band,
    einvoiceEnabled: !!t.einvoice_enabled,
    createdAt: t.created_at,
  };
}

/** Everything the app needs after opening a business. */
export async function currentTenant(ctx: TenantCtx) {
  const t = await ctx.tdb.one("SELECT * FROM tenants WHERE id = :tenantId");
  const modules = await ctx.tdb.all("SELECT module_key FROM tenant_modules WHERE tenant_id = :tenantId");
  const branches = await listBranches(ctx);
  return {
    tenant: tenantOut(t),
    modules: modules.map((m) => m.module_key),
    branches,
    me: {
      userId: ctx.userId,
      membershipId: ctx.membershipId,
      role: ctx.role,
      permissions: [...ctx.permissions].sort(),
      branchIds: ctx.branchIds,
    },
  };
}

const TENANT_COLUMNS: Record<string, string> = {
  name: "name", legalName: "legal_name", gstin: "gstin", pan: "pan", stateCode: "state_code",
  addressLine1: "address_line1", addressLine2: "address_line2", city: "city", pincode: "pincode",
  phone: "phone", email: "email", defaultLanguage: "default_language", aggregateTurnoverBand: "aggregate_turnover_band",
};

export async function updateTenant(ctx: TenantCtx, patch: z.infer<typeof updateTenantInput>) {
  return withTx(async (conn) => {
    const tdb = new TenantDb(conn, ctx.tenantId);
    const before = await tdb.one("SELECT * FROM tenants WHERE id = :tenantId FOR UPDATE");
    const sets: string[] = [];
    const params: Record<string, unknown> = {};
    for (const [k, col] of Object.entries(TENANT_COLUMNS)) {
      if (k in patch) {
        sets.push(`${col} = :${k}`);
        params[k] = (patch as any)[k];
      }
    }
    const nextGstin = "gstin" in patch ? patch.gstin : before.gstin;
    const nextState = patch.stateCode ?? before.state_code;
    if (nextGstin && nextGstin.slice(0, 2) !== nextState) throw badRequest("gstin_state_mismatch", "GSTIN state code does not match the business state.");
    if (!sets.length) return tenantOut(before);
    await tdb.exec(`UPDATE tenants SET ${sets.join(", ")} WHERE id = :tenantId`, params);
    const after = await tdb.one("SELECT * FROM tenants WHERE id = :tenantId");
    await audit(tdb, ctx, { action: "update", entityType: "tenant", entityId: ctx.tenantId, summary: "Updated business details", before, after });
    return tenantOut(after);
  });
}

/* ---------------- branches ---------------- */

function branchOut(b: any) {
  return {
    id: Number(b.id),
    name: b.name,
    code: b.code,
    gstin: b.gstin,
    stateCode: b.state_code,
    addressLine1: b.address_line1,
    addressLine2: b.address_line2,
    city: b.city,
    pincode: b.pincode,
    phone: b.phone,
    isDefault: !!b.is_default,
    isActive: !!b.is_active,
  };
}

export async function listBranches(ctx: TenantCtx) {
  const rows = await ctx.tdb.all("SELECT * FROM branches WHERE tenant_id = :tenantId ORDER BY is_default DESC, name");
  return rows.map(branchOut).filter((b) => ctx.branchIds === null || ctx.branchIds.includes(b.id));
}

export async function createBranch(ctx: TenantCtx, b: BranchInput) {
  return withTx(async (conn) => {
    const tdb = new TenantDb(conn, ctx.tenantId);
    const n = await tdb.one("SELECT COUNT(*) AS n FROM branches WHERE tenant_id = :tenantId");
    if (Number(n.n) >= 50) throw badRequest("too_many_branches", "A business can have up to 50 branches.");
    const code = b.code ?? `B${Number(n.n) + 1}`;
    const dup = await tdb.one("SELECT id FROM branches WHERE tenant_id = :tenantId AND code = :code", { code });
    if (dup) throw conflict("branch_code_taken", "Another branch already uses this code.");
    const id = await insertBranch(tdb, b, code, false);
    await ensureSeries(tdb, id, fyLabel(istDate(), ctx.tenant.fyStartMonth), b.invoicePrefix ? { invoice: b.invoicePrefix } : {});
    const after = await tdb.one("SELECT * FROM branches WHERE tenant_id = :tenantId AND id = :id", { id });
    await audit(tdb, ctx, { action: "create", entityType: "branch", entityId: id, summary: `Added branch "${b.name}"`, after, branchId: id });
    return branchOut(after);
  });
}

export async function updateBranch(ctx: TenantCtx, id: number, b: Partial<BranchInput> & { isActive?: boolean; isDefault?: boolean }) {
  return withTx(async (conn) => {
    const tdb = new TenantDb(conn, ctx.tenantId);
    const before = await tdb.one("SELECT * FROM branches WHERE tenant_id = :tenantId AND id = :id FOR UPDATE", { id });
    if (!before) throw notFound("Branch");
    if (b.isActive === false && before.is_default) throw badRequest("default_branch", "The main branch cannot be closed. Make another branch the main one first.");
    const map: Record<string, string> = {
      name: "name", code: "code", gstin: "gstin", stateCode: "state_code", addressLine1: "address_line1", addressLine2: "address_line2",
      city: "city", pincode: "pincode", phone: "phone",
    };
    const sets: string[] = [];
    const params: Record<string, unknown> = { id };
    for (const [k, col] of Object.entries(map)) if (k in b) (sets.push(`${col} = :${k}`), (params[k] = (b as any)[k]));
    if (b.isActive !== undefined) (sets.push("is_active = :isActive"), (params.isActive = b.isActive ? 1 : 0));
    const gst = "gstin" in b ? b.gstin : before.gstin;
    if (gst && gst.slice(0, 2) !== (b.stateCode ?? before.state_code)) throw badRequest("gstin_state_mismatch", "Branch GSTIN state code does not match its state.");
    if (b.isDefault) {
      await tdb.exec("UPDATE branches SET is_default = 0 WHERE tenant_id = :tenantId");
      sets.push("is_default = 1", "is_active = 1");
    }
    if (sets.length) await tdb.exec(`UPDATE branches SET ${sets.join(", ")} WHERE tenant_id = :tenantId AND id = :id`, params);
    const after = await tdb.one("SELECT * FROM branches WHERE tenant_id = :tenantId AND id = :id", { id });
    await audit(tdb, ctx, { action: "update", entityType: "branch", entityId: id, summary: `Updated branch "${after.name}"`, before, after, branchId: id });
    return branchOut(after);
  }).catch((e) => {
    if (e?.code === "ER_DUP_ENTRY") throw conflict("branch_code_taken", "Another branch already uses this code.");
    throw e;
  });
}

/* ---------------- number series ---------------- */

export async function listSeries(ctx: TenantCtx, fy?: string) {
  const rows = await ctx.tdb.all(
    `SELECT s.id, s.branch_id, b.name AS branch_name, s.doc_type, s.fy, s.prefix, s.next_number, s.padding
       FROM document_series s JOIN branches b ON b.id = s.branch_id AND b.tenant_id = s.tenant_id
      WHERE s.tenant_id = :tenantId AND s.fy = :fy
      ORDER BY b.is_default DESC, b.name, s.doc_type`,
    { fy: fy ?? fyLabel(istDate(), ctx.tenant.fyStartMonth) },
  );
  return rows.map((r) => ({
    id: Number(r.id), branchId: Number(r.branch_id), branchName: r.branch_name, docType: r.doc_type, fy: r.fy,
    prefix: r.prefix, nextNumber: Number(r.next_number), padding: Number(r.padding),
  }));
}

export async function updateSeries(ctx: TenantCtx, id: number, input: { prefix: string; nextNumber?: number; padding?: number }) {
  return withTx(async (conn) => {
    const tdb = new TenantDb(conn, ctx.tenantId);
    const before = await tdb.one("SELECT * FROM document_series WHERE tenant_id = :tenantId AND id = :id FOR UPDATE", { id });
    if (!before) throw notFound("Number series");
    // Numbers already used must never be issued again (GST needs unique serial numbers).
    if (input.nextNumber !== undefined && input.nextNumber < Number(before.next_number) && input.prefix === before.prefix) {
      throw badRequest("series_backwards", "The next number cannot go back to a number that may already be used.");
    }
    const padding = input.padding ?? Number(before.padding);
    const sample = `${input.prefix}/${before.fy.slice(2)}/${"9".repeat(padding)}`;
    if (sample.length > 16) throw badRequest("number_too_long", "Document numbers must be 16 characters or fewer. Use a shorter prefix.");
    await tdb.exec(
      "UPDATE document_series SET prefix = :prefix, next_number = :next, padding = :padding WHERE tenant_id = :tenantId AND id = :id",
      { id, prefix: input.prefix, next: input.nextNumber ?? before.next_number, padding },
    );
    const after = await tdb.one("SELECT * FROM document_series WHERE tenant_id = :tenantId AND id = :id", { id });
    await audit(tdb, ctx, { action: "update", entityType: "document_series", entityId: id, summary: `Changed ${before.doc_type} numbering`, before, after });
    return { id, prefix: after.prefix, nextNumber: Number(after.next_number), padding: Number(after.padding) };
  });
}

export function assertOwner(ctx: TenantCtx) {
  if (ctx.role.key !== "owner") throw new AppError(403, "owner_only", "Only the owner can do this.");
}

