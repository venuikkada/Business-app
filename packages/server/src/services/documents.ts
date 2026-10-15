import {
  calculateDocument, CalculationError, documentSchema, cancelDocumentSchema, effectiveDiscountPercent, financialYear, financialYearShort,
  formatDocumentNumber, addDays, DOC_TYPE_META, CONVERSIONS, D, type DocType, type DocumentInput, type Permission,
} from "@cba/core";
import type { z } from "zod";
import { assertLimit, monthStartIST, resolveBranch, type Tenant } from "../context";
import { AppError, notFound, forbidden } from "../errors";
import { camelize, likePattern, orderBy, parseList } from "../util";
import { randomToken } from "../auth/crypto";
import { moveStock, receiveSerials, issueSerials, currentAvgCost } from "./stock";
import { canApprove, consumeApproval, requireApproval } from "./approvals";

const PERM_GROUP: Record<DocType, "quotations" | "sales_orders" | "invoices" | "purchases"> = {
  quotation: "quotations",
  sales_order: "sales_orders",
  delivery_challan: "sales_orders",
  invoice: "invoices",
  credit_note: "invoices",
  purchase_order: "purchases",
  purchase_bill: "purchases",
  debit_note: "purchases",
};
export function docPerm(type: DocType, action: "view" | "create" | "edit" | "delete"): Permission {
  return `${PERM_GROUP[type]}.${action}` as Permission;
}
function requireDocFeature(t: Tenant, type: DocType) {
  if (DOC_TYPE_META[type].side === "purchase") t.requireFeature("purchases");
}

interface DocRow {
  id: string;
  doc_type: DocType;
  status: string;
  number: string | null;
  party_id: string;
  branch_id: string;
  issue_date: string;
  grand_total: string;
  amount_settled: string;
  balance_due: string;
  source_document_id: string | null;
  discount_total?: string;
  gross_total: string;
  line_discount_total: string;
  document_discount: string;
  [k: string]: unknown;
}

/**
 * Allocates the next number for a document type in the document's FY.
 * The UPDATE takes a row lock, so concurrent finalisations queue up and
 * numbers stay unique and gap-free (a rolled back transaction releases it).
 */
export async function nextNumber(t: Tenant, docType: string, issueDate: string, defaultPrefix: string) {
  const fy = financialYear(issueDate, t.business.fy_start_month);
  const prefix = t.settings.numberPrefixes?.[docType] ?? defaultPrefix;
  await t.db.exec(
    "insert into document_sequences(business_id, doc_type, fy, prefix) values ($1,$2,$3,$4) on conflict do nothing",
    [t.businessId, docType, fy, prefix],
  );
  const r = await t.db.one<{ seq: number; prefix: string }>(
    "update document_sequences set next_value = next_value + 1, prefix = $4 where business_id = $1 and doc_type = $2 and fy = $3 returning next_value - 1 as seq, prefix",
    [t.businessId, docType, fy, prefix],
  );
  return { fy, seq: r.seq, number: formatDocumentNumber(r.prefix, financialYearShort(issueDate, t.business.fy_start_month), r.seq) };
}

interface Built {
  d: DocumentInput;
  party: Record<string, unknown>;
  branchId: string;
  placeOfSupply: string;
  isInterState: boolean;
  calc: ReturnType<typeof calculateDocument>;
  noTax: boolean;
}

async function build(t: Tenant, input: z.input<typeof documentSchema>): Promise<Built> {
  const d = documentSchema.parse(input);
  const meta = DOC_TYPE_META[d.docType];
  const party = await t.db.maybe<Record<string, unknown>>("select * from parties where id = $1", [d.partyId]);
  if (!party) throw new AppError("VALIDATION", "Customer/supplier not found", { field: "partyId" });
  if (party.archived_at) throw new AppError("VALIDATION", "This customer/supplier is archived", { field: "partyId" });
  if (meta.side === "sales" && !party.is_customer) throw new AppError("VALIDATION", "Select a customer for sales documents", { field: "partyId" });
  if (meta.side === "purchase" && !party.is_supplier) throw new AppError("VALIDATION", "Select a supplier for purchase documents", { field: "partyId" });

  const branchId = await resolveBranch(t, d.branchId);
  const branch = await t.db.one<{ state_code: string }>("select state_code from branches where id = $1", [branchId]);

  const productIds = [...new Set(d.items.map((i) => i.productId).filter(Boolean))] as string[];
  if (productIds.length) {
    const found = await t.db.query<{ id: string; archived_at: string | null; name: string }>("select id, archived_at, name from products where id = any($1)", [productIds]);
    if (found.length !== productIds.length) throw new AppError("VALIDATION", "One or more products were not found");
    const archived = found.find((p) => p.archived_at);
    if (archived) throw new AppError("VALIDATION", `${archived.name} is archived`);
  }

  let placeOfSupply: string;
  let isInterState: boolean;
  const partyState = (party.shipping_state_code ?? party.billing_state_code ?? (party.gstin ? String(party.gstin).slice(0, 2) : null)) as string | null;
  if (meta.side === "sales") {
    placeOfSupply = d.placeOfSupply ?? partyState ?? branch.state_code;
    isInterState = placeOfSupply !== branch.state_code;
  } else {
    placeOfSupply = branch.state_code;
    const supplierState = (party.billing_state_code ?? (party.gstin ? String(party.gstin).slice(0, 2) : null)) as string | null;
    isInterState = !!supplierState && supplierState !== branch.state_code;
  }

  // Businesses that may not collect GST issue a Bill of Supply with no tax.
  const noTax = meta.side === "sales" && t.settings.gstScheme !== "regular";
  if (noTax) {
    d.items = d.items.map((i) => ({ ...i, taxRate: 0 }));
    d.additionalChargesTaxRate = 0;
  }

  if (d.docType === "quotation" && !d.validUntil) d.validUntil = addDays(d.issueDate, t.settings.quotationValidityDays);
  if ((d.docType === "invoice" || d.docType === "purchase_bill") && !d.dueDate) {
    d.dueDate = addDays(d.issueDate, (party.payment_terms_days as number | null) ?? t.settings.defaultPaymentTermsDays);
  }
  if (d.dueDate && d.dueDate < d.issueDate) throw new AppError("VALIDATION", "Due date cannot be before the document date", { field: "dueDate" });

  let calc;
  try {
    calc = calculateDocument({
      lines: d.items.map((i) => ({ quantity: i.quantity, unitPrice: i.unitPrice, discountType: i.discountType, discountValue: i.discountValue, taxRate: i.taxRate })),
      pricesIncludeTax: d.pricesIncludeTax,
      isInterState,
      documentDiscountType: d.documentDiscountType,
      documentDiscountValue: d.documentDiscountValue,
      additionalCharges: d.additionalCharges,
      additionalChargesTaxRate: d.additionalChargesTaxRate,
      roundOff: d.roundOff,
    });
  } catch (e) {
    if (e instanceof CalculationError) throw new AppError("VALIDATION", e.message, { field: e.field });
    throw e;
  }
  return { d, party, branchId, placeOfSupply, isInterState, calc, noTax };
}

async function writeDocument(t: Tenant, b: Built, existingId?: string) {
  const { d, party, calc } = b;
  const addr = (p: string) =>
    party[`${p}_line1`] || party[`${p}_city`]
      ? JSON.stringify({ line1: party[`${p}_line1`], line2: party[`${p}_line2`], city: party[`${p}_city`], stateCode: party[`${p}_state_code`], pincode: party[`${p}_pincode`] })
      : null;
  const cols = [
    b.branchId, d.docType, d.partyId, party.name, party.gstin, party.phone, party.email, addr("billing"), addr("shipping"),
    party.billing_state_code ?? null, d.issueDate, d.dueDate ?? null, d.validUntil ?? null, b.placeOfSupply, b.isInterState, d.pricesIncludeTax,
    d.reverseCharge, d.documentDiscountType ?? null, d.documentDiscountValue ?? 0, d.additionalCharges ?? 0, d.additionalChargesLabel,
    d.additionalChargesTaxRate ?? 0, d.roundOff, calc.grossTotal, calc.lineDiscountTotal, calc.documentDiscount, calc.taxableTotal, calc.cgstTotal,
    calc.sgstTotal, calc.igstTotal, calc.taxTotal, calc.roundOff, calc.grandTotal, d.supplierInvoiceNumber, d.referenceNumber, d.notes,
    d.terms ?? (d.docType === "quotation" ? t.settings.quotationTerms : d.docType === "invoice" ? t.settings.invoiceTerms : null),
    d.sourceDocumentId ?? null,
  ];
  let id: string;
  if (existingId) {
    await t.db.exec(
      `update documents set branch_id=$2, doc_type=$3, party_id=$4, party_name=$5, party_gstin=$6, party_phone=$7, party_email=$8,
         party_billing_address=$9, party_shipping_address=$10, party_state_code=$11, issue_date=$12, due_date=$13, valid_until=$14,
         place_of_supply=$15, is_inter_state=$16, prices_include_tax=$17, reverse_charge=$18, document_discount_type=$19,
         document_discount_value=$20, additional_charges=$21, additional_charges_label=$22, additional_charges_tax_rate=$23,
         round_off_enabled=$24, gross_total=$25, line_discount_total=$26, document_discount=$27, taxable_total=$28, cgst_total=$29,
         sgst_total=$30, igst_total=$31, tax_total=$32, round_off=$33, grand_total=$34, supplier_invoice_number=$35,
         reference_number=$36, notes=$37, terms=$38, source_document_id=$39, version = version + 1
       where id = $1`,
      [existingId, ...cols],
    );
    await t.db.exec("delete from document_items where document_id = $1", [existingId]);
    id = existingId;
  } else {
    const r = await t.db.one<{ id: string }>(
      `insert into documents(branch_id, doc_type, party_id, party_name, party_gstin, party_phone, party_email, party_billing_address,
         party_shipping_address, party_state_code, issue_date, due_date, valid_until, place_of_supply, is_inter_state, prices_include_tax,
         reverse_charge, document_discount_type, document_discount_value, additional_charges, additional_charges_label,
         additional_charges_tax_rate, round_off_enabled, gross_total, line_discount_total, document_discount, taxable_total, cgst_total,
         sgst_total, igst_total, tax_total, round_off, grand_total, supplier_invoice_number, reference_number, notes, terms,
         source_document_id, business_id, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,
               $33,$34,$35,$36,$37,$38,$39,$40) returning id`,
      [...cols, t.businessId, t.userId],
    );
    id = r.id;
  }
  for (let i = 0; i < d.items.length; i++) {
    const it = d.items[i]!;
    const c = calc.lines[i]!;
    await t.db.exec(
      `insert into document_items(business_id, document_id, position, product_id, description, hsn_code, quantity, unit, unit_price,
         discount_type, discount_value, tax_rate, gross, line_discount, document_discount_share, taxable_value, cgst, sgst, igst,
         tax_amount, total, serial_numbers, source_item_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
      [
        t.businessId, id, i + 1, it.productId ?? null, it.description, it.hsnCode, it.quantity, it.unit, it.unitPrice, it.discountType ?? null,
        it.discountValue ?? 0, it.taxRate, c.gross, c.lineDiscount, c.documentDiscountShare, c.taxableValue, c.cgst, c.sgst, c.igst, c.taxAmount,
        c.total, (it.serialNumbers ?? []).map((s) => s.trim().toUpperCase()), it.sourceItemId ?? null,
      ],
    );
  }
  return id;
}

async function validateSource(t: Tenant, d: DocumentInput) {
  if (!d.sourceDocumentId) return;
  const src = await t.db.maybe<{ doc_type: DocType; status: string; party_id: string }>("select doc_type, status, party_id from documents where id = $1", [d.sourceDocumentId]);
  if (!src) throw new AppError("VALIDATION", "Source document not found");
  if (!(CONVERSIONS[src.doc_type] ?? []).includes(d.docType)) throw new AppError("VALIDATION", `A ${DOC_TYPE_META[src.doc_type].label} cannot be converted to a ${DOC_TYPE_META[d.docType].label}`);
  if (src.status === "draft" || src.status === "cancelled") throw new AppError("BUSINESS_RULE", "The source document must be issued (not draft or cancelled)");
  if (src.party_id !== d.partyId) throw new AppError("VALIDATION", "The party must match the source document");
}

export async function previewDocument(t: Tenant, input: z.input<typeof documentSchema>) {
  const b = await build(t, input);
  return { ...b.calc, placeOfSupply: b.placeOfSupply, isInterState: b.isInterState, noTax: b.noTax };
}

export async function createDocument(t: Tenant, input: z.input<typeof documentSchema>) {
  const type = documentSchema.shape.docType.parse((input as { docType: unknown }).docType);
  t.require(docPerm(type, "create"));
  requireDocFeature(t, type);
  const b = await build(t, input);
  await validateSource(t, b.d);
  if (type === "quotation") {
    await assertLimit(t, "quotations_per_month", "select count(*)::int n from documents where doc_type = 'quotation' and created_at >= ($1::date::timestamp at time zone 'Asia/Kolkata')", [monthStartIST(t.today)]);
  }
  const id = await writeDocument(t, b);
  await t.audit("document.create", "document", id, `Draft ${DOC_TYPE_META[type].label} for ${b.party.name} (${b.calc.grandTotal})`);
  return getDocument(t, id);
}

export async function updateDocument(t: Tenant, id: string, input: z.input<typeof documentSchema>) {
  const cur = await t.db.maybe<DocRow>("select * from documents where id = $1 for update", [id]);
  if (!cur) throw notFound("Document");
  t.require(docPerm(cur.doc_type, "edit"));
  if (cur.status !== "draft") throw new AppError("BUSINESS_RULE", "Only drafts can be edited. Cancel the document or issue a credit/debit note instead.");
  const b = await build(t, { ...(input as object), docType: cur.doc_type } as z.input<typeof documentSchema>);
  await validateSource(t, b.d);
  await writeDocument(t, b, id);
  await t.audit("document.update", "document", id, `Draft updated (${b.calc.grandTotal})`);
  return getDocument(t, id);
}

export async function deleteDraft(t: Tenant, id: string) {
  const cur = await t.db.maybe<DocRow>("select * from documents where id = $1 for update", [id]);
  if (!cur) throw notFound("Document");
  t.require(docPerm(cur.doc_type, "delete"));
  if (cur.status !== "draft") throw new AppError("BUSINESS_RULE", "Issued documents cannot be deleted; cancel them instead");
  await t.db.exec("delete from documents where id = $1", [id]);
  await t.audit("document.delete_draft", "document", id, `Deleted draft ${DOC_TYPE_META[cur.doc_type].label}`);
}

interface ItemRow {
  id: string;
  product_id: string | null;
  description: string;
  quantity: string;
  taxable_value: string;
  serial_numbers: string[];
  source_item_id: string | null;
  track_inventory: boolean | null;
  track_serials: boolean | null;
  warranty_months: number | null;
  cost_price: string | null;
  product_name: string | null;
}

const FINAL_STATUS: Record<DocType, string> = {
  quotation: "sent",
  sales_order: "issued",
  delivery_challan: "issued",
  invoice: "issued",
  credit_note: "issued",
  purchase_order: "issued",
  purchase_bill: "issued",
  debit_note: "issued",
};

export interface FinalizeOptions {
  approvalId?: string | null;
  allowNegativeStock?: boolean;
}

/**
 * Issues a draft: assigns the number, applies stock effects exactly once,
 * snapshots cost for gross-profit reporting, updates fulfilment on the
 * source document and applies credit/debit notes to their invoice/bill.
 * Everything happens in the caller's single transaction.
 */
export async function finalizeDocument(t: Tenant, id: string, opts: FinalizeOptions = {}) {
  const doc = await t.db.maybe<DocRow>("select * from documents where id = $1 for update", [id]);
  if (!doc) throw notFound("Document");
  const type = doc.doc_type;
  t.require(docPerm(type, "create"));
  requireDocFeature(t, type);
  if (doc.status !== "draft") throw new AppError("CONFLICT", `This ${DOC_TYPE_META[type].label.toLowerCase()} is already ${doc.status}`);
  const meta = DOC_TYPE_META[type];

  // High-discount approval for sales.
  if ((type === "invoice" || type === "sales_order") && t.settings.discountApprovalPercent !== null && !canApprove(t, "discount")) {
    const pct = Number(
      effectiveDiscountPercent({ grossTotal: doc.gross_total, discountTotal: new D(doc.line_discount_total).add(doc.document_discount).toFixed(2) } as never),
    );
    if (pct > t.settings.discountApprovalPercent) {
      const payload = { documentId: id, grandTotal: doc.grand_total, discountPercent: pct.toFixed(2), version: doc.version };
      if (!opts.approvalId) await requireApproval(t, "discount", "document", id, payload, `Discount of ${pct.toFixed(2)}% on ${doc.party_name}'s ${meta.label.toLowerCase()} exceeds ${t.settings.discountApprovalPercent}%`);
      await consumeApproval(t, opts.approvalId!, "discount", id, payload);
      await t.db.exec("update documents set approval_id = $2 where id = $1", [id, opts.approvalId]);
    }
  }

  if (type === "invoice") {
    await assertLimit(
      t, "invoices_per_month",
      "select count(*)::int n from documents where doc_type = 'invoice' and finalized_at >= ($1::date::timestamp at time zone 'Asia/Kolkata')",
      [monthStartIST(t.today)],
    );
  }
  if (opts.allowNegativeStock && !canApprove(t, "negative_stock")) throw forbidden("Only an owner or manager can allow negative stock");

  const items = await t.db.query<ItemRow>(
    `select i.id, i.product_id, i.description, i.quantity, i.taxable_value, i.serial_numbers, i.source_item_id,
            p.track_inventory, p.track_serials, p.warranty_months, p.cost_price, p.name as product_name
       from document_items i left join products p on p.id = i.product_id where i.document_id = $1 order by i.position`,
    [id],
  );

  // Returns cannot exceed what was originally sold/bought.
  if (type === "credit_note" || type === "debit_note") {
    if (!doc.source_document_id) throw new AppError("VALIDATION", `A ${meta.label.toLowerCase()} must reference the original ${type === "credit_note" ? "invoice" : "purchase bill"}`);
    for (const it of items) {
      if (!it.source_item_id) continue;
      const r = await t.db.one<{ original: string; returned: string }>(
        `select s.quantity as original,
                coalesce((select sum(x.quantity) from document_items x join documents dx on dx.id = x.document_id
                           where x.source_item_id = s.id and dx.doc_type = $2 and dx.status not in ('draft','cancelled')), 0) as returned
           from document_items s where s.id = $1`,
        [it.source_item_id, type],
      );
      if (new D(r.returned).add(it.quantity).gt(r.original)) {
        throw new AppError("BUSINESS_RULE", `${it.description}: return quantity exceeds the ${new D(r.original).sub(r.returned).toString()} remaining on the original document`);
      }
    }
  }

  const { number, fy, seq } = await nextNumber(t, type, doc.issue_date, meta.prefix);

  // Stock + cost snapshot.
  let costTotal = new D(0);
  for (const it of items) {
    let unitCost: string | null = null;
    if (it.product_id && it.track_inventory) {
      const qty = new D(it.quantity);
      const common = { productId: it.product_id, branchId: doc.branch_id, sourceType: "document", sourceId: id, sourceLineId: it.id, allowNegative: !!opts.allowNegativeStock };
      if (type === "invoice") {
        unitCost = await currentAvgCost(t, it.product_id, doc.branch_id);
        if (it.track_serials) {
          await issueSerials(t, { productId: it.product_id, productName: it.product_name!, branchId: doc.branch_id, serials: it.serial_numbers, quantity: it.quantity, status: "sold", saleDocumentId: id, partyId: doc.party_id, soldOn: doc.issue_date, warrantyMonths: it.warranty_months });
        }
        await moveStock(t, { ...common, quantity: qty.neg().toString(), kind: "sale", unitCost });
      } else if (type === "credit_note") {
        const orig = it.source_item_id ? await t.db.maybe<{ unit_cost: string | null }>("select unit_cost from document_items where id = $1", [it.source_item_id]) : null;
        unitCost = orig?.unit_cost ?? (await currentAvgCost(t, it.product_id, doc.branch_id));
        if (it.track_serials) await receiveSerials(t, { productId: it.product_id, productName: it.product_name!, branchId: doc.branch_id, serials: it.serial_numbers, quantity: it.quantity, isReturn: true });
        await moveStock(t, { ...common, quantity: qty.toString(), kind: "sale_return", unitCost });
      } else if (type === "purchase_bill") {
        unitCost = new D(it.taxable_value).div(qty).toDecimalPlaces(4).toString();
        if (it.track_serials) await receiveSerials(t, { productId: it.product_id, productName: it.product_name!, branchId: doc.branch_id, serials: it.serial_numbers, quantity: it.quantity, purchaseDocumentId: id });
        await moveStock(t, { ...common, quantity: qty.toString(), kind: "purchase", unitCost });
      } else if (type === "debit_note") {
        unitCost = await currentAvgCost(t, it.product_id, doc.branch_id);
        if (it.track_serials) await issueSerials(t, { productId: it.product_id, productName: it.product_name!, branchId: doc.branch_id, serials: it.serial_numbers, quantity: it.quantity, status: "returned_to_supplier" });
        await moveStock(t, { ...common, quantity: qty.neg().toString(), kind: "purchase_return", unitCost });
      }
    } else if (it.product_id && (type === "invoice" || type === "credit_note")) {
      // Non-stock items (services): use the product's cost price as the estimate.
      unitCost = it.cost_price ?? "0";
    }
    if (unitCost !== null) {
      await t.db.exec("update document_items set unit_cost = $2 where id = $1", [it.id, unitCost]);
      if (type === "invoice") costTotal = costTotal.add(new D(unitCost).mul(it.quantity));
      if (type === "credit_note") costTotal = costTotal.add(new D(unitCost).mul(it.quantity));
    }
  }

  await t.db.exec(
    `update documents set status = $2, number = $3, fy = $4, sequence_no = $5, finalized_at = now(), finalized_by = $6,
       cost_total = $7, share_token = coalesce(share_token, $8), sent_at = case when $2 = 'sent' then now() else sent_at end
     where id = $1`,
    [id, FINAL_STATUS[type], number, fy, seq, t.userId, type === "invoice" || type === "credit_note" ? costTotal.toFixed(2) : null, randomToken(24)],
  );

  // Fulfilment of the source document (order → invoice, PO → bill, quote → anything).
  if (doc.source_document_id && type !== "credit_note" && type !== "debit_note") {
    for (const it of items) {
      if (it.source_item_id) await t.db.exec("update document_items set fulfilled_quantity = fulfilled_quantity + $2 where id = $1", [it.source_item_id, it.quantity]);
    }
    await refreshSourceStatus(t, doc.source_document_id);
  }

  // Credit/debit notes settle the original invoice/bill first.
  if ((type === "credit_note" || type === "debit_note") && doc.source_document_id) {
    const src = await t.db.one<{ balance_due: string }>("select balance_due from documents where id = $1 for update", [doc.source_document_id]);
    const apply = D.min(new D(src.balance_due), new D(doc.grand_total));
    if (apply.gt(0)) {
      await t.db.exec(
        "insert into allocations(business_id, document_id, credit_document_id, amount, created_by) values ($1,$2,$3,$4,$5)",
        [t.businessId, doc.source_document_id, id, apply.toFixed(2), t.userId],
      );
    }
  }

  await t.audit("document.finalize", "document", id, `${meta.label} ${number} issued for ${doc.party_name} — ₹${doc.grand_total}`);
  return getDocument(t, id);
}

async function refreshSourceStatus(t: Tenant, sourceId: string) {
  const src = await t.db.one<{ doc_type: DocType; status: string }>("select doc_type, status from documents where id = $1", [sourceId]);
  if (src.status === "cancelled") return;
  const agg = await t.db.one<{ total: string; done: string; any_done: boolean }>(
    `select coalesce(sum(quantity), 0) total, coalesce(sum(least(fulfilled_quantity, quantity)), 0) done, bool_or(fulfilled_quantity > 0) any_done
       from document_items where document_id = $1`,
    [sourceId],
  );
  let status = src.status;
  const complete = new D(agg.done).gte(agg.total);
  if (src.doc_type === "quotation") status = agg.any_done ? "converted" : src.status === "converted" ? "accepted" : src.status;
  else if (src.doc_type === "sales_order" || src.doc_type === "delivery_challan") status = complete ? (src.doc_type === "sales_order" ? "fulfilled" : "converted") : "issued";
  else if (src.doc_type === "purchase_order") status = complete ? "received" : agg.any_done ? "partially_received" : "issued";
  if (status !== src.status) await t.db.exec("update documents set status = $2 where id = $1", [sourceId, status]);
}

/** Quotation lifecycle: sent → accepted / rejected. */
export async function setQuotationStatus(t: Tenant, id: string, status: "accepted" | "rejected" | "sent") {
  const doc = await t.db.maybe<DocRow>("select * from documents where id = $1 for update", [id]);
  if (!doc || doc.doc_type !== "quotation") throw notFound("Quotation");
  t.require("quotations.edit");
  const allowed: Record<string, string[]> = { sent: ["accepted", "rejected", "sent"], expired: ["accepted", "rejected"], accepted: ["rejected"], rejected: ["accepted"] };
  if (!(allowed[doc.status] ?? []).includes(status)) throw new AppError("BUSINESS_RULE", `A ${doc.status} quotation cannot be marked ${status}`);
  await t.db.exec(
    "update documents set status = $2, accepted_at = case when $2 = 'accepted' then now() else accepted_at end, sent_at = case when $2 = 'sent' then now() else sent_at end where id = $1",
    [id, status],
  );
  await t.audit(`quotation.${status}`, "document", id, `Quotation ${doc.number} marked ${status}`);
}

export async function markSent(t: Tenant, id: string) {
  const doc = await t.db.maybe<DocRow>("select doc_type, status, number from documents where id = $1", [id]);
  if (!doc) throw notFound("Document");
  t.require(docPerm(doc.doc_type, "view"));
  if (doc.status === "draft") throw new AppError("BUSINESS_RULE", "Issue the document before sharing it");
  await t.db.exec("update documents set sent_at = now() where id = $1", [id]);
  await t.audit("document.shared", "document", id, `${doc.number} shared`);
}

/**
 * Creates a draft of `target` from an issued source document, copying the
 * party, terms and the remaining (not yet fulfilled) quantities.
 */
export async function convertDocument(t: Tenant, sourceId: string, target: DocType, opts: { issueDate?: string; finalize?: boolean } = {}) {
  const src = await t.db.maybe<DocRow>("select * from documents where id = $1", [sourceId]);
  if (!src) throw notFound("Document");
  t.require(docPerm(src.doc_type, "view"));
  if (!(CONVERSIONS[src.doc_type] ?? []).includes(target)) throw new AppError("VALIDATION", `Cannot convert a ${DOC_TYPE_META[src.doc_type].label} to a ${DOC_TYPE_META[target].label}`);
  if (src.status === "draft" || src.status === "cancelled") throw new AppError("BUSINESS_RULE", "Issue the document before converting it");
  if (src.doc_type === "quotation" && src.status === "rejected") throw new AppError("BUSINESS_RULE", "This quotation was rejected");
  const isReturn = target === "credit_note" || target === "debit_note";
  const items = await t.db.query<Record<string, string | string[] | null>>(
    `select i.*, coalesce((select sum(x.quantity) from document_items x join documents dx on dx.id = x.document_id
                            where x.source_item_id = i.id and dx.doc_type = $2 and dx.status not in ('draft','cancelled')), 0) as returned
       from document_items i where i.document_id = $1 order by position`,
    [sourceId, target],
  );
  const lines = items
    .map((i) => {
      const remaining = isReturn ? new D(i.quantity as string).sub(i.returned as string) : new D(i.quantity as string).sub(i.fulfilled_quantity as string);
      return { i, remaining };
    })
    .filter((x) => x.remaining.gt(0))
    .map(({ i, remaining }) => ({
      productId: i.product_id as string | null,
      description: i.description as string,
      hsnCode: i.hsn_code as string | null,
      quantity: remaining.toString(),
      unit: i.unit as string,
      unitPrice: i.unit_price as string,
      discountType: i.discount_type as "percent" | "amount" | null,
      discountValue: i.discount_type === "amount" && !remaining.eq(i.quantity as string) ? new D(i.discount_value as string).mul(remaining).div(i.quantity as string).toDecimalPlaces(2).toFixed(2) : (i.discount_value as string),
      taxRate: Number(i.tax_rate),
      serialNumbers: isReturn || target === "invoice" ? (i.serial_numbers as string[]).slice(0, Number(remaining.toString())) : [],
      sourceItemId: i.id as string,
    }));
  if (!lines.length) throw new AppError("BUSINESS_RULE", "Everything on this document has already been converted");
  const draft = await createDocument(t, {
    docType: target,
    partyId: src.party_id,
    branchId: src.branch_id,
    issueDate: opts.issueDate ?? t.today,
    placeOfSupply: src.place_of_supply as string,
    pricesIncludeTax: src.prices_include_tax as boolean,
    documentDiscountType: src.document_discount_type as "percent" | "amount" | null,
    documentDiscountValue: src.document_discount_type === "percent" ? (src.document_discount_value as string) : src.document_discount_type === "amount" && !isReturn ? (src.document_discount_value as string) : null,
    additionalCharges: isReturn ? null : (src.additional_charges as string),
    additionalChargesLabel: src.additional_charges_label as string | null,
    additionalChargesTaxRate: Number(src.additional_charges_tax_rate),
    roundOff: src.round_off_enabled as boolean,
    referenceNumber: src.number,
    notes: src.notes as string | null,
    terms: isReturn ? null : (src.terms as string | null),
    items: lines,
    sourceDocumentId: sourceId,
  });
  if (src.doc_type === "quotation" && src.status === "sent") await t.db.exec("update documents set status = 'accepted', accepted_at = now() where id = $1", [sourceId]);
  if (opts.finalize) return finalizeDocument(t, draft.id as string);
  return draft;
}

/**
 * Cancels an issued document. Stock movements are reversed with
 * compensating entries; nothing is deleted. Invoices with payments must have
 * those payments voided first (or be corrected with a credit note).
 */
export async function cancelDocument(t: Tenant, id: string, input: z.input<typeof cancelDocumentSchema>) {
  const { reason } = cancelDocumentSchema.parse(input);
  const doc = await t.db.maybe<DocRow>("select * from documents where id = $1 for update", [id]);
  if (!doc) throw notFound("Document");
  t.require(docPerm(doc.doc_type, "delete"));
  if (doc.status === "draft") throw new AppError("BUSINESS_RULE", "Drafts can simply be deleted");
  if (doc.status === "cancelled") throw new AppError("CONFLICT", "Already cancelled");
  const payments = await t.db.maybe(
    `select 1 from allocations a left join payments p on p.id = a.payment_id
      where (a.document_id = $1 or a.credit_document_id = $1) and a.payment_id is not null and p.status = 'active' limit 1`,
    [id],
  );
  if (payments) throw new AppError("BUSINESS_RULE", "This document has payments recorded against it. Void those payments first, or issue a credit/debit note.");
  const children = await t.db.maybe<{ number: string }>("select number from documents where source_document_id = $1 and status not in ('draft','cancelled') and doc_type in ('credit_note','debit_note') limit 1", [id]);
  if (children) throw new AppError("BUSINESS_RULE", `Credit/debit note ${children.number} exists for this document. Cancel it first.`);

  // Reverse stock with compensating movements.
  const moves = await t.db.query<{ product_id: string; branch_id: string; quantity: string; unit_cost: string; source_line_id: string }>(
    "select product_id, branch_id, quantity, unit_cost, source_line_id from stock_movements where source_type = 'document' and source_id = $1 and kind <> 'reversal'",
    [id],
  );
  for (const m of moves) {
    await moveStock(t, {
      productId: m.product_id, branchId: m.branch_id, quantity: new D(m.quantity).neg().toString(), kind: "reversal", unitCost: m.unit_cost,
      sourceType: "document", sourceId: id, sourceLineId: m.source_line_id, note: `Cancelled: ${reason}`,
    });
  }
  // Serial numbers.
  const items = await t.db.query<{ product_id: string | null; serial_numbers: string[]; quantity: string; source_item_id: string | null }>(
    "select product_id, serial_numbers, quantity, source_item_id from document_items where document_id = $1",
    [id],
  );
  for (const it of items) {
    if (!it.product_id || !it.serial_numbers.length) continue;
    if (doc.doc_type === "invoice") {
      await t.db.exec("update product_serials set status = 'in_stock', sale_document_id = null, party_id = null, sold_on = null, warranty_until = null where product_id = $1 and serial_number = any($2) and sale_document_id = $3", [it.product_id, it.serial_numbers, id]);
    } else if (doc.doc_type === "purchase_bill") {
      const sold = await t.db.maybe<{ serial_number: string }>("select serial_number from product_serials where product_id = $1 and serial_number = any($2) and status <> 'in_stock'", [it.product_id, it.serial_numbers]);
      if (sold) throw new AppError("BUSINESS_RULE", `Serial ${sold.serial_number} from this bill has already been sold or returned`);
      await t.db.exec("delete from product_serials where product_id = $1 and serial_number = any($2) and purchase_document_id = $3", [it.product_id, it.serial_numbers, id]);
    } else if (doc.doc_type === "credit_note") {
      await t.db.exec("update product_serials set status = 'sold' where product_id = $1 and serial_number = any($2) and status = 'in_stock'", [it.product_id, it.serial_numbers]);
    } else if (doc.doc_type === "debit_note") {
      await t.db.exec("update product_serials set status = 'in_stock' where product_id = $1 and serial_number = any($2) and status = 'returned_to_supplier'", [it.product_id, it.serial_numbers]);
    }
    // Undo fulfilment on the source.
  }
  if (doc.source_document_id && doc.doc_type !== "credit_note" && doc.doc_type !== "debit_note") {
    for (const it of items) {
      if (it.source_item_id) await t.db.exec("update document_items set fulfilled_quantity = greatest(fulfilled_quantity - $2, 0) where id = $1", [it.source_item_id, it.quantity]);
    }
  }
  // Remove credit-note applications (the note no longer exists).
  await t.db.exec("delete from allocations where credit_document_id = $1 or (document_id = $1 and credit_document_id is not null)", [id]);
  await t.db.exec("update documents set status = 'cancelled', cancelled_at = now(), cancelled_by = $2, cancel_reason = $3 where id = $1", [id, t.userId, reason]);
  if (doc.source_document_id && doc.doc_type !== "credit_note" && doc.doc_type !== "debit_note") await refreshSourceStatus(t, doc.source_document_id);
  await t.audit("document.cancel", "document", id, `${DOC_TYPE_META[doc.doc_type].label} ${doc.number} cancelled: ${reason}`);
  return getDocument(t, id);
}

export async function duplicateDocument(t: Tenant, id: string) {
  const d = await getDocument(t, id);
  return createDocument(t, {
    docType: d.docType as DocType,
    partyId: d.partyId as string,
    branchId: d.branchId as string,
    issueDate: t.today,
    pricesIncludeTax: d.pricesIncludeTax as boolean,
    documentDiscountType: d.documentDiscountType as "percent" | "amount" | null,
    documentDiscountValue: d.documentDiscountValue as string,
    additionalCharges: d.additionalCharges as string,
    additionalChargesLabel: d.additionalChargesLabel as string | null,
    additionalChargesTaxRate: Number(d.additionalChargesTaxRate),
    roundOff: d.roundOffEnabled as boolean,
    notes: d.notes as string | null,
    terms: d.terms as string | null,
    items: (d.items as Array<Record<string, unknown>>).map((i) => ({
      productId: i.productId as string | null,
      description: i.description as string,
      hsnCode: i.hsnCode as string | null,
      quantity: i.quantity as string,
      unit: i.unit as string,
      unitPrice: i.unitPrice as string,
      discountType: i.discountType as "percent" | "amount" | null,
      discountValue: i.discountValue as string,
      taxRate: Number(i.taxRate),
    })),
  });
}

const STATUS_FILTER: Record<string, string> = {
  overdue: "d.status in ('issued','partially_paid') and d.due_date < $TODAY",
  unpaid: "d.status in ('issued','partially_paid')",
  open: "d.status not in ('draft','cancelled','paid','converted','fulfilled','received','rejected')",
};

export async function listDocuments(t: Tenant, types: DocType[], query: unknown) {
  if (!types.length) throw new AppError("VALIDATION", "Document type required");
  for (const ty of types) t.require(docPerm(ty, "view"));
  const q = parseList(query);
  const extra = (query ?? {}) as { partyId?: string };
  const params: unknown[] = [types];
  const where = ["d.doc_type = any($1)"];
  if (t.branchIds) {
    params.push(t.branchIds);
    where.push(`d.branch_id = any($${params.length})`);
  }
  if (q.status) {
    if (STATUS_FILTER[q.status]) {
      params.push(t.today);
      where.push(STATUS_FILTER[q.status]!.replace("$TODAY", `$${params.length}`));
    } else {
      params.push(q.status);
      where.push(`d.status = $${params.length}`);
    }
  }
  if (extra.partyId && /^[0-9a-f-]{36}$/.test(extra.partyId)) {
    params.push(extra.partyId);
    where.push(`d.party_id = $${params.length}`);
  }
  if (q.from) {
    params.push(q.from);
    where.push(`d.issue_date >= $${params.length}`);
  }
  if (q.to) {
    params.push(q.to);
    where.push(`d.issue_date <= $${params.length}`);
  }
  if (q.q) {
    params.push(likePattern(q.q));
    where.push(`(d.number ilike $${params.length} or d.party_name ilike $${params.length} or d.reference_number ilike $${params.length} or d.supplier_invoice_number ilike $${params.length})`);
  }
  const w = where.join(" and ");
  const totals = await t.db.one<{ n: number; total: string; balance: string }>(
    `select count(*)::int n, coalesce(sum(grand_total) filter (where status <> 'cancelled' and status <> 'draft'), 0) total,
            coalesce(sum(balance_due) filter (where status in ('issued','partially_paid')), 0) balance from documents d where ${w}`,
    params,
  );
  const order = orderBy(q.sort, { date: "d.issue_date", number: "d.sequence_no", total: "d.grand_total", party: "lower(d.party_name)", due: "d.due_date", created: "d.created_at" }, "date", q.dir);
  params.push(q.pageSize, (q.page - 1) * q.pageSize, t.today);
  const rows = await t.db.query(
    `select d.id, d.doc_type, d.number, d.status, d.issue_date, d.due_date, d.valid_until, d.party_id, d.party_name, d.party_phone,
            d.grand_total, d.amount_settled, d.balance_due, d.created_at, d.sent_at,
            (d.status in ('issued','partially_paid') and d.due_date < $${params.length}) as is_overdue,
            (d.doc_type = 'quotation' and d.status = 'sent' and d.valid_until < $${params.length}) as is_expired
       from documents d where ${w} order by ${order}, d.created_at desc limit $${params.length - 2} offset $${params.length - 1}`,
    params,
  );
  return { items: camelize(rows), total: totals.n, page: q.page, pageSize: q.pageSize, sumTotal: totals.total, sumBalance: totals.balance };
}

export async function getDocument(t: Tenant, id: string) {
  const d = await t.db.maybe<Record<string, unknown>>(
    `select d.*, b.name as branch_name, b.state_code as branch_state_code, b.gstin as branch_gstin,
            src.number as source_number, src.doc_type as source_type, cu.full_name as created_by_name
       from documents d join branches b on b.id = d.branch_id left join documents src on src.id = d.source_document_id
       left join users cu on cu.id = d.created_by where d.id = $1`,
    [id],
  );
  if (!d) throw notFound("Document");
  t.require(docPerm(d.doc_type as DocType, "view"));
  if (t.branchIds && !t.branchIds.includes(d.branch_id as string)) throw forbidden("This document belongs to a branch you cannot access");
  const fin = t.can("financials.view");
  const items = await t.db.query<Record<string, unknown>>("select * from document_items where document_id = $1 order by position", [id]);
  const allocations = await t.db.query(
    `select a.id, a.amount, a.created_at, p.id as payment_id, p.number as payment_number, p.method, p.paid_on, p.status as payment_status,
            cd.id as credit_document_id, cd.number as credit_number, cd.doc_type as credit_type, td.id as target_id, td.number as target_number
       from allocations a left join payments p on p.id = a.payment_id left join documents cd on cd.id = a.credit_document_id
       join documents td on td.id = a.document_id
      where a.document_id = $1 or a.credit_document_id = $1 order by a.created_at`,
    [id],
  );
  const children = await t.db.query("select id, doc_type, number, status, grand_total from documents where source_document_id = $1 order by created_at", [id]);
  const out = camelize<Record<string, unknown>>(d);
  if (!fin) delete out.costTotal;
  type Obj = Record<string, unknown>;
  return {
    ...out,
    items: items.map((i) => {
      const c = camelize<Record<string, unknown>>(i);
      if (!fin) delete c.unitCost;
      return c;
    }),
    allocations: camelize<Obj>(allocations),
    children: camelize<Obj>(children),
    isOverdue: ["issued", "partially_paid"].includes(d.status as string) && !!d.due_date && (d.due_date as string) < t.today,
    grossProfit: fin && d.cost_total !== null && d.doc_type === "invoice" ? new D(d.taxable_total as string).sub(d.cost_total as string).toFixed(2) : undefined,
  } as Obj & { items: Obj[]; allocations: Obj[]; children: Obj[] };
}
