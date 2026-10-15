/**
 * Super-admin (platform owner) services. These run on the cba_platform
 * database role, which has NO privileges on tenant business tables
 * (customers, products, invoices, payments…). Cross-tenant business data is
 * only reachable through an owner-approved, time-limited support grant,
 * exercised from the regular web app and audited there.
 */
import { z } from "zod";
import { FEATURES, LIMITS, istDate } from "@cba/core";
import { platformTx, type Db } from "../db";
import { AppError, forbidden, notFound } from "../errors";
import { authenticate, login, beginTotpSetup, confirmTotpSetup, logout, type AuthUser, type AuthSession, type ClientMeta } from "../auth/service";
import { camelize, likePattern } from "../util";

export interface AdminCtx {
  user: AuthUser;
  session: AuthSession;
  meta: ClientMeta;
}

export const adminLogin = (input: { email: string; password: string; totp?: string }, meta: ClientMeta) => login(input, "admin", meta, platformTx);
export const adminLogout = (token: string) => logout(token, platformTx);
export const adminBeginTotp = (userId: string) => beginTotpSetup(userId, platformTx);
export const adminConfirmTotp = (userId: string, sessionId: string, code: string) => confirmTotpSetup(userId, sessionId, code, platformTx);

/**
 * Returns the admin context. `allowMfaSetup` lets an admin who has not yet
 * enrolled TOTP reach only the enrolment screen.
 */
export async function authenticateAdmin(token: string | null | undefined, meta: ClientMeta, allowMfaSetup = false): Promise<AdminCtx | null> {
  const a = await authenticate(token, platformTx);
  if (!a || a.session.kind !== "admin" || !a.user.isPlatformAdmin) return null;
  if (!a.session.mfaVerified && !allowMfaSetup) return null;
  return { ...a, meta };
}

async function audit(db: Db, ctx: AdminCtx, action: string, targetType: string, targetId: string | null, details: Record<string, unknown> = {}) {
  await db.exec(
    "insert into platform_audit_logs(actor_user_id, action, target_type, target_id, details, ip) values ($1,$2,$3,$4,$5,$6::inet)",
    [ctx.user.id, action, targetType, targetId, JSON.stringify(details), ctx.meta.ip ?? null],
  );
}

function run<T>(ctx: AdminCtx, fn: (db: Db) => Promise<T>) {
  if (!ctx.user.isPlatformAdmin) throw forbidden();
  return platformTx({ userId: ctx.user.id }, fn);
}

export async function platformMetrics(ctx: AdminCtx) {
  return run(ctx, async (db) => {
    const totals = await db.one<Record<string, number>>(
      `select (select count(*)::int from businesses where status <> 'deleted') as businesses,
              (select count(*)::int from businesses where status = 'suspended') as suspended,
              (select count(*)::int from users where status = 'active') as users,
              (select count(*)::int from users where created_at > now() - interval '30 days') as signups_30d,
              (select count(*)::int from subscriptions where status = 'trialing' and trial_ends_at > now()) as trials,
              (select count(*)::int from support_tickets where status = 'open') as open_tickets`,
    );
    const byPlan = await db.query(
      `select p.code, p.name, count(s.id)::int as subscriptions,
              count(s.id) filter (where s.status = 'active' and p.price_monthly > 0)::int as paying
         from plans p left join subscriptions s on s.plan_id = p.id group by p.id order by p.sort_order`,
    );
    const mrr = await db.one<{ mrr: number }>(
      `select coalesce(sum(case when s.billing_interval = 'year' then p.price_yearly / 12.0 else p.price_monthly end), 0)::bigint as mrr
         from subscriptions s join plans p on p.id = s.plan_id where s.status = 'active' and p.price_monthly > 0`,
    );
    const revenue30 = await db.one<{ v: number }>("select coalesce(sum(amount), 0)::bigint v from subscription_payments where status = 'paid' and verified_at > now() - interval '30 days'");
    return { ...totals, byPlan: camelize(byPlan), mrrPaise: mrr.mrr, revenue30dPaise: revenue30.v };
  });
}

export async function listBusinesses(ctx: AdminCtx, q: { q?: string; status?: string; plan?: string; page?: number }) {
  return run(ctx, async (db) => {
    const page = Math.max(1, Number(q.page ?? 1));
    const params: unknown[] = [];
    const where = ["b.status <> 'deleted' or b.purge_after > now()"];
    if (q.q) {
      params.push(likePattern(q.q));
      where.push(`(b.name ilike $${params.length} or b.gstin ilike $${params.length} or u.email ilike $${params.length} or b.city ilike $${params.length})`);
    }
    if (q.status) {
      params.push(q.status);
      where.push(`b.status = $${params.length}`);
    }
    if (q.plan) {
      params.push(q.plan);
      where.push(`p.code = $${params.length}`);
    }
    params.push(50, (page - 1) * 50);
    const rows = await db.query(
      `select b.id, b.name, b.city, b.state_code, b.gstin, b.status, b.created_at, u.email as owner_email, u.full_name as owner_name,
              p.code as plan_code, p.name as plan_name, s.status as subscription_status, s.trial_ends_at, s.current_period_end,
              st.members, st.invoices_30d, st.last_activity
         from businesses b join users u on u.id = b.created_by
         left join subscriptions s on s.business_id = b.id left join plans p on p.id = s.plan_id
         left join app.platform_business_stats() st on st.business_id = b.id
        where (${where.join(") and (")}) order by b.created_at desc limit $${params.length - 1} offset $${params.length}`,
      params,
    );
    return { items: camelize(rows), page };
  });
}

export async function getBusinessForAdmin(ctx: AdminCtx, id: string) {
  return run(ctx, async (db) => {
    const b = await db.maybe(
      `select b.id, b.name, b.legal_name, b.business_type, b.gstin, b.city, b.state_code, b.phone, b.email, b.status, b.suspended_reason,
              b.created_at, b.deletion_requested_at, b.purge_after, u.email as owner_email, u.full_name as owner_name, u.phone as owner_phone
         from businesses b join users u on u.id = b.created_by where b.id = $1`,
      [id],
    );
    if (!b) throw notFound("Business");
    const sub = await db.maybe("select s.*, p.code as plan_code, p.name as plan_name from subscriptions s join plans p on p.id = s.plan_id where s.business_id = $1", [id]);
    const payments = await db.query("select id, amount, status, billing_interval, gateway_order_id, gateway_payment_id, failure_reason, created_at, verified_at from subscription_payments where business_id = $1 order by created_at desc limit 50", [id]);
    const stats = await db.maybe("select * from app.platform_business_stats() where business_id = $1", [id]);
    const grants = await db.query("select g.*, u.email as staff_email from support_access_grants g join users u on u.id = g.platform_user_id where g.business_id = $1 order by requested_at desc limit 20", [id]);
    const tickets = await db.query("select id, subject, status, priority, created_at, updated_at from support_tickets where business_id = $1 order by updated_at desc limit 20", [id]);
    const auditRows = await db.query("select a.*, u.email as actor_email from platform_audit_logs a left join users u on u.id = a.actor_user_id where a.target_id = $1 order by a.created_at desc limit 50", [id]);
    return { business: camelize(b), subscription: camelize(sub), payments: camelize(payments), stats: camelize(stats), grants: camelize(grants), tickets: camelize(tickets), audit: camelize(auditRows) };
  });
}

export async function setBusinessStatus(ctx: AdminCtx, id: string, status: "active" | "suspended", reason: string) {
  if (!reason || reason.trim().length < 5) throw new AppError("VALIDATION", "Enter a reason (at least 5 characters)");
  return run(ctx, async (db) => {
    const n = await db.exec("update businesses set status = $2, suspended_reason = $3 where id = $1 and status <> 'deleted'", [id, status, status === "suspended" ? reason : null]);
    if (!n) throw notFound("Business");
    await audit(db, ctx, `business.${status === "active" ? "reactivate" : "suspend"}`, "business", id, { reason });
  });
}

const overrideSchema = z.object({
  planCode: z.string().min(2).max(32),
  status: z.enum(["trialing", "active", "past_due", "cancelled", "expired"]),
  periodEnd: z.string().datetime({ offset: true }).nullable().optional(),
  reason: z.string().trim().min(5).max(500),
});

/** Manual plan change (e.g. offline/bank payment, goodwill extension). Always audited. */
export async function overrideSubscription(ctx: AdminCtx, businessId: string, input: z.input<typeof overrideSchema>) {
  const d = overrideSchema.parse(input);
  return run(ctx, async (db) => {
    const plan = await db.maybe<{ id: string }>("select id from plans where code = $1", [d.planCode]);
    if (!plan) throw new AppError("VALIDATION", "Plan not found");
    const before = await db.maybe("select * from subscriptions where business_id = $1", [businessId]);
    if (!before) throw notFound("Subscription");
    await db.exec(
      `update subscriptions set plan_id = $2, status = $3,
         current_period_end = case when $3 = 'trialing' then current_period_end else $4::timestamptz end,
         trial_ends_at = case when $3 = 'trialing' then $4::timestamptz else trial_ends_at end,
         gateway = coalesce(gateway, 'manual') where business_id = $1`,
      [businessId, plan.id, d.status, d.periodEnd ?? null],
    );
    await audit(db, ctx, "subscription.override", "business", businessId, { before, after: d });
  });
}

const planSchema = z.object({
  code: z.string().regex(/^[a-z0-9_]{2,32}$/),
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(300).nullable().optional(),
  priceMonthly: z.number().int().min(0).max(100_000_00),
  priceYearly: z.number().int().min(0).max(1_000_000_00),
  trialDays: z.number().int().min(0).max(90),
  limits: z.record(z.enum(Object.keys(LIMITS) as [string, ...string[]]), z.number().int().min(0).nullable()),
  features: z.record(z.enum(Object.keys(FEATURES) as [string, ...string[]]), z.boolean()),
  isActive: z.boolean(),
  isPublic: z.boolean(),
  sortOrder: z.number().int().min(0).max(100),
});

export async function listPlans(ctx: AdminCtx) {
  return run(ctx, async (db) => camelize(await db.query("select p.*, (select count(*)::int from subscriptions s where s.plan_id = p.id) as subscribers from plans p order by sort_order")));
}

export async function savePlan(ctx: AdminCtx, input: z.input<typeof planSchema>) {
  const d = planSchema.parse(input);
  for (const k of Object.keys(LIMITS)) if (!(k in d.limits)) throw new AppError("VALIDATION", `Missing limit ${k}`);
  for (const k of Object.keys(FEATURES)) if (!(k in d.features)) throw new AppError("VALIDATION", `Missing feature ${k}`);
  if (d.code === "free" && (d.priceMonthly > 0 || !d.isActive)) throw new AppError("VALIDATION", "The free plan must stay active and free; it is the fallback for lapsed subscriptions");
  return run(ctx, async (db) => {
    const before = await db.maybe("select * from plans where code = $1", [d.code]);
    await db.exec(
      `insert into plans(code, name, description, price_monthly, price_yearly, trial_days, limits, features, is_active, is_public, sort_order)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       on conflict (code) do update set name = excluded.name, description = excluded.description, price_monthly = excluded.price_monthly,
         price_yearly = excluded.price_yearly, trial_days = excluded.trial_days, limits = excluded.limits, features = excluded.features,
         is_active = excluded.is_active, is_public = excluded.is_public, sort_order = excluded.sort_order`,
      [d.code, d.name, d.description ?? null, d.priceMonthly, d.priceYearly, d.trialDays, JSON.stringify(d.limits), JSON.stringify(d.features), d.isActive, d.isPublic, d.sortOrder],
    );
    await audit(db, ctx, before ? "plan.update" : "plan.create", "plan", d.code, { before, after: d });
  });
}

export async function getPlatformSettings(ctx: AdminCtx) {
  return run(ctx, async (db) => camelize(await db.query("select key, value, updated_at from platform_settings order by key")));
}

export async function setPlatformSetting(ctx: AdminCtx, key: string, value: unknown) {
  const allowed: Record<string, z.ZodTypeAny> = {
    max_unpaid_businesses_per_user: z.number().int().min(1).max(20),
    grace_period_days: z.number().int().min(0).max(30),
    support_grant_hours: z.number().int().min(1).max(72),
  };
  const schema = allowed[key];
  if (!schema) throw new AppError("VALIDATION", "Unknown setting");
  const v = schema.parse(value);
  return run(ctx, async (db) => {
    await db.exec("insert into platform_settings(key, value, updated_by, updated_at) values ($1,$2,$3,now()) on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()", [key, JSON.stringify(v), ctx.user.id]);
    await audit(db, ctx, "setting.update", "setting", key, { value: v });
  });
}

export async function listUsers(ctx: AdminCtx, q: { q?: string; page?: number }) {
  return run(ctx, async (db) => {
    const page = Math.max(1, Number(q.page ?? 1));
    const params: unknown[] = [];
    let where = "true";
    if (q.q) {
      params.push(likePattern(q.q));
      where = "(email ilike $1 or full_name ilike $1 or phone ilike $1)";
    }
    params.push(50, (page - 1) * 50);
    const rows = await db.query(
      `select id, email, full_name, phone, status, is_platform_admin, email_verified_at, totp_enabled_at, last_login_at, created_at,
              (select count(*)::int from memberships m where m.user_id = users.id and m.status = 'active') as businesses
         from users where ${where} order by created_at desc limit $${params.length - 1} offset $${params.length}`,
      params,
    );
    return { items: camelize(rows), page };
  });
}

export async function setUserStatus(ctx: AdminCtx, userId: string, status: "active" | "disabled", reason: string) {
  if (userId === ctx.user.id) throw new AppError("BUSINESS_RULE", "You cannot disable yourself");
  if (!reason || reason.trim().length < 5) throw new AppError("VALIDATION", "Enter a reason");
  return run(ctx, async (db) => {
    const n = await db.exec("update users set status = $2 where id = $1 and status <> 'deleted'", [userId, status]);
    if (!n) throw notFound("User");
    if (status === "disabled") await db.exec("update sessions set revoked_at = now() where user_id = $1 and revoked_at is null", [userId]);
    await audit(db, ctx, `user.${status}`, "user", userId, { reason });
  });
}

/** Asks the business owner for time-limited read-only support access. */
export async function requestSupportAccess(ctx: AdminCtx, businessId: string, reason: string) {
  if (!reason || reason.trim().length < 10) throw new AppError("VALIDATION", "Explain why access is needed (at least 10 characters)");
  return run(ctx, async (db) => {
    const b = await db.maybe("select 1 from businesses where id = $1", [businessId]);
    if (!b) throw notFound("Business");
    const r = await db.one<{ id: string }>("insert into support_access_grants(business_id, platform_user_id, reason) values ($1,$2,$3) returning id", [businessId, ctx.user.id, reason.trim()]);
    await audit(db, ctx, "support.request_access", "business", businessId, { reason, grantId: r.id });
    return r;
  });
}

export async function listSupportTicketsAdmin(ctx: AdminCtx, status?: string) {
  return run(ctx, async (db) =>
    camelize(
      await db.query(
        `select t.*, b.name as business_name, u.email as created_by_email from support_tickets t join businesses b on b.id = t.business_id join users u on u.id = t.created_by
          where ($1::text is null or t.status = $1) order by case t.priority when 'high' then 0 else 1 end, t.updated_at desc limit 100`,
        [status ?? null],
      ),
    ),
  );
}

export async function getSupportTicketAdmin(ctx: AdminCtx, id: string) {
  return run(ctx, async (db) => {
    const tk = await db.maybe("select t.*, b.name as business_name from support_tickets t join businesses b on b.id = t.business_id where t.id = $1", [id]);
    if (!tk) throw notFound("Ticket");
    const msgs = await db.query("select m.id, m.body, m.is_staff, m.created_at, u.full_name as author from support_ticket_messages m left join users u on u.id = m.author_user_id where m.ticket_id = $1 order by m.created_at", [id]);
    return { ...camelize<Record<string, unknown>>(tk), messages: camelize(msgs) };
  });
}

export async function replySupportTicketAdmin(ctx: AdminCtx, id: string, body: string, close = false) {
  if (!body?.trim()) throw new AppError("VALIDATION", "Enter a reply");
  return run(ctx, async (db) => {
    const tk = await db.maybe<{ business_id: string }>("select business_id from support_tickets where id = $1", [id]);
    if (!tk) throw notFound("Ticket");
    await db.exec("insert into support_ticket_messages(business_id, ticket_id, author_user_id, is_staff, body) values ($1,$2,$3,true,$4)", [tk.business_id, id, ctx.user.id, body.trim().slice(0, 5000)]);
    await db.exec("update support_tickets set status = $2 where id = $1", [id, close ? "closed" : "waiting_on_customer"]);
    await audit(db, ctx, "support.reply", "support_ticket", id, { close });
  });
}

export async function platformAudit(ctx: AdminCtx, page = 1) {
  return run(ctx, async (db) =>
    camelize(
      await db.query(
        "select a.*, a.ip::text as ip, u.email as actor_email from platform_audit_logs a left join users u on u.id = a.actor_user_id order by a.created_at desc limit 100 offset $1",
        [(Math.max(1, page) - 1) * 100],
      ),
    ),
  );
}

/** Daily jobs (notifications, expiries, purge). Safe to run more than once a day. */
export async function runDailyJobs(today = istDate()) {
  return platformTx({}, async (db) => (await db.one<{ r: Record<string, number> }>("select app.daily_maintenance($1::date) as r", [today])).r);
}
