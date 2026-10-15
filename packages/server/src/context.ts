import { businessSettingsSchema, type BusinessSettingsInput, type Feature, type LimitKey, type Permission, istDate } from "@cba/core";
import { appTx, type Db } from "./db";
import { AppError, forbidden } from "./errors";
import type { AuthUser, ClientMeta } from "./auth/service";

export interface BusinessRow {
  id: string;
  name: string;
  legal_name: string | null;
  business_type: string;
  gstin: string | null;
  pan: string | null;
  phone: string | null;
  email: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state_code: string;
  pincode: string | null;
  logo_file_id: string | null;
  fy_start_month: number;
  settings: Record<string, unknown>;
  status: "active" | "suspended" | "deleted";
  created_at: string;
}

export interface EffectivePlan {
  code: string;
  name: string;
  /** Status of the stored subscription. */
  status: string;
  /** Plan whose limits/features currently apply (falls back to free). */
  effectiveCode: string;
  limits: Record<LimitKey, number | null>;
  features: Record<Feature, boolean>;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
}

export interface Tenant {
  db: Db;
  user: AuthUser;
  userId: string;
  businessId: string;
  business: BusinessRow;
  settings: BusinessSettingsInput;
  roleKey: string | null;
  roleName: string;
  permissions: Set<string>;
  /** null = all branches. */
  branchIds: string[] | null;
  defaultBranchId: string;
  plan: EffectivePlan;
  isSupport: boolean;
  meta: ClientMeta;
  today: string;
  can(p: Permission): boolean;
  require(p: Permission): void;
  hasFeature(f: Feature): boolean;
  requireFeature(f: Feature): void;
  audit(action: string, entityType: string, entityId: string | null, summary?: string, before?: unknown, after?: unknown): Promise<void>;
}

const READ_ONLY_ACTIONS = new Set(["view", "export"]);

async function loadEffectivePlan(db: Db, businessId: string): Promise<EffectivePlan> {
  const s = await db.maybe<Record<string, unknown>>(
    `select s.status, s.trial_ends_at, s.current_period_end, s.grace_until, p.code, p.name, p.limits, p.features
       from subscriptions s join plans p on p.id = s.plan_id where s.business_id = $1`,
    [businessId],
  );
  const free = await db.one<Record<string, unknown>>("select code, name, limits, features from plans where code = 'free'");
  const now = Date.now();
  let active = false;
  if (s) {
    const status = s.status as string;
    const until = (v: unknown) => (v ? new Date(v as string).getTime() : null);
    if (status === "trialing") active = (until(s.trial_ends_at) ?? 0) > now;
    else if (status === "active") active = until(s.current_period_end) === null || (until(s.current_period_end) ?? 0) > now || (until(s.grace_until) ?? 0) > now;
    else if (status === "past_due") active = (until(s.grace_until) ?? 0) > now;
    else if (status === "cancelled") active = (until(s.current_period_end) ?? 0) > now;
  }
  const src = active && s ? s : free;
  return {
    code: (s?.code as string) ?? "free",
    name: (s?.name as string) ?? "Free",
    status: (s?.status as string) ?? "active",
    effectiveCode: src.code as string,
    limits: src.limits as EffectivePlan["limits"],
    features: src.features as EffectivePlan["features"],
    trialEndsAt: (s?.trial_ends_at as string) ?? null,
    currentPeriodEnd: (s?.current_period_end as string) ?? null,
  };
}

export interface TenantOptions {
  /** Allow access to a suspended business (read-only). */
  allowSuspended?: boolean;
}

/**
 * Opens a tenant-scoped transaction. Membership, role, permissions and plan
 * are loaded inside the same transaction, with RLS restricting every query
 * to the selected business.
 */
export async function withTenant<T>(user: AuthUser, businessId: string, meta: ClientMeta, fn: (t: Tenant) => Promise<T>, _opts: TenantOptions = {}): Promise<T> {
  if (!/^[0-9a-f-]{36}$/i.test(businessId)) throw new AppError("FORBIDDEN", "Select a business first");
  return appTx({ userId: user.id, businessId }, async (db) => {
    const ok = await db.maybe<{ id: string }>("select app.current_business_id() as id");
    if (!ok?.id) throw new AppError("FORBIDDEN", "You are not a member of this business");
    const business = await db.one<BusinessRow>("select * from businesses where id = $1", [businessId]);
    const isSupport = !!(await db.one<{ v: boolean }>("select app.is_support_session() as v")).v;

    let roleKey: string | null = null;
    let roleName = "Support (read-only)";
    let perms: string[] = [];
    let branchIds: string[] | null = null;
    if (!isSupport) {
      const m = await db.one<{ key: string | null; name: string; permissions: string[]; branch_ids: string[] | null }>(
        `select r.key, r.name, r.permissions, m.branch_ids from memberships m join roles r on r.id = m.role_id
          where m.business_id = $1 and m.user_id = $2 and m.status = 'active'`,
        [businessId, user.id],
      );
      roleKey = m.key;
      roleName = m.name;
      perms = m.permissions;
      branchIds = m.branch_ids && m.branch_ids.length ? m.branch_ids : null;
    } else {
      const owner = await db.one<{ permissions: string[] }>("select permissions from roles where business_id = $1 and key = 'owner'", [businessId]);
      perms = owner.permissions.filter((p) => READ_ONLY_ACTIONS.has(p.split(".")[1]!) && !p.startsWith("data."));
    }
    // Suspended businesses and support sessions are read-only.
    if (business.status === "suspended") perms = perms.filter((p) => READ_ONLY_ACTIONS.has(p.split(".")[1]!) || p === "billing.edit" || p === "data.export");
    const permissions = new Set(perms);

    const branch = await db.maybe<{ id: string }>(
      `select id from branches where business_id = $1 and archived_at is null
        and ($2::uuid[] is null or id = any($2)) order by is_default desc, created_at limit 1`,
      [businessId, branchIds],
    );
    if (!branch) throw new AppError("FORBIDDEN", "You have no branch assigned in this business");

    const plan = await loadEffectivePlan(db, businessId);
    const settings = businessSettingsSchema.parse(business.settings ?? {});

    const t: Tenant = {
      db,
      user,
      userId: user.id,
      businessId,
      business,
      settings,
      roleKey,
      roleName,
      permissions,
      branchIds,
      defaultBranchId: branch.id,
      plan,
      isSupport,
      meta,
      today: istDate(),
      can: (p) => permissions.has(p),
      require(p) {
        if (!permissions.has(p)) throw forbidden(`Your role (${roleName}) does not allow this action (${p})`);
      },
      hasFeature: (f) => !!plan.features?.[f],
      requireFeature(f) {
        if (!plan.features?.[f]) {
          throw new AppError("FEATURE_NOT_IN_PLAN", `This feature is not included in your ${plan.effectiveCode} plan. Upgrade to use it.`, { feature: f });
        }
      },
      async audit(action, entityType, entityId, summary, before, after) {
        await db.exec(
          `insert into audit_logs(business_id, user_id, action, entity_type, entity_id, summary, before, after, ip, user_agent, via_support)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9::inet,$10,$11)`,
          [
            businessId, user.id, action, entityType, entityId, summary ?? null,
            before === undefined ? null : JSON.stringify(before), after === undefined ? null : JSON.stringify(after),
            meta.ip ?? null, meta.userAgent?.slice(0, 300) ?? null, isSupport,
          ],
        );
      },
    };
    return fn(t);
  });
}

/** Ensures the branch belongs to the business and the user may use it. */
export async function resolveBranch(t: Tenant, branchId?: string | null): Promise<string> {
  if (!branchId) return t.defaultBranchId;
  if (t.branchIds && !t.branchIds.includes(branchId)) throw forbidden("You do not have access to this branch");
  const b = await t.db.maybe("select id from branches where id = $1 and archived_at is null", [branchId]);
  if (!b) throw new AppError("VALIDATION", "Branch not found");
  return branchId;
}

/**
 * Enforces a numeric plan limit. Takes a transaction-level advisory lock per
 * business+limit so concurrent requests cannot both squeeze past the limit.
 */
export async function assertLimit(t: Tenant, key: LimitKey, countSql: string, params: unknown[] = []) {
  const limit = t.plan.limits?.[key];
  if (limit === null || limit === undefined) return;
  await t.db.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`${t.businessId}:${key}`]);
  const { n } = await t.db.one<{ n: number }>(countSql, params);
  if (n >= limit) {
    throw new AppError("PLAN_LIMIT", `Your ${t.plan.effectiveCode} plan allows ${limit} ${key.replace(/_/g, " ")}. Upgrade your plan to add more.`, { limit: key, max: limit });
  }
}

export function monthStartIST(today: string) {
  return `${today.slice(0, 7)}-01`;
}

export { appTx };
