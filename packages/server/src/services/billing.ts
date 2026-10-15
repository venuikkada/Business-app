import { createHmac } from "node:crypto";
import { LIMITS, FEATURES, type LimitKey } from "@cba/core";
import { platformTx, type Db } from "../db";
import { env } from "../env";
import { monthStartIST, type Tenant } from "../context";
import { AppError } from "../errors";
import { safeEqual } from "../auth/crypto";
import { camelize } from "../util";

export function razorpayConfigured() {
  return !!(env.razorpayKeyId && env.razorpayKeySecret);
}

/** Razorpay checkout signature: HMAC_SHA256(order_id + "|" + payment_id, key_secret). */
export function verifyCheckoutSignature(orderId: string, paymentId: string, signature: string, secret = env.razorpayKeySecret): boolean {
  if (!secret || !orderId || !paymentId || !signature) return false;
  const expected = createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex");
  return safeEqual(expected, signature);
}

/** Razorpay webhook signature: HMAC_SHA256(raw body, webhook_secret). */
export function verifyWebhookSignature(rawBody: string, signature: string, secret = env.razorpayWebhookSecret): boolean {
  if (!secret || !signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  return safeEqual(expected, signature);
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
let fetchImpl: FetchLike = (u, i) => fetch(u, i);
/** Test hook to stub the Razorpay HTTP API. */
export function setBillingFetch(f: FetchLike) {
  fetchImpl = f;
}

async function razorpay<T>(method: "GET" | "POST", pathname: string, body?: unknown): Promise<T> {
  const auth = Buffer.from(`${env.razorpayKeyId}:${env.razorpayKeySecret}`).toString("base64");
  const res = await fetchImpl(`https://api.razorpay.com/v1${pathname}`, {
    method,
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new AppError("INTERNAL", `Payment gateway error (${res.status})`);
  return (await res.json()) as T;
}

export async function usageSummary(t: Tenant) {
  const counts = await t.db.one<Record<LimitKey, number>>(
    `select
       (select count(*)::int from documents where doc_type = 'invoice' and finalized_at >= ($1::date::timestamp at time zone 'Asia/Kolkata')) as invoices_per_month,
       (select count(*)::int from documents where doc_type = 'quotation' and created_at >= ($1::date::timestamp at time zone 'Asia/Kolkata')) as quotations_per_month,
       (select count(*)::int from products where archived_at is null) as products,
       (select count(*)::int from parties where archived_at is null) as parties,
       (select count(*)::int from memberships where status = 'active') as users,
       (select count(*)::int from branches where archived_at is null) as branches`,
    [monthStartIST(t.today)],
  );
  return (Object.keys(LIMITS) as LimitKey[]).map((k) => ({ key: k, label: LIMITS[k], used: counts[k], limit: t.plan.limits?.[k] ?? null }));
}

export async function subscriptionOverview(t: Tenant) {
  t.require("billing.view");
  const plans = await t.db.query("select code, name, description, price_monthly, price_yearly, trial_days, limits, features, sort_order from plans where is_active and is_public order by sort_order");
  const sub = await t.db.maybe("select s.*, p.code as plan_code, p.name as plan_name from subscriptions s join plans p on p.id = s.plan_id where s.business_id = $1", [t.businessId]);
  const payments = await t.db.query("select id, amount, status, billing_interval, created_at, verified_at, failure_reason, gateway_payment_id from subscription_payments order by created_at desc limit 20");
  return {
    plan: t.plan,
    subscription: camelize(sub),
    plans: camelize(plans),
    usage: await usageSummary(t),
    features: Object.entries(FEATURES).map(([key, label]) => ({ key, label, enabled: !!t.plan.features?.[key as keyof typeof FEATURES] })),
    payments: camelize(payments),
    gatewayConfigured: razorpayConfigured(),
    razorpayKeyId: razorpayConfigured() ? env.razorpayKeyId : null,
  };
}

/** Creates a gateway order. The amount always comes from the plans table. */
export async function createCheckout(t: Tenant, planCode: string, interval: "month" | "year") {
  t.require("billing.edit");
  if (!razorpayConfigured()) throw new AppError("NOT_CONFIGURED", "Online payments are not configured yet. Contact support to upgrade.");
  const plan = await t.db.maybe<{ id: string; price_monthly: number; price_yearly: number; name: string }>("select id, price_monthly, price_yearly, name from plans where code = $1 and is_active", [planCode]);
  if (!plan) throw new AppError("VALIDATION", "Plan not found");
  const amount = interval === "year" ? plan.price_yearly : plan.price_monthly;
  if (amount <= 0) throw new AppError("VALIDATION", "This plan does not need payment");
  const sub = await t.db.one<{ id: string }>("select id from subscriptions where business_id = $1", [t.businessId]);
  const order = await razorpay<{ id: string; amount: number; currency: string }>("POST", "/orders", {
    amount,
    currency: "INR",
    receipt: `${t.businessId.slice(0, 8)}-${Date.now()}`,
    notes: { business_id: t.businessId, plan_code: planCode, interval },
  });
  if (order.amount !== amount) throw new AppError("INTERNAL", "Gateway returned an unexpected amount");
  await platformTx({ userId: t.userId }, (db) =>
    db.exec(
      `insert into subscription_payments(business_id, subscription_id, plan_id, billing_interval, amount, gateway, gateway_order_id, created_by)
       values ($1,$2,$3,$4,$5,'razorpay',$6,$7)`,
      [t.businessId, sub.id, plan.id, interval, amount, order.id, t.userId],
    ),
  );
  await t.audit("billing.checkout", "subscription", sub.id, `Checkout started for ${plan.name} (${interval})`);
  return { orderId: order.id, amount, currency: "INR", keyId: env.razorpayKeyId, planName: plan.name, businessName: t.business.name, email: t.user.email, phone: t.user.phone };
}

/**
 * Marks a gateway order paid and extends the subscription. Idempotent: a
 * second call for the same order (checkout callback + webhook) is a no-op.
 */
export async function activatePaidOrder(db: Db, orderId: string, paymentId: string, raw: unknown) {
  const sp = await db.maybe<{ id: string; status: string; business_id: string; subscription_id: string; plan_id: string; billing_interval: string; amount: number }>(
    "select * from subscription_payments where gateway_order_id = $1 for update",
    [orderId],
  );
  if (!sp) throw new AppError("NOT_FOUND", "Unknown order");
  if (sp.status === "paid") return { alreadyProcessed: true, businessId: sp.business_id };
  const sub = await db.one<{ plan_id: string; status: string; current_period_end: string | null }>("select plan_id, status, current_period_end from subscriptions where id = $1 for update", [sp.subscription_id]);
  // Renewing the same plan early extends from the current end date.
  const extendFrom = sub.plan_id === sp.plan_id && sub.status === "active" && sub.current_period_end && new Date(sub.current_period_end) > new Date() ? sub.current_period_end : new Date().toISOString();
  await db.exec("update subscription_payments set status = 'paid', gateway_payment_id = $2, verified_at = now(), raw = $3 where id = $1", [sp.id, paymentId, JSON.stringify(raw ?? {})]);
  await db.exec(
    `update subscriptions set plan_id = $2, status = 'active', billing_interval = $3, trial_ends_at = null, cancel_at_period_end = false, cancelled_at = null,
       current_period_start = now(), current_period_end = $4::timestamptz + case when $3 = 'year' then interval '1 year' else interval '1 month' end,
       grace_until = null, gateway = 'razorpay'
     where id = $1`,
    [sp.subscription_id, sp.plan_id, sp.billing_interval, extendFrom],
  );
  await db.exec(
    "insert into platform_audit_logs(action, target_type, target_id, details) values ('subscription.paid', 'business', $1, $2)",
    [sp.business_id, JSON.stringify({ orderId, paymentId, amount: sp.amount })],
  );
  return { alreadyProcessed: false, businessId: sp.business_id };
}

/** Checkout callback from the browser/app. The signature AND the gateway's own record are verified. */
export async function verifyCheckout(t: Tenant, input: { orderId: string; paymentId: string; signature: string }) {
  t.require("billing.edit");
  if (!razorpayConfigured()) throw new AppError("NOT_CONFIGURED", "Payments are not configured");
  if (!verifyCheckoutSignature(input.orderId, input.paymentId, input.signature)) throw new AppError("VALIDATION", "Payment verification failed");
  const owned = await t.db.maybe("select 1 from subscription_payments where gateway_order_id = $1 and business_id = $2", [input.orderId, t.businessId]);
  if (!owned) throw new AppError("VALIDATION", "This payment does not belong to this business");
  const payment = await razorpay<{ id: string; order_id: string; status: string; amount: number; currency: string }>("GET", `/payments/${encodeURIComponent(input.paymentId)}`);
  const sp = await t.db.one<{ amount: number }>("select amount from subscription_payments where gateway_order_id = $1", [input.orderId]);
  if (payment.order_id !== input.orderId || payment.status !== "captured" || payment.amount !== sp.amount || payment.currency !== "INR") {
    throw new AppError("VALIDATION", "Payment is not captured yet. If money was debited, it will be confirmed automatically within a few minutes.");
  }
  const r = await platformTx({ userId: t.userId }, (db) => activatePaidOrder(db, input.orderId, input.paymentId, payment));
  await t.audit("billing.paid", "subscription", null, `Subscription payment verified (${input.paymentId})`);
  return r;
}

/** Razorpay webhook (server-to-server). */
export async function handleRazorpayWebhook(rawBody: string, signature: string, eventId: string | null) {
  if (!verifyWebhookSignature(rawBody, signature)) throw new AppError("UNAUTHENTICATED", "Invalid webhook signature");
  const evt = JSON.parse(rawBody) as { event: string; payload?: { payment?: { entity?: { id: string; order_id: string; amount: number; status: string; error_description?: string } } } };
  return platformTx({}, async (db) => {
    const id = eventId ?? `${evt.event}:${evt.payload?.payment?.entity?.id ?? Date.now()}`;
    const fresh = await db.maybe("insert into payment_gateway_events(id, gateway, event_type, payload) values ($1,'razorpay',$2,$3) on conflict do nothing returning id", [id, evt.event, rawBody]);
    if (!fresh) return { duplicate: true };
    const p = evt.payload?.payment?.entity;
    if (p && (evt.event === "payment.captured" || evt.event === "order.paid")) {
      const sp = await db.maybe<{ amount: number }>("select amount from subscription_payments where gateway_order_id = $1", [p.order_id]);
      if (sp && sp.amount === p.amount) await activatePaidOrder(db, p.order_id, p.id, p);
    } else if (p && evt.event === "payment.failed") {
      await db.exec("update subscription_payments set status = 'failed', failure_reason = $2 where gateway_order_id = $1 and status = 'created'", [p.order_id, p.error_description ?? "Payment failed"]);
    }
    await db.exec("update payment_gateway_events set processed_at = now() where id = $1", [id]);
    return { duplicate: false };
  });
}

export async function cancelAtPeriodEnd(t: Tenant, cancel: boolean) {
  t.require("billing.edit");
  await platformTx({ userId: t.userId }, (db) =>
    db.exec(
      `update subscriptions set cancel_at_period_end = $2, cancelled_at = case when $2 then now() else null end,
         status = case when $2 and status = 'active' then 'cancelled' when not $2 and status = 'cancelled' then 'active' else status end
       where business_id = $1`,
      [t.businessId, cancel],
    ),
  );
  await t.audit(cancel ? "billing.cancel" : "billing.resume", "subscription", null, cancel ? "Subscription set to cancel at period end" : "Cancellation withdrawn");
}
