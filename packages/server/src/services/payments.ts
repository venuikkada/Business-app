import { paymentSchema, D, type PaymentInput } from "@cba/core";
import type { z } from "zod";
import { resolveBranch, type Tenant } from "../context";
import { AppError, notFound } from "../errors";
import { camelize, likePattern, orderBy, parseList } from "../util";
import { nextNumber } from "./documents";
import { canApprove, consumeApproval, requireApproval } from "./approvals";

/** Which documents a payment in/out may settle. */
const SETTLES: Record<"in" | "out", string[]> = { in: ["invoice", "debit_note"], out: ["purchase_bill", "credit_note"] };

export async function defaultAccountFor(t: Tenant, method: string): Promise<string | null> {
  const type = method === "cash" ? "cash" : "bank";
  const a = await t.db.maybe<{ id: string }>("select id from accounts where type = $1 and is_default and archived_at is null", [type]);
  return a?.id ?? null;
}

export async function unpaidDocuments(t: Tenant, partyId: string, direction: "in" | "out") {
  t.require("payments.view");
  return camelize(
    await t.db.query(
      `select id, doc_type, number, issue_date, due_date, grand_total, amount_settled, balance_due
         from documents where party_id = $1 and doc_type = any($2) and status in ('issued','partially_paid')
              and balance_due > 0 order by due_date nulls last, issue_date, sequence_no`,
      [partyId, SETTLES[direction]],
    ),
  );
}

export interface RecordPaymentOptions {
  /** Allocate the unallocated part to the oldest open documents. */
  autoAllocate?: boolean;
}

export async function recordPayment(t: Tenant, input: z.input<typeof paymentSchema>, opts: RecordPaymentOptions = {}) {
  t.require("payments.create");
  const d: PaymentInput = paymentSchema.parse(input);
  const party = await t.db.maybe<{ name: string; is_customer: boolean; is_supplier: boolean }>("select name, is_customer, is_supplier from parties where id = $1", [d.partyId]);
  if (!party) throw new AppError("VALIDATION", "Customer/supplier not found");
  if (d.paidOn > t.today) throw new AppError("VALIDATION", "Payment date cannot be in the future");

  let allocations = d.allocations;
  if (!allocations.length && opts.autoAllocate) {
    let left = new D(d.amount);
    const open = await t.db.query<{ id: string; balance_due: string }>(
      `select id, balance_due from documents where party_id = $1 and doc_type = any($2) and status in ('issued','partially_paid') and balance_due > 0
        order by due_date nulls last, issue_date, sequence_no for update`,
      [d.partyId, SETTLES[d.direction]],
    );
    allocations = [];
    for (const o of open) {
      if (left.lte(0)) break;
      const a = D.min(left, new D(o.balance_due));
      allocations.push({ documentId: o.id, amount: a.toFixed(2) });
      left = left.sub(a);
    }
  }

  const allocTotal = allocations.reduce((s, a) => s.add(a.amount), new D(0));
  if (allocTotal.gt(d.amount)) throw new AppError("VALIDATION", "Allocated amount is more than the payment amount");
  const seen = new Set<string>();
  let isRefund = d.direction === "out" && party.is_customer && !party.is_supplier;
  for (const a of allocations) {
    if (seen.has(a.documentId)) throw new AppError("VALIDATION", "Each document can be allocated only once per payment");
    seen.add(a.documentId);
    const doc = await t.db.maybe<{ doc_type: string; status: string; party_id: string; balance_due: string; number: string }>(
      "select doc_type, status, party_id, balance_due, number from documents where id = $1 for update",
      [a.documentId],
    );
    if (!doc) throw new AppError("VALIDATION", "Document to allocate not found");
    if (doc.party_id !== d.partyId) throw new AppError("VALIDATION", `${doc.number} belongs to a different customer/supplier`);
    if (!SETTLES[d.direction].includes(doc.doc_type)) throw new AppError("VALIDATION", `A payment ${d.direction === "in" ? "received" : "made"} cannot settle ${doc.number}`);
    if (!["issued", "partially_paid"].includes(doc.status)) throw new AppError("BUSINESS_RULE", `${doc.number} is ${doc.status} and cannot take payments`);
    if (new D(a.amount).gt(doc.balance_due)) throw new AppError("BUSINESS_RULE", `${doc.number} has only ₹${doc.balance_due} outstanding`);
    if (doc.doc_type === "credit_note") isRefund = true;
  }

  if (isRefund && t.settings.refundApprovalAmount !== null && new D(d.amount).gt(t.settings.refundApprovalAmount) && !canApprove(t, "refund")) {
    const payload = { partyId: d.partyId, amount: d.amount, method: d.method };
    if (!d.approvalId) await requireApproval(t, "refund", "party", d.partyId, payload, `Refund of ₹${d.amount} to ${party.name}`);
    await consumeApproval(t, d.approvalId!, "refund", d.partyId, payload);
  }

  const accountId = d.accountId ?? (await defaultAccountFor(t, d.method));
  if (d.accountId) {
    const acc = await t.db.maybe("select 1 from accounts where id = $1 and archived_at is null", [d.accountId]);
    if (!acc) throw new AppError("VALIDATION", "Account not found");
  }
  const branchId = await resolveBranch(t, null);
  const { number } = await nextNumber(t, d.direction === "in" ? "payment_in" : "payment_out", d.paidOn, d.direction === "in" ? "RCPT" : "PAY");
  const p = await t.db.one<{ id: string }>(
    `insert into payments(business_id, branch_id, direction, number, party_id, amount, method, account_id, paid_on, reference, notes, approval_id, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id`,
    [t.businessId, branchId, d.direction, number, d.partyId, d.amount, d.method, accountId, d.paidOn, d.reference, d.notes, d.approvalId ?? null, t.userId],
  );
  for (const a of allocations) {
    await t.db.exec("insert into allocations(business_id, document_id, payment_id, amount, created_by) values ($1,$2,$3,$4,$5)", [t.businessId, a.documentId, p.id, a.amount, t.userId]);
  }
  if (accountId) {
    await t.db.exec(
      `insert into account_transactions(business_id, account_id, txn_date, amount, kind, source_type, source_id, notes, created_by)
       values ($1,$2,$3,$4,$5,'payment',$6,$7,$8)`,
      [t.businessId, accountId, d.paidOn, d.direction === "in" ? d.amount : `-${d.amount}`, d.direction === "in" ? "payment_in" : "payment_out", p.id, `${number} ${party.name}`, t.userId],
    );
  }
  await t.audit("payment.create", "payment", p.id, `${d.direction === "in" ? "Received" : "Paid"} ₹${d.amount} ${d.direction === "in" ? "from" : "to"} ${party.name} (${d.method})`, undefined, { ...d, allocations });
  return getPayment(t, p.id);
}

export async function voidPayment(t: Tenant, id: string, reason: string) {
  t.require("payments.delete");
  if (!reason || reason.trim().length < 3) throw new AppError("VALIDATION", "Enter a reason");
  const p = await t.db.maybe<{ status: string; number: string; amount: string; account_id: string | null; direction: string }>(
    "select status, number, amount, account_id, direction from payments where id = $1 for update",
    [id],
  );
  if (!p) throw notFound("Payment");
  if (p.status === "void") throw new AppError("CONFLICT", "Payment is already void");
  // Status change re-settles every allocated document (trigger).
  await t.db.exec("update payments set status = 'void', voided_by = $2, voided_at = now(), void_reason = $3 where id = $1", [id, t.userId, reason.trim()]);
  if (p.account_id) {
    await t.db.exec(
      `insert into account_transactions(business_id, account_id, txn_date, amount, kind, source_type, source_id, notes, created_by)
       values ($1,$2,$3,$4,'reversal','payment_void',$5,$6,$7)`,
      [t.businessId, p.account_id, t.today, p.direction === "in" ? `-${p.amount}` : p.amount, id, `Void ${p.number}: ${reason}`, t.userId],
    );
  }
  await t.audit("payment.void", "payment", id, `Voided ${p.number} (₹${p.amount}): ${reason}`);
}

export async function getPayment(t: Tenant, id: string) {
  t.require("payments.view");
  const p = await t.db.maybe<Record<string, unknown>>(
    `select p.*, pa.name as party_name, pa.phone as party_phone, a.name as account_name, u.full_name as created_by_name,
            p.amount - coalesce((select sum(amount) from allocations x where x.payment_id = p.id), 0) as unallocated
       from payments p join parties pa on pa.id = p.party_id left join accounts a on a.id = p.account_id left join users u on u.id = p.created_by
      where p.id = $1`,
    [id],
  );
  if (!p) throw notFound("Payment");
  const allocs = await t.db.query(
    `select a.id, a.amount, d.id as document_id, d.number, d.doc_type, d.issue_date, d.grand_total, d.balance_due
       from allocations a join documents d on d.id = a.document_id where a.payment_id = $1 order by d.issue_date`,
    [id],
  );
  return { ...camelize<Record<string, unknown>>(p), allocations: camelize<Record<string, unknown>[]>(allocs) } as Record<string, unknown> & { allocations: Record<string, unknown>[] };
}

/** Allocates an existing payment's unallocated balance to a document. */
export async function allocateExisting(t: Tenant, paymentId: string, documentId: string, amount: string) {
  t.require("payments.create");
  const p = await getPayment(t, paymentId);
  if (p.status !== "active") throw new AppError("BUSINESS_RULE", "Payment is void");
  if (new D(amount).lte(0) || new D(amount).gt(p.unallocated as string)) throw new AppError("VALIDATION", `Only ₹${p.unallocated} is unallocated`);
  const doc = await t.db.maybe<{ party_id: string; doc_type: string; status: string; balance_due: string; number: string }>(
    "select party_id, doc_type, status, balance_due, number from documents where id = $1 for update",
    [documentId],
  );
  if (!doc || doc.party_id !== p.partyId) throw new AppError("VALIDATION", "Document not found for this party");
  if (!SETTLES[p.direction as "in" | "out"].includes(doc.doc_type) || !["issued", "partially_paid"].includes(doc.status)) throw new AppError("BUSINESS_RULE", `${doc.number} cannot take this payment`);
  if (new D(amount).gt(doc.balance_due)) throw new AppError("BUSINESS_RULE", `${doc.number} has only ₹${doc.balance_due} outstanding`);
  await t.db.exec("insert into allocations(business_id, document_id, payment_id, amount, created_by) values ($1,$2,$3,$4,$5)", [t.businessId, documentId, paymentId, amount, t.userId]);
  await t.audit("payment.allocate", "payment", paymentId, `₹${amount} allocated to ${doc.number}`);
  return getPayment(t, paymentId);
}

export async function listPayments(t: Tenant, query: unknown) {
  t.require("payments.view");
  const q = parseList(query);
  const extra = (query ?? {}) as { direction?: string; partyId?: string; method?: string };
  const params: unknown[] = [];
  const where = ["true"];
  if (extra.direction === "in" || extra.direction === "out") {
    params.push(extra.direction);
    where.push(`p.direction = $${params.length}`);
  }
  if (extra.partyId && /^[0-9a-f-]{36}$/.test(extra.partyId)) {
    params.push(extra.partyId);
    where.push(`p.party_id = $${params.length}`);
  }
  if (extra.method) {
    params.push(extra.method);
    where.push(`p.method = $${params.length}`);
  }
  if (q.status === "active" || q.status === "void") {
    params.push(q.status);
    where.push(`p.status = $${params.length}`);
  }
  if (q.from) {
    params.push(q.from);
    where.push(`p.paid_on >= $${params.length}`);
  }
  if (q.to) {
    params.push(q.to);
    where.push(`p.paid_on <= $${params.length}`);
  }
  if (q.q) {
    params.push(likePattern(q.q));
    where.push(`(p.number ilike $${params.length} or pa.name ilike $${params.length} or p.reference ilike $${params.length})`);
  }
  const w = where.join(" and ");
  const tot = await t.db.one<{ n: number; total_in: string; total_out: string }>(
    `select count(*)::int n, coalesce(sum(amount) filter (where direction='in' and status='active'),0) total_in,
            coalesce(sum(amount) filter (where direction='out' and status='active'),0) total_out
       from payments p join parties pa on pa.id = p.party_id where ${w}`,
    params,
  );
  const order = orderBy(q.sort, { date: "p.paid_on", amount: "p.amount", party: "lower(pa.name)" }, "date", q.dir);
  params.push(q.pageSize, (q.page - 1) * q.pageSize);
  const rows = await t.db.query(
    `select p.id, p.number, p.direction, p.amount, p.method, p.paid_on, p.reference, p.status, pa.id as party_id, pa.name as party_name, a.name as account_name
       from payments p join parties pa on pa.id = p.party_id left join accounts a on a.id = p.account_id
      where ${w} order by ${order}, p.created_at desc limit $${params.length - 1} offset $${params.length}`,
    params,
  );
  return { items: camelize(rows), total: tot.n, page: q.page, pageSize: q.pageSize, totalIn: tot.total_in, totalOut: tot.total_out };
}

/**
 * Receivables (or payables) with aging buckets from each document's due date.
 * Also returns each party's net ledger balance, which includes opening
 * balances and unallocated advances.
 */
export async function outstandingReport(t: Tenant, side: "receivable" | "payable", asOf?: string) {
  t.require("payments.view");
  const date = asOf ?? t.today;
  const types = side === "receivable" ? ["invoice"] : ["purchase_bill"];
  const rows = await t.db.query<Record<string, string>>(
    `select pa.id as party_id, pa.name as party_name, pa.phone as party_phone,
            sum(d.balance_due) as total,
            sum(d.balance_due) filter (where d.due_date >= $2 or d.due_date is null) as not_due,
            sum(d.balance_due) filter (where $2 - d.due_date between 1 and 30) as d1_30,
            sum(d.balance_due) filter (where $2 - d.due_date between 31 and 60) as d31_60,
            sum(d.balance_due) filter (where $2 - d.due_date between 61 and 90) as d61_90,
            sum(d.balance_due) filter (where $2 - d.due_date > 90) as d90_plus,
            min(d.due_date) as oldest_due, count(*)::int as documents,
            (select balance from party_balances pb where pb.party_id = pa.id) as ledger_balance
       from documents d join parties pa on pa.id = d.party_id
      where d.doc_type = any($1) and d.status in ('issued','partially_paid') and d.balance_due > 0 and d.issue_date <= $2
      group by pa.id order by total desc`,
    [types, date],
  );
  const z = (v: string | null | undefined) => v ?? "0.00";
  const items = rows.map((r) => ({
    partyId: r.party_id, partyName: r.party_name, partyPhone: r.party_phone, total: z(r.total), notDue: z(r.not_due), d1_30: z(r.d1_30),
    d31_60: z(r.d31_60), d61_90: z(r.d61_90), d90Plus: z(r.d90_plus), oldestDue: r.oldest_due, documents: r.documents, ledgerBalance: z(r.ledger_balance),
  }));
  const sum = (k: keyof (typeof items)[number]) => items.reduce((a, i) => a.add(i[k] as string), new D(0)).toFixed(2);
  return { asOf: date, side, items, totals: { total: sum("total"), notDue: sum("notDue"), d1_30: sum("d1_30"), d31_60: sum("d31_60"), d61_90: sum("d61_90"), d90Plus: sum("d90Plus") } };
}
