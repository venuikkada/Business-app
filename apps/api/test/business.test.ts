import { describe, expect, it } from "vitest";
import { gstinCheckChar } from "@cba/core";
import { addMember, ownerWithBusiness } from "./helpers.js";

const gstin = (st: string, pan = "AAAFZ1234A") => `${st}${pan}1Z` + gstinCheckChar(`${st}${pan}1Z`);
const shop = () => ownerWithBusiness({ gstin: gstin("36") });
const phone = { name: "Redmi Note 14", unit: "NOS", hsn: "8517", gstRate: 18, salePrice: 11800, purchasePrice: 9000, openingStock: 10, lowStockQty: 3 };
const line = (it: any, qty = 1) => ({ variantId: it.variantId, description: it.name, qty, rate: Number(it.salePrice), gstRate: it.gstRate });

describe("items and stock", () => {
  it("adds an item with opening stock, records stock in/out/count with a reason, flags low stock", async () => {
    const o = await shop();
    const it = (await o.post("/items", phone)).body.data;
    expect(it.sku).toMatch(/^ITM-/);
    expect(Number(it.qty)).toBe(10);
    expect((await o.post("/stock/entries", { variantId: it.variantId, mode: "out", qty: 8, reason: "damaged" })).body.data.qtyAfter).toBe("2.000");
    const low = (await o.get("/items?low=1")).body.data;
    expect(low.map((x: any) => x.id)).toContain(it.id);
    await o.post("/stock/entries", { variantId: it.variantId, mode: "set", qty: 25, reason: "count_correction" });
    const moves = (await o.get(`/stock/movements?variantId=${it.variantId}`)).body.data;
    expect(moves.map((m: any) => Number(m.qty))).toEqual([23, -8, 10]);
    const audit = (await o.get("/audit-logs?entityType=stock_movement")).body.data.items;
    expect(audit.length).toBe(2);
  });

  it("hides purchase price from a cashier and blocks them from editing items", async () => {
    const o = await shop();
    const it = (await o.post("/items", phone)).body.data;
    const c = await addMember(o, "cashier");
    expect((await c.get("/items")).body.data[0].purchasePrice).toBeNull();
    expect((await c.patch(`/items/${it.id}`, { salePrice: 1 })).status).toBe(403);
    expect((await c.post("/stock/entries", { variantId: it.variantId, mode: "in", qty: 5, reason: "purchase" })).status).toBe(403);
  });
});

describe("invoices and quotations", () => {
  it("same-state invoice: CGST+SGST, stock goes down, part payment then full payment, PDF", async () => {
    const o = await shop();
    const it = (await o.post("/items", phone)).body.data;
    const cust = (await o.post("/parties", { name: "Kiran Traders", mobile: "9812345678", stateCode: "36" })).body.data;
    const r = await o.post("/sales", { docType: "invoice", partyId: cust.id, priceIncludesTax: true, lines: [line(it, 2)], payment: { amount: 10000, mode: "upi", reference: "UPI123" } });
    expect(r.status).toBe(201);
    const inv = r.body.data;
    expect(inv.number).toBe("SLM/26-27/0001");
    expect([inv.taxableTotal, inv.cgst, inv.sgst, inv.igst, inv.grandTotal]).toEqual(["20000.00", "1800.00", "1800.00", "0.00", "23600.00"]);
    expect([inv.amountPaid, inv.balanceDue, inv.status]).toEqual(["10000.00", "13600.00", "partially_paid"]);
    expect(Number((await o.get(`/items/${it.id}`)).body.data.qty)).toBe(8);
    expect((await o.get(`/parties/${cust.id}`)).body.data.balance).toBe("13600.00");
    expect((await o.post(`/sales/${inv.id}/payments`, { amount: 20000, mode: "cash" })).body.error.code).toBe("overpayment");
    const paid = (await o.post(`/sales/${inv.id}/payments`, { amount: 13600, mode: "cash" })).body.data;
    expect([paid.status, paid.balanceDue, paid.payments.length]).toEqual(["paid", "0.00", 2]);
    const pdf = await o.get(`/sales/${inv.id}/pdf`).buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on("data", (d: Buffer) => c.push(d)); res.on("end", () => cb(null, Buffer.concat(c))); });
    expect(pdf.headers["content-type"]).toBe("application/pdf");
    expect(pdf.body.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.body.length).toBeGreaterThan(5000);
    const d = (await o.get("/dashboard")).body.data;
    expect([d.today, d.todayCount, d.receivable]).toEqual(["23600.00", 1, "0.00"]);
  });

  it("other-state customer gets IGST; a business without GSTIN charges no GST", async () => {
    const o = await shop();
    const it = (await o.post("/items", phone)).body.data;
    const ka = (await o.post("/parties", { name: "Bengaluru Buyer", gstin: gstin("29", "AABCB1234C") })).body.data;
    const inv = (await o.post("/sales", { docType: "invoice", partyId: ka.id, priceIncludesTax: false, lines: [{ ...line(it), rate: 10000 }] })).body.data;
    expect([inv.cgst, inv.igst, inv.grandTotal, inv.supplyType, inv.placeOfSupply]).toEqual(["0.00", "1800.00", "11800.00", "B2B", "29"]);
    const u = await ownerWithBusiness();
    const it2 = (await u.post("/items", phone)).body.data;
    const bill = (await u.post("/sales", { docType: "invoice", customerName: "Walk-in", priceIncludesTax: true, lines: [line(it2)] })).body.data;
    expect([bill.cgst, bill.igst, bill.grandTotal, bill.customer.name]).toEqual(["0.00", "0.00", "11800.00", "Walk-in"]);
  });

  it("quotation does not touch stock; converting makes an invoice; cancelling restores stock and voids payments", async () => {
    const o = await shop();
    const it = (await o.post("/items", phone)).body.data;
    const cust = (await o.post("/parties", { name: "Sai Enterprises" })).body.data;
    const q = (await o.post("/sales", { docType: "quotation", partyId: cust.id, priceIncludesTax: true, validUntil: "2027-01-31", lines: [line(it, 3)] })).body.data;
    expect(q.number).toBe("QT/26-27/0001");
    expect(Number((await o.get(`/items/${it.id}`)).body.data.qty)).toBe(10);
    const inv = (await o.post(`/sales/${q.id}/convert`)).body.data;
    expect([inv.docType, inv.sourceDocId, inv.grandTotal]).toEqual(["invoice", q.id, "35400.00"]);
    expect((await o.get(`/sales/${q.id}`)).body.data.status).toBe("converted");
    expect((await o.post(`/sales/${q.id}/convert`)).status).toBe(409);
    await o.post(`/sales/${inv.id}/payments`, { amount: 5000, mode: "cash" });
    const c = (await o.post(`/sales/${inv.id}/cancel`, { reason: "Customer changed mind" })).body.data;
    expect([c.status, c.payments[0].status]).toEqual(["cancelled", "void"]);
    expect(Number((await o.get(`/items/${it.id}`)).body.data.qty)).toBe(10);
    expect((await o.get(`/parties/${cust.id}`)).body.data.balance).toBe("0.00");
    expect((await o.get("/sales?docType=invoice")).body.data.length).toBe(1);
  });

  it("cannot bill another business's item or customer; cashier cannot cancel", async () => {
    const a = await shop();
    const b = await shop();
    const itB = (await b.post("/items", phone)).body.data;
    const custB = (await b.post("/parties", { name: "B customer" })).body.data;
    expect((await a.post("/sales", { docType: "invoice", priceIncludesTax: true, lines: [line(itB)] })).body.error.code).toBe("invalid_item");
    const itA = (await a.post("/items", phone)).body.data;
    expect((await a.post("/sales", { docType: "invoice", partyId: custB.id, priceIncludesTax: true, lines: [line(itA)] })).body.error.code).toBe("invalid_party");
    const inv = (await a.post("/sales", { docType: "invoice", priceIncludesTax: true, lines: [line(itA)] })).body.data;
    expect((await b.get(`/sales/${inv.id}`)).status).toBe(404);
    const cashier = await addMember(a, "cashier");
    expect((await cashier.post(`/sales/${inv.id}/cancel`, { reason: "no reason" })).status).toBe(403);
    expect((await cashier.post("/sales", { docType: "invoice", priceIncludesTax: true, lines: [line(itA)] })).status).toBe(201);
  });
});

describe("employees and payroll", () => {
  it("salary structure, pro-rated payslips, payslip PDF, finalise locks the month, bank account stays encrypted", async () => {
    const o = await shop();
    const e = (await o.post("/employees", {
      name: "Lakshmi Devi", designation: "Sales executive", joiningDate: "2026-04-01", bankAccount: "123456789012", bankIfsc: "SBIN0001234",
      basic: 15000, allowances: [{ name: "HRA", amount: 6000 }], deductions: [{ name: "PF", amount: 1800 }],
    })).body.data;
    expect([e.code, e.bankLast4, e.salary.basic]).toEqual(["EMP-001", "9012", "15000.00"]);
    const { db } = await import("../src/db/pool.js");
    const row = await db().one("SELECT bank_account_enc FROM employees WHERE id = :id", { id: e.id });
    expect(row.bank_account_enc).toMatch(/^v1:/);
    expect(row.bank_account_enc).not.toContain("123456789012");
    const run = (await o.post("/payroll/2026-11", { entries: [{ employeeId: e.id, paidDays: 15, bonus: 500, otherDeduction: 1000 }] })).body.data;
    const slip = run.rows[0].payslip;
    // November has 30 days: half month -> basic 7500 + HRA 3000 + bonus 500 = 11000; PF 900; advance 1000
    expect([run.daysInMonth, slip.gross, slip.totalDeductions, slip.netPay]).toEqual([30, "11000.00", "900.00", "9100.00"]);
    const pdf = await o.get(`/payslips/${slip.id}/pdf`).buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on("data", (d: Buffer) => c.push(d)); res.on("end", () => cb(null, Buffer.concat(c))); });
    expect(pdf.body.subarray(0, 5).toString()).toBe("%PDF-");
    expect((await o.post("/payroll/2026-11/finalise")).body.data.run.status).toBe("finalised");
    expect((await o.post("/payroll/2026-11", { entries: [{ employeeId: e.id, paidDays: 30 }] })).body.error.code).toBe("payroll_locked");
    const manager = await addMember(o, "manager");
    expect((await manager.get("/employees")).body.data[0].salary).toBeNull(); // manager sees staff, not salaries
    expect((await manager.get("/payroll/2026-11")).status).toBe(403);
  });
});
