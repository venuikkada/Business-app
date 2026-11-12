import { calculateDocument, dec } from "@cba/core";
import { TenantDb, json, withTx } from "../../db/pool.js";
import type { TenantCtx } from "../../http/context.js";
import { badRequest, conflict, notFound } from "../../lib/errors.js";
import { istDate } from "../../lib/dates.js";
import { audit } from "../audit/service.js";
import { ledgerEntry } from "../parties/service.js";
import { applyMovement, assertBranch, defaultBranchId } from "../stock/service.js";
import { nextDocNumber } from "../tenants/series.js";

export interface LineInput { variantId?: number | null; description: string; hsn?: string | null; qty: number; unit?: string; rate: number; discountPct?: number; gstRate: number }
export interface DocInput {
  docType: "quotation" | "invoice";
  branchId?: number;
  docDate?: string;
  dueDate?: string | null;
  validUntil?: string | null;
  partyId?: number | null;
  customerName?: string | null;
  customerMobile?: string | null;
  priceIncludesTax: boolean;
  discount?: number;
  notes?: string | null;
  lines: LineInput[];
  payment?: { amount: number; mode: string; reference?: string | null } | null;
  sourceDocId?: number | null;
}

/** Cash goes to "Cash in hand"; UPI/bank/card/cheque go to "Bank / UPI" (created on first use). */
async function accountFor(tdb: TenantDb, mode: string): Promise<number> {
  const cash = mode === "cash";
  const a = await tdb.one("SELECT id FROM accounts WHERE tenant_id = :tenantId AND account_type = :t AND is_active = 1 ORDER BY id LIMIT 1", { t: cash ? "cash" : "bank" });
  if (a) return Number(a.id);
  return (await tdb.exec("INSERT INTO accounts (tenant_id, account_type, name) VALUES (:tenantId, :t, :n)", { t: cash ? "cash" : "bank", n: cash ? "Cash in hand" : "Bank / UPI" })).insertId;
}

async function addPayment(tdb: TenantDb, ctx: TenantCtx, doc: any, pay: { amount: number; mode: string; reference?: string | null; date?: string }) {
  const amount = dec(pay.amount);
  if (amount.lte(0)) throw badRequest("invalid_amount", "Enter an amount greater than 0.");
  if (amount.gt(dec(doc.balance_due))) throw badRequest("overpayment", "Amount is more than the balance due.");
  const date = pay.date ?? istDate();
  const { number } = await nextDocNumber(tdb, Number(doc.branch_id), "payment_in", date, ctx.tenant.fyStartMonth);
  const accountId = await accountFor(tdb, pay.mode);
  const p = await tdb.exec(
    `INSERT INTO payments (tenant_id, branch_id, direction, number, payment_date, party_id, account_id, mode, amount, reference, created_by)
     VALUES (:tenantId, :b, 'in', :num, :d, :party, :acc, :mode, :amt, :ref, :by)`,
    { b: doc.branch_id, num: number, d: date, party: doc.party_id ?? null, acc: accountId, mode: pay.mode, amt: amount.toFixed(2), ref: pay.reference || null, by: ctx.userId },
  );
  await tdb.exec("INSERT INTO payment_allocations (tenant_id, payment_id, sales_document_id, amount) VALUES (:tenantId, :p, :d, :a)", { p: p.insertId, d: doc.id, a: amount.toFixed(2) });
  await tdb.exec("INSERT INTO account_entries (tenant_id, account_id, entry_date, amount, ref_type, ref_id, narration, created_by) VALUES (:tenantId, :acc, :d, :a, 'payment', :p, :n, :by)", {
    acc: accountId, d: date, a: amount.toFixed(2), p: p.insertId, n: `Received for ${doc.number}`, by: ctx.userId,
  });
  await tdb.exec("UPDATE accounts SET balance = balance + :a WHERE tenant_id = :tenantId AND id = :acc", { a: amount.toFixed(2), acc: accountId });
  if (doc.party_id) await ledgerEntry(tdb, { partyId: Number(doc.party_id), date, refType: "payment", refId: p.insertId, credit: amount.toFixed(2), narration: `Payment for ${doc.number}` });
  const balance = dec(doc.balance_due).minus(amount);
  await tdb.exec("UPDATE sales_documents SET amount_paid = amount_paid + :a, balance_due = :bal, status = :st WHERE tenant_id = :tenantId AND id = :id", {
    a: amount.toFixed(2), bal: balance.toFixed(2), st: balance.lte(0) ? "paid" : "partially_paid", id: doc.id,
  });
  return p.insertId;
}

export async function createDocument(ctx: TenantCtx, input: DocInput) {
  const branchId = await defaultBranchId(ctx, input.branchId);
  const docDate = input.docDate ?? istDate();
  const id = await withTx(async (conn) => {
    const tdb = new TenantDb(conn, ctx.tenantId);
    const branch = await tdb.one("SELECT b.state_code, b.gstin, t.gstin AS t_gstin FROM branches b JOIN tenants t ON t.id = b.tenant_id WHERE b.tenant_id = :tenantId AND b.id = :id", { id: branchId });
    const registered = !!(branch.gstin || branch.t_gstin); // unregistered businesses cannot charge GST
    let party: any = null;
    if (input.partyId) {
      party = await tdb.one("SELECT id, name, mobile, gstin, state_code, billing_address FROM parties WHERE tenant_id = :tenantId AND id = :id AND deleted_at IS NULL", { id: input.partyId });
      if (!party) throw badRequest("invalid_party", "Choose a valid customer.");
    }
    const pos = party?.state_code || branch.state_code;
    const lines: any[] = [];
    for (const l of input.lines) {
      let v: any = null;
      if (l.variantId) {
        v = await tdb.one(
          `SELECT v.id, v.item_id, v.purchase_price, i.track_stock, i.hsn_sac, u.code AS unit FROM item_variants v
             JOIN items i ON i.id = v.item_id AND i.tenant_id = v.tenant_id JOIN units u ON u.id = i.unit_id AND u.tenant_id = i.tenant_id
            WHERE v.tenant_id = :tenantId AND v.id = :id`, { id: l.variantId });
        if (!v) throw badRequest("invalid_item", `Item on line "${l.description}" was not found.`);
      }
      lines.push({ ...l, v, gstRate: registered ? l.gstRate : 0 });
    }
    let calc;
    try {
      calc = calculateDocument({
        lines: lines.map((l) => ({ quantity: l.qty, unitPrice: l.rate, discountType: "percent", discountValue: l.discountPct ?? 0, taxRate: l.gstRate })),
        pricesIncludeTax: input.priceIncludesTax, isInterState: pos !== branch.state_code,
        documentDiscountType: "amount", documentDiscountValue: input.discount ?? 0, roundOff: true,
      });
    } catch (e: any) {
      throw badRequest("calculation_failed", e?.message ?? "Could not calculate totals.");
    }
    const { number, fy } = await nextDocNumber(tdb, branchId, input.docType, docDate, ctx.tenant.fyStartMonth);
    const invoice = input.docType === "invoice";
    const d = await tdb.exec(
      `INSERT INTO sales_documents (tenant_id, branch_id, doc_type, number, fy, doc_date, due_date, valid_until, party_id, party_snapshot, supply_type,
              place_of_supply, price_includes_tax, status, subtotal, discount_total, taxable_total, cgst_total, sgst_total, igst_total, round_off,
              grand_total, balance_due, source_doc_id, notes, created_by)
       VALUES (:tenantId, :b, :type, :num, :fy, :date, :due, :valid, :party, :snap, :supply, :pos, :incl, :status, :sub, :disc, :taxable, :cgst, :sgst, :igst, :round,
               :total, :bal, :src, :notes, :by)`,
      {
        b: branchId, type: input.docType, num: number, fy, date: docDate, due: input.dueDate ?? null, valid: input.validUntil ?? null, party: party?.id ?? null,
        snap: JSON.stringify(party ? { name: party.name, mobile: party.mobile, gstin: party.gstin, address: party.billing_address, stateCode: party.state_code }
          : { name: input.customerName || "Cash customer", mobile: input.customerMobile || null }),
        supply: party?.gstin ? "B2B" : "B2C", pos, incl: input.priceIncludesTax ? 1 : 0, status: invoice ? "issued" : "sent",
        sub: calc.grossTotal, disc: calc.discountTotal, taxable: calc.taxableTotal, cgst: calc.cgstTotal, sgst: calc.sgstTotal, igst: calc.igstTotal,
        round: calc.roundOff, total: calc.grandTotal, bal: invoice ? calc.grandTotal : 0, src: input.sourceDocId ?? null, notes: input.notes || null, by: ctx.userId,
      },
    );
    for (const [i, l] of lines.entries()) {
      const c = calc.lines[i]!;
      // With GST-inclusive prices the customer must see exactly qty x price (not a paisa more from tax rounding).
      const lineTotal = input.priceIncludesTax && dec(c.documentDiscountShare).isZero() ? dec(c.gross).minus(c.lineDiscount).toFixed(2) : c.total;
      await tdb.exec(
        `INSERT INTO sales_document_lines (tenant_id, document_id, line_no, item_id, variant_id, description, hsn_sac, qty, unit_code, rate, discount_pct,
                discount_amount, taxable_value, gst_rate, cgst, sgst, igst, line_total, cost_price)
         VALUES (:tenantId, :doc, :n, :item, :variant, :desc, :hsn, :qty, :unit, :rate, :dp, :da, :taxable, :gst, :cgst, :sgst, :igst, :total, :cost)`,
        {
          doc: d.insertId, n: i + 1, item: l.v?.item_id ?? null, variant: l.v?.id ?? null, desc: l.description, hsn: l.hsn || l.v?.hsn_sac || null, qty: l.qty,
          unit: l.unit || l.v?.unit || "NOS", rate: l.rate, dp: l.discountPct ?? 0, da: dec(c.lineDiscount).plus(c.documentDiscountShare).toFixed(2),
          taxable: c.taxableValue, gst: l.gstRate, cgst: c.cgst, sgst: c.sgst, igst: c.igst, total: lineTotal, cost: l.v?.purchase_price ?? null,
        },
      );
      if (invoice && l.v?.track_stock) {
        await applyMovement(tdb, { branchId, variantId: l.v.id, qty: dec(l.qty).neg().toFixed(3), type: "sale", refType: "invoice", refId: d.insertId, date: docDate, userId: ctx.userId });
      }
    }
    if (invoice && party) await ledgerEntry(tdb, { partyId: party.id, date: docDate, refType: "invoice", refId: d.insertId, debit: calc.grandTotal, narration: `Invoice ${number}` });
    if (input.sourceDocId) {
      await tdb.exec("UPDATE sales_documents SET status = 'converted' WHERE tenant_id = :tenantId AND id = :id AND doc_type = 'quotation'", { id: input.sourceDocId });
    }
    if (invoice && input.payment && input.payment.amount > 0) {
      const doc = { id: d.insertId, branch_id: branchId, party_id: party?.id ?? null, number, balance_due: calc.grandTotal };
      await addPayment(tdb, ctx, doc, { ...input.payment, date: docDate });
    }
    await audit(tdb, ctx, {
      action: "create", entityType: input.docType, entityId: d.insertId, branchId,
      summary: `Created ${input.docType} ${number} for ₹${calc.grandTotal}`, after: { number, total: calc.grandTotal, customer: party?.name ?? input.customerName ?? "Cash customer" },
    });
    return d.insertId;
  });
  return getDocument(ctx, id);
}

function head(r: any) {
  const snap = json<any>(r.party_snapshot, {});
  return {
    id: Number(r.id), docType: r.doc_type, number: r.number, docDate: r.doc_date, dueDate: r.due_date, validUntil: r.valid_until, status: r.status,
    partyId: r.party_id ? Number(r.party_id) : null, customer: snap, supplyType: r.supply_type, placeOfSupply: r.place_of_supply,
    priceIncludesTax: !!r.price_includes_tax, subtotal: r.subtotal, discountTotal: r.discount_total, taxableTotal: r.taxable_total,
    cgst: r.cgst_total, sgst: r.sgst_total, igst: r.igst_total, roundOff: r.round_off, grandTotal: r.grand_total, amountPaid: r.amount_paid,
    balanceDue: r.balance_due, branchId: Number(r.branch_id), notes: r.notes, sourceDocId: r.source_doc_id ? Number(r.source_doc_id) : null, createdAt: r.created_at,
  };
}

export async function listDocuments(ctx: TenantCtx, q: { docType: string; search?: string; status?: string; from?: string; to?: string; limit: number }) {
  const p: Record<string, unknown> = { type: q.docType, limit: q.limit };
  let sql = "SELECT * FROM sales_documents WHERE tenant_id = :tenantId AND doc_type = :type";
  if (ctx.branchIds) (sql += " AND branch_id IN (:bids)"), (p.bids = ctx.branchIds.length ? ctx.branchIds : [0]);
  if (q.status === "unpaid") sql += " AND status IN ('issued','partially_paid')";
  else if (q.status) (sql += " AND status = :status"), (p.status = q.status);
  if (q.from) (sql += " AND doc_date >= :from"), (p.from = q.from);
  if (q.to) (sql += " AND doc_date <= :to"), (p.to = q.to);
  if (q.search) (sql += " AND (number LIKE :like OR party_snapshot LIKE :like)"), (p.like = `%${q.search.replace(/[%_\\]/g, "\\$&")}%`);
  return (await ctx.tdb.all(sql + " ORDER BY id DESC LIMIT :limit", p)).map(head);
}

export async function getDocument(ctx: TenantCtx, id: number) {
  const r = await ctx.tdb.one("SELECT * FROM sales_documents WHERE tenant_id = :tenantId AND id = :id", { id });
  if (!r) throw notFound("Document");
  assertBranch(ctx, Number(r.branch_id));
  const lines = await ctx.tdb.all("SELECT * FROM sales_document_lines WHERE tenant_id = :tenantId AND document_id = :id ORDER BY line_no", { id });
  const pays = await ctx.tdb.all(
    `SELECT p.id, p.number, p.payment_date, p.mode, p.amount, p.reference, p.status FROM payment_allocations a
       JOIN payments p ON p.id = a.payment_id AND p.tenant_id = a.tenant_id WHERE a.tenant_id = :tenantId AND a.sales_document_id = :id ORDER BY p.id`, { id });
  return {
    ...head(r),
    lines: lines.map((l) => ({
      variantId: l.variant_id ? Number(l.variant_id) : null, description: l.description, hsn: l.hsn_sac, qty: l.qty, unit: l.unit_code, rate: l.rate,
      discountPct: l.discount_pct, taxableValue: l.taxable_value, gstRate: l.gst_rate, cgst: l.cgst, sgst: l.sgst, igst: l.igst, total: l.line_total,
    })),
    payments: pays.map((p) => ({ id: Number(p.id), number: p.number, date: p.payment_date, mode: p.mode, amount: p.amount, reference: p.reference, status: p.status })),
  };
}

export async function recordPayment(ctx: TenantCtx, id: number, pay: { amount: number; mode: string; reference?: string | null; date?: string }) {
  await withTx(async (conn) => {
    const tdb = new TenantDb(conn, ctx.tenantId);
    const doc = await tdb.one("SELECT * FROM sales_documents WHERE tenant_id = :tenantId AND id = :id AND doc_type = 'invoice' FOR UPDATE", { id });
    if (!doc) throw notFound("Invoice");
    assertBranch(ctx, Number(doc.branch_id));
    if (doc.status === "cancelled") throw conflict("cancelled", "This invoice is cancelled.");
    const pid = await addPayment(tdb, ctx, doc, pay);
    await audit(tdb, ctx, { action: "create", entityType: "payment", entityId: pid, summary: `Received ₹${dec(pay.amount).toFixed(2)} (${pay.mode}) for ${doc.number}` });
  });
  return getDocument(ctx, id);
}

/** Quotation → invoice: copies the lines at today's date and marks the quotation as converted. */
export async function convertToInvoice(ctx: TenantCtx, id: number) {
  const q = await getDocument(ctx, id);
  if (q.docType !== "quotation") throw badRequest("not_quotation", "Only a quotation can be converted.");
  if (q.status === "converted") throw conflict("already_converted", "This quotation was already converted to an invoice.");
  return createDocument(ctx, {
    docType: "invoice", branchId: q.branchId, partyId: q.partyId, customerName: q.customer?.name, customerMobile: q.customer?.mobile,
    priceIncludesTax: q.priceIncludesTax, notes: q.notes, sourceDocId: q.id,
    lines: q.lines.map((l) => ({ variantId: l.variantId, description: l.description, hsn: l.hsn, qty: Number(l.qty), unit: l.unit, rate: Number(l.rate), discountPct: Number(l.discountPct), gstRate: Number(l.gstRate) })),
  });
}

/** Cancel: the number stays (GST needs the trail); stock, customer ledger and payments are reversed. */
export async function cancelDocument(ctx: TenantCtx, id: number, reason: string) {
  await withTx(async (conn) => {
    const tdb = new TenantDb(conn, ctx.tenantId);
    const doc = await tdb.one("SELECT * FROM sales_documents WHERE tenant_id = :tenantId AND id = :id FOR UPDATE", { id });
    if (!doc) throw notFound("Document");
    assertBranch(ctx, Number(doc.branch_id));
    if (doc.status === "cancelled") throw conflict("cancelled", "Already cancelled.");
    if (doc.doc_type === "invoice") {
      const lines = await tdb.all("SELECT l.variant_id, l.qty, l.cost_price, i.track_stock FROM sales_document_lines l LEFT JOIN items i ON i.id = l.item_id AND i.tenant_id = l.tenant_id WHERE l.tenant_id = :tenantId AND l.document_id = :id", { id });
      for (const l of lines) {
        if (l.variant_id && l.track_stock) await applyMovement(tdb, { branchId: Number(doc.branch_id), variantId: Number(l.variant_id), qty: l.qty, type: "sale_return", refType: "invoice_cancel", refId: id, reason: "Invoice cancelled", userId: ctx.userId });
      }
      if (doc.party_id) await ledgerEntry(tdb, { partyId: Number(doc.party_id), refType: "invoice_cancel", refId: id, credit: doc.grand_total, narration: `Cancelled ${doc.number}` });
      const pays = await tdb.all(
        `SELECT p.id, p.amount, p.account_id FROM payment_allocations a JOIN payments p ON p.id = a.payment_id AND p.tenant_id = a.tenant_id
          WHERE a.tenant_id = :tenantId AND a.sales_document_id = :id AND p.status = 'posted'`, { id });
      for (const p of pays) {
        await tdb.exec("UPDATE payments SET status = 'void' WHERE tenant_id = :tenantId AND id = :p", { p: p.id });
        await tdb.exec("INSERT INTO account_entries (tenant_id, account_id, entry_date, amount, ref_type, ref_id, narration, created_by) VALUES (:tenantId, :acc, :d, :a, 'payment_void', :p, :n, :by)", {
          acc: p.account_id, d: istDate(), a: dec(p.amount).neg().toFixed(2), p: p.id, n: `Refund / void for cancelled ${doc.number}`, by: ctx.userId,
        });
        await tdb.exec("UPDATE accounts SET balance = balance - :a WHERE tenant_id = :tenantId AND id = :acc", { a: p.amount, acc: p.account_id });
        if (doc.party_id) await ledgerEntry(tdb, { partyId: Number(doc.party_id), refType: "payment_void", refId: Number(p.id), debit: p.amount, narration: `Payment voided (${doc.number})` });
      }
    }
    await tdb.exec("UPDATE sales_documents SET status = 'cancelled', balance_due = 0, cancelled_at = CURRENT_TIMESTAMP(3), cancelled_by = :by, cancel_reason = :r WHERE tenant_id = :tenantId AND id = :id", { id, by: ctx.userId, r: reason });
    await audit(tdb, ctx, { action: "cancel", entityType: doc.doc_type, entityId: id, summary: `Cancelled ${doc.doc_type} ${doc.number}: ${reason}`, before: { status: doc.status }, after: { status: "cancelled" } });
  });
  return getDocument(ctx, id);
}
