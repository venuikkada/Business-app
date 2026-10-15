import { calculateDocument, stateName, type DocType } from "@cba/core";
import { appTx } from "../db";
import type { Tenant } from "../context";
import { AppError, notFound } from "../errors";
import { storage } from "../storage";
import { renderDocumentPdf, renderReceiptPdf, renderTablePdf, type PdfBusiness, type PdfDocumentData, type PdfTable } from "../pdf/render";
import { getDocument, docPerm } from "./documents";
import { getPayment } from "./payments";

function addrLines(a: Record<string, unknown> | null | undefined): string[] {
  if (!a) return [];
  const line1 = [a.line1 ?? a.address_line1, a.line2 ?? a.address_line2].filter(Boolean).join(", ");
  const st = (a.stateCode ?? a.state_code) as string | undefined;
  const line2 = [a.city, st ? stateName(st) : null, a.pincode].filter(Boolean).join(", ");
  return [line1, line2].filter((x) => x);
}

async function loadLogo(key: string | null | undefined): Promise<Buffer | null> {
  if (!key) return null;
  try {
    return await storage().get(key);
  } catch {
    return null;
  }
}

async function businessFor(t: Tenant, branchId?: string): Promise<PdfBusiness> {
  const b = t.business;
  const br = branchId ? await t.db.maybe<Record<string, unknown>>("select * from branches where id = $1", [branchId]) : null;
  const logoKey = b.logo_file_id ? (await t.db.maybe<{ storage_key: string }>("select storage_key from files where id = $1", [b.logo_file_id]))?.storage_key : null;
  const s = t.settings;
  return {
    name: b.name,
    legalName: b.legal_name,
    gstin: (br?.gstin as string) ?? b.gstin,
    phone: b.phone,
    email: b.email,
    address: addrLines(br?.address_line1 ? br : (b as unknown as Record<string, unknown>)),
    stateCode: (br?.state_code as string) ?? b.state_code,
    logo: await loadLogo(logoKey),
    bank: { name: s.bankName, accountName: s.bankAccountName, accountNumber: s.bankAccountNumber, ifsc: s.bankIfsc },
    upiId: s.upiId,
    gstScheme: s.gstScheme,
    // Free plan documents always carry the product footer.
    brandingFooter: s.showBrandingFooter || t.plan.effectiveCode === "free",
  };
}

function toPdfData(d: Record<string, unknown>, items: Array<Record<string, unknown>>): PdfDocumentData {
  const taxBreakup = calculateDocument({
    lines: items.map((i) => ({ quantity: i.quantity as string, unitPrice: i.unitPrice as string, discountType: i.discountType as "percent" | "amount" | null, discountValue: i.discountValue as string, taxRate: i.taxRate as string })),
    pricesIncludeTax: d.pricesIncludeTax as boolean,
    isInterState: d.isInterState as boolean,
    documentDiscountType: d.documentDiscountType as "percent" | "amount" | null,
    documentDiscountValue: d.documentDiscountValue as string,
    additionalCharges: d.additionalCharges as string,
    additionalChargesTaxRate: d.additionalChargesTaxRate as string,
    roundOff: d.roundOffEnabled as boolean,
  }).taxBreakup;
  return {
    docType: d.docType as DocType,
    number: (d.number as string) ?? null,
    status: d.status as string,
    issueDate: d.issueDate as string,
    dueDate: d.dueDate as string | null,
    validUntil: d.validUntil as string | null,
    placeOfSupply: d.placeOfSupply as string,
    isInterState: d.isInterState as boolean,
    reverseCharge: d.reverseCharge as boolean,
    referenceNumber: d.referenceNumber as string | null,
    supplierInvoiceNumber: d.supplierInvoiceNumber as string | null,
    party: {
      name: d.partyName as string,
      gstin: d.partyGstin as string | null,
      phone: d.partyPhone as string | null,
      billing: addrLines(d.partyBillingAddress as Record<string, unknown>),
      shipping: d.partyShippingAddress ? addrLines(d.partyShippingAddress as Record<string, unknown>) : null,
    },
    items: items.map((i) => ({
      description: i.description as string,
      hsnCode: i.hsnCode as string | null,
      quantity: String(Number(i.quantity)),
      unit: i.unit as string,
      unitPrice: i.unitPrice as string,
      lineDiscount: i.lineDiscount as string,
      taxableValue: i.taxableValue as string,
      taxRate: i.taxRate as string,
      cgst: i.cgst as string,
      sgst: i.sgst as string,
      igst: i.igst as string,
      total: i.total as string,
      serialNumbers: (i.serialNumbers as string[]) ?? [],
    })),
    totals: {
      grossTotal: d.grossTotal as string,
      discountTotal: (Number(d.lineDiscountTotal) + Number(d.documentDiscount)).toFixed(2),
      additionalCharges: d.additionalCharges as string,
      additionalChargesLabel: d.additionalChargesLabel as string | null,
      taxableTotal: d.taxableTotal as string,
      cgstTotal: d.cgstTotal as string,
      sgstTotal: d.sgstTotal as string,
      igstTotal: d.igstTotal as string,
      roundOff: d.roundOff as string,
      grandTotal: d.grandTotal as string,
      amountSettled: d.amountSettled as string,
      balanceDue: d.balanceDue as string,
    },
    taxBreakup,
    notes: d.notes as string | null,
    terms: d.terms as string | null,
    cancelled: d.status === "cancelled",
  };
}

export async function documentPdf(t: Tenant, id: string) {
  const d = await getDocument(t, id);
  t.require(docPerm(d.docType as DocType, "view"));
  if (!t.hasFeature("pdf")) throw new AppError("FEATURE_NOT_IN_PLAN", "PDF documents are not included in your plan", { feature: "pdf" });
  const pdf = await renderDocumentPdf(await businessFor(t, d.branchId as string), toPdfData(d, d.items as Array<Record<string, unknown>>));
  return { pdf, filename: `${(d.number as string) ?? "draft"}.pdf`.replace(/\//g, "-") };
}

export async function receiptPdf(t: Tenant, id: string) {
  const p = await getPayment(t, id);
  if (!t.hasFeature("pdf")) throw new AppError("FEATURE_NOT_IN_PLAN", "PDF documents are not included in your plan", { feature: "pdf" });
  const pdf = await renderReceiptPdf(await businessFor(t), {
    number: p.number as string,
    direction: p.direction as "in" | "out",
    paidOn: p.paidOn as string,
    amount: p.amount as string,
    method: p.method as string,
    reference: p.reference as string | null,
    partyName: p.partyName as string,
    allocations: (p.allocations as unknown as Array<{ number: string; amount: string }>).map((a) => ({ number: a.number, amount: a.amount })),
    unallocated: p.unallocated as string,
    status: p.status as string,
    notes: p.notes as string | null,
  });
  return { pdf, filename: `${p.number as string}.pdf`.replace(/\//g, "-") };
}

export async function reportPdf(t: Tenant, table: PdfTable) {
  t.require("reports.export");
  return renderTablePdf(await businessFor(t), table);
}

/** Public share link: no login, read-only, only issued documents. */
export async function publicDocument(token: string) {
  if (!/^[A-Za-z0-9_-]{24,64}$/.test(token)) throw notFound("Document");
  const r = await appTx({}, (db) => db.maybe<{ v: Record<string, unknown> | null }>("select app.public_document($1) as v", [token]));
  if (!r?.v) throw notFound("Document");
  return r.v as { document: Record<string, unknown>; items: Array<Record<string, unknown>>; business: Record<string, unknown> };
}

export async function publicDocumentPdf(token: string) {
  const { document, items, business } = await publicDocument(token);
  const { camelize } = await import("../util");
  const d = camelize<Record<string, unknown>>(document);
  const its = camelize<Array<Record<string, unknown>>>(items);
  const s = (business.settings ?? {}) as Record<string, unknown>;
  const pdf = await renderDocumentPdf(
    {
      name: business.name as string,
      legalName: business.legal_name as string | null,
      gstin: business.gstin as string | null,
      phone: business.phone as string | null,
      email: business.email as string | null,
      address: addrLines(business),
      logo: await loadLogo(business.logo_storage_key as string | null),
      bank: { name: s.bankName as string, accountName: s.bankAccountName as string, accountNumber: s.bankAccountNumber as string, ifsc: s.bankIfsc as string },
      upiId: s.upiId as string | null,
      gstScheme: (s.gstScheme as string) ?? "regular",
      brandingFooter: true,
    },
    toPdfData(d, its),
  );
  return { pdf, filename: `${(d.number as string) ?? "document"}.pdf`.replace(/\//g, "-") };
}
