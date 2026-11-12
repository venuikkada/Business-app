import { GST_RATES, validateGSTIN } from "@cba/core";
import { z } from "zod";
import type { Response } from "express";
import type { TenantCtx } from "../http/context.js";
import { ApiRouter, idParam } from "../http/router.js";
import { istDate } from "../lib/dates.js";
import { readStoredFile } from "./files/storage.js";
import { finalisePayroll, listEmployees, payrollMonth, payslipForPdf, runPayroll, saveEmployee } from "./hr/service.js";
import { createItem, deleteItem, getItem, listItems, updateItem } from "./items/service.js";
import { createParty, getParty, listParties, updateParty } from "./parties/service.js";
import { renderPayslipPdf, renderSalesPdf, type Seller } from "./pdf/render.js";
import { cancelDocument, convertToInvoice, createDocument, getDocument, listDocuments, recordPayment } from "./sales/service.js";
import { listMovements, manualEntry } from "./stock/service.js";

/** Step 2 routes: items, stock, customers/suppliers, quotations & invoices, employees, payroll, dashboard. */
export const businessRoutes = new ApiRouter("");
const r = businessRoutes;

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const money = z.number().min(0).max(9_999_999_999).multipleOf(0.01);
const gstRate = z.number().refine((v) => (GST_RATES as readonly number[]).includes(v), "Choose a valid GST rate");
const text = (max: number) => z.string().trim().max(max).nullable().optional();
const search = z.object({ search: z.string().trim().max(80).optional(), limit: z.coerce.number().int().min(1).max(500).default(200) });
const flag = z.enum(["1", "0"]).optional().transform((v) => v === "1");

/* ---------- items ---------- */
const itemBody = z.object({
  name: z.string().trim().min(1).max(200), itemType: z.enum(["goods", "service"]).default("goods"), unit: z.string().trim().max(10).default("NOS"),
  category: text(100), hsn: z.string().trim().regex(/^\d{4,8}$/, "HSN/SAC is 4 to 8 digits").nullable().optional().or(z.literal("").transform(() => null)),
  gstRate: gstRate.default(0), priceIncludesTax: z.boolean().default(true), salePrice: money, purchasePrice: money.optional(), mrp: money.nullable().optional(),
  sku: text(60), barcode: text(60), lowStockQty: z.number().min(0).nullable().optional(), openingStock: z.number().min(0).max(9_999_999).optional(),
  branchId: z.number().int().positive().optional(), isActive: z.boolean().optional(),
});
r.get("/items", { access: { perm: ["items.view", "sales.create"] }, query: search.extend({ branchId: z.coerce.number().int().positive().optional(), low: flag, stockOnly: flag }) },
  async ({ ctx, query }) => listItems(ctx, query));
r.get("/items/:id", { access: { perm: "items.view" } }, async ({ ctx, params }) => getItem(ctx, idParam(params)));
r.post("/items", { access: { perm: "items.create" }, body: itemBody }, async ({ ctx, body, res }) => (res.status(201), createItem(ctx, body)));
r.patch("/items/:id", { access: { perm: "items.edit" }, body: itemBody.partial() }, async ({ ctx, body, params }) => updateItem(ctx, idParam(params), body));
r.delete("/items/:id", { access: { perm: "items.delete" } }, async ({ ctx, params }) => deleteItem(ctx, idParam(params)));
r.get("/units", { access: { perm: "any_member" } }, async ({ ctx }) => ctx.tdb.all("SELECT code, name FROM units WHERE tenant_id = :tenantId ORDER BY code"));

/* ---------- stock ---------- */
r.post("/stock/entries", {
  access: { perm: "stock.adjust" },
  body: z.object({
    branchId: z.number().int().positive().optional(), variantId: z.number().int().positive(), mode: z.enum(["in", "out", "set"]),
    qty: z.number().min(0).max(9_999_999), unitCost: money.nullable().optional(),
    reason: z.enum(["purchase", "opening", "damaged", "expired", "lost", "theft", "count_correction", "sample", "own_use", "other"]), note: text(150),
  }),
}, async ({ ctx, body, res }) => (res.status(201), manualEntry(ctx, body)));
r.get("/stock/movements", { access: { perm: "stock.view" }, query: z.object({ variantId: z.coerce.number().int().positive() }) }, async ({ ctx, query }) => listMovements(ctx, query.variantId));

/* ---------- customers & suppliers ---------- */
const partyBody = z.object({
  partyType: z.enum(["customer", "supplier", "both"]).default("customer"), name: z.string().trim().min(1).max(200), mobile: text(15), email: text(190),
  gstin: z.string().trim().toUpperCase().refine((v) => validateGSTIN(v).valid, "Invalid GSTIN").nullable().optional().or(z.literal("").transform(() => null)),
  stateCode: z.string().regex(/^\d{2}$/).nullable().optional().or(z.literal("").transform(() => null)), billingAddress: text(500),
  openingBalance: z.number().min(-9_999_999_999).max(9_999_999_999).optional(), creditLimit: money.nullable().optional(), notes: text(2000),
});
r.get("/parties", { access: { perm: ["parties.view", "sales.create"] }, query: search.extend({ type: z.enum(["customer", "supplier"]).optional() }) }, async ({ ctx, query }) => listParties(ctx, query));
r.get("/parties/:id", { access: { perm: "parties.view" } }, async ({ ctx, params }) => getParty(ctx, idParam(params)));
r.post("/parties", { access: { perm: "parties.create" }, body: partyBody }, async ({ ctx, body, res }) => (res.status(201), createParty(ctx, body)));
r.patch("/parties/:id", { access: { perm: "parties.edit" }, body: partyBody.omit({ openingBalance: true }).partial().extend({ isActive: z.boolean().optional() }) },
  async ({ ctx, body, params }) => updateParty(ctx, idParam(params), body));

/* ---------- quotations & invoices ---------- */
const payment = z.object({ amount: z.number().positive().max(9_999_999_999).multipleOf(0.01), mode: z.enum(["cash", "upi", "bank", "card", "cheque"]), reference: text(100), date: date.optional() });
const docBody = z.object({
  docType: z.enum(["quotation", "invoice"]), branchId: z.number().int().positive().optional(), docDate: date.optional(), dueDate: date.nullable().optional(),
  validUntil: date.nullable().optional(), partyId: z.number().int().positive().nullable().optional(), customerName: text(200), customerMobile: text(15),
  priceIncludesTax: z.boolean().default(true), discount: money.optional(), notes: text(1000), payment: payment.omit({ date: true }).nullable().optional(),
  lines: z.array(z.object({
    variantId: z.number().int().positive().nullable().optional(), description: z.string().trim().min(1).max(300), hsn: text(8),
    qty: z.number().positive().max(9_999_999), unit: z.string().trim().max(10).optional(), rate: money, discountPct: z.number().min(0).max(100).optional(), gstRate,
  })).min(1).max(200),
});
r.get("/sales", { access: { perm: "sales.view" }, query: search.extend({ docType: z.enum(["quotation", "invoice"]), status: z.string().regex(/^[a-z_]{1,20}$/).optional(), from: date.optional(), to: date.optional() }) },
  async ({ ctx, query }) => listDocuments(ctx, query));
r.post("/sales", { access: { perm: "sales.create" }, body: docBody }, async ({ ctx, body, res }) => (res.status(201), createDocument(ctx, body)));
r.get("/sales/:id", { access: { perm: "sales.view" } }, async ({ ctx, params }) => getDocument(ctx, idParam(params)));
r.post("/sales/:id/payments", { access: { perm: "payments.create" }, body: payment }, async ({ ctx, body, params }) => recordPayment(ctx, idParam(params), body));
r.post("/sales/:id/convert", { access: { perm: "sales.create" } }, async ({ ctx, params, res }) => (res.status(201), convertToInvoice(ctx, idParam(params))));
r.post("/sales/:id/cancel", { access: { perm: "sales.cancel" }, body: z.object({ reason: z.string().trim().min(3).max(255) }) }, async ({ ctx, body, params }) => cancelDocument(ctx, idParam(params), body.reason));

async function seller(ctx: TenantCtx, branchId?: number): Promise<Seller> {
  const t = await ctx.tdb.one("SELECT t.name, t.gstin, t.address_line1, t.city, t.pincode, t.phone, t.state_code, f.storage_path, f.mime_type FROM tenants t LEFT JOIN files f ON f.tenant_id = t.id AND f.id = t.logo_file_id WHERE t.id = :tenantId");
  const b = branchId ? await ctx.tdb.one("SELECT gstin, state_code, address_line1, city, pincode, phone FROM branches WHERE tenant_id = :tenantId AND id = :id", { id: branchId }) : null;
  const logo = t.storage_path && t.mime_type !== "image/webp" ? await readStoredFile(t.storage_path).catch(() => null) : null;
  const src = b?.address_line1 ? b : t;
  return { name: t.name, gstin: b?.gstin ?? t.gstin, stateCode: b?.state_code ?? t.state_code, phone: b?.phone ?? t.phone, logo, address: [src.address_line1, src.city, src.pincode].filter(Boolean).join(", ") || null };
}
function sendPdf(res: Response, buf: Buffer, name: string) {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${name.replace(/[^\w.-]+/g, "-")}.pdf"`);
  res.end(buf);
}
r.get("/sales/:id/pdf", { access: { perm: "sales.view" } }, async ({ ctx, params, res }) => {
  const d = await getDocument(ctx, idParam(params));
  sendPdf(res, await renderSalesPdf(d, await seller(ctx, d.branchId)), d.number);
});

/* ---------- employees & payroll ---------- */
const comp = z.array(z.object({ name: z.string().trim().min(1).max(40), amount: money })).max(15);
const empBody = z.object({
  name: z.string().trim().min(1).max(120), mobile: text(15), designation: text(80), department: text(80), branchId: z.number().int().positive().nullable().optional(),
  joiningDate: date, pan: z.string().trim().toUpperCase().regex(/^[A-Z]{5}\d{4}[A-Z]$/, "Invalid PAN").nullable().optional().or(z.literal("").transform(() => null)),
  uan: z.string().trim().regex(/^\d{12}$/, "UAN is 12 digits").nullable().optional().or(z.literal("").transform(() => null)),
  bankAccount: z.string().trim().regex(/^\d{6,18}$/, "Account number is 6 to 18 digits").nullable().optional().or(z.literal("").transform(() => null)),
  bankIfsc: z.string().trim().toUpperCase().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "Invalid IFSC").nullable().optional().or(z.literal("").transform(() => null)),
  status: z.enum(["active", "on_notice", "left"]).optional(), basic: money.optional(), allowances: comp.optional(), deductions: comp.optional(),
});
r.get("/employees", { access: { perm: "employees.view" } }, async ({ ctx }) => listEmployees(ctx));
r.post("/employees", { access: { perm: "employees.create" }, body: empBody }, async ({ ctx, body, res }) => (res.status(201), saveEmployee(ctx, null, body)));
r.patch("/employees/:id", { access: { perm: "employees.edit" }, body: empBody }, async ({ ctx, body, params }) => saveEmployee(ctx, idParam(params), body));
r.get("/payroll/:month", { access: { perm: "payroll.view" } }, async ({ ctx, params }) => payrollMonth(ctx, month.parse(params.month)));
r.post("/payroll/:month", {
  access: { perm: "payroll.run" },
  body: z.object({ entries: z.array(z.object({ employeeId: z.number().int().positive(), paidDays: z.number().min(0).max(31).multipleOf(0.5), bonus: money.optional(), otherDeduction: money.optional() })).min(1).max(1000) }),
}, async ({ ctx, body, params }) => runPayroll(ctx, month.parse(params.month), body.entries));
r.post("/payroll/:month/finalise", { access: { perm: "payroll.run" } }, async ({ ctx, params }) => finalisePayroll(ctx, month.parse(params.month)));
r.get("/payslips/:id/pdf", { access: { perm: "payroll.view" } }, async ({ ctx, params, res }) => {
  const p = await payslipForPdf(ctx, idParam(params));
  sendPdf(res, await renderPayslipPdf(p, await seller(ctx)), `payslip-${p.employee.code}-${p.month}`);
});

/* ---------- dashboard ---------- */
r.get("/dashboard", { access: { perm: "dashboard.view" } }, async ({ ctx }) => {
  const today = istDate();
  const p: Record<string, unknown> = { today, month: `${today.slice(0, 7)}-01`, week: new Date(Date.parse(today) - 6 * 86_400_000).toISOString().slice(0, 10) };
  const bf = ctx.branchIds ? ((p.bids = ctx.branchIds.length ? ctx.branchIds : [0]), "AND branch_id IN (:bids)") : "";
  const inv = `FROM sales_documents WHERE tenant_id = :tenantId AND doc_type = 'invoice' AND status <> 'cancelled' ${bf}`;
  const s = await ctx.tdb.one(
    `SELECT COALESCE(SUM(IF(doc_date = :today, grand_total, 0)), 0) AS today, COALESCE(SUM(IF(doc_date = :today, 1, 0)), 0) AS today_count,
            COALESCE(SUM(IF(doc_date >= :month, grand_total, 0)), 0) AS month, COALESCE(SUM(balance_due), 0) AS receivable, COALESCE(SUM(balance_due > 0), 0) AS unpaid_count ${inv}`, p);
  const days = await ctx.tdb.all(`SELECT doc_date AS d, SUM(grand_total) AS total ${inv} AND doc_date >= :week GROUP BY doc_date ORDER BY doc_date`, p);
  const recent = await ctx.tdb.all(`SELECT id, number, doc_date, party_snapshot, grand_total, status ${inv} ORDER BY id DESC LIMIT 6`, p);
  const low = ctx.permissions.has("stock.view") ? (await listItems(ctx, { low: true, stockOnly: true, limit: 500 })).slice(0, 6) : [];
  const counts = await ctx.tdb.one(
    `SELECT (SELECT COUNT(*) FROM items WHERE tenant_id = :tenantId AND deleted_at IS NULL) AS items,
            (SELECT COUNT(*) FROM parties WHERE tenant_id = :tenantId AND deleted_at IS NULL) AS parties,
            (SELECT COUNT(*) FROM employees WHERE tenant_id = :tenantId AND status <> 'left') AS employees,
            (SELECT COUNT(*) FROM sales_documents WHERE tenant_id = :tenantId AND doc_type = 'quotation' AND status = 'sent') AS open_quotes`);
  const byDay = new Map(days.map((d) => [d.d, String(d.total)]));
  return {
    today: s.today, todayCount: Number(s.today_count), month: s.month, receivable: s.receivable, unpaidCount: Number(s.unpaid_count),
    week: Array.from({ length: 7 }, (_, i) => { const d = new Date(Date.parse(p.week as string) + i * 86_400_000).toISOString().slice(0, 10); return { date: d, total: byDay.get(d) ?? "0" }; }),
    recent: recent.map((x) => ({ id: Number(x.id), number: x.number, date: x.doc_date, customer: (typeof x.party_snapshot === "string" ? JSON.parse(x.party_snapshot) : x.party_snapshot)?.name ?? "", total: x.grand_total, status: x.status })),
    lowStock: low.map((i) => ({ id: i.id, name: i.name, qty: i.qty, unit: i.unit })),
    counts: { items: Number(counts.items), parties: Number(counts.parties), employees: Number(counts.employees), openQuotations: Number(counts.open_quotes) },
  };
});
