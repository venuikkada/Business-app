/**
 * Acceptance tests from the product specification (section 11), run against
 * a real PostgreSQL database through the RLS-restricted application role.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { calculateDocument } from "@cba/core";
import { auth, businesses, parties, products, documents, payments, finance, reports, pdfs, withTenant } from "../src";
import { newUser, newBusiness, as, owner, asAppRole, expectCode, addMember, item, meta, STRONG } from "./helpers";

type U = Awaited<ReturnType<typeof newUser>>;

let A: U;
let bizA: string;
let customerA: string;
let productA: string;

beforeAll(async () => {
  A = await newUser("Asha Owner");
  bizA = await newBusiness(A.user, { name: "Asha Electronics", gstin: null, stateCode: "29" });
  await as(A.user, bizA, async (t) => {
    customerA = (await parties.createParty(t, { name: "Ravi Traders", phone: "9876543210", billingAddress: { stateCode: "29", city: "Mysuru" }, openingBalance: "0" })).id as string;
    const p = await products.createProduct(t, { name: "CCTV Camera 2MP", sku: "CAM-2MP", costPrice: "1200", sellingPrice: "2000", taxRate: 18, openingStock: "10", reorderLevel: "2" });
    productA = p.id as string;
  });
});

describe("1. registration and business creation", () => {
  it("a new user can register, sign in and create a business with defaults", async () => {
    const u = await newUser("New Owner");
    const login = await auth.login({ email: u.email, password: STRONG }, "web", meta);
    expect(login.token).toMatch(/^cba_/);
    const authed = await auth.authenticate(login.token);
    expect(authed?.user.email).toBe(u.email);
    const id = await newBusiness(u.user, { name: "Fresh Mart" });
    const list = await businesses.listMyBusinesses(u.user);
    expect(list.map((b) => b.id)).toContain(id);
    expect(list[0]!.roleKey).toBe("owner");
    await as(u.user, id, async (t) => {
      expect(t.plan.code).toBe("pro");
      expect(t.plan.status).toBe("trialing");
      const accounts = await finance.listAccounts(t);
      expect((accounts as unknown[]).length).toBe(2);
      const cats = await finance.listExpenseCategories(t);
      expect((cats as unknown[]).length).toBeGreaterThan(5);
    });
  });

  it("rejects duplicate email and weak passwords", async () => {
    await expectCode(auth.register({ fullName: "Dup", email: A.email, password: STRONG, acceptTerms: true }, meta), "CONFLICT");
    await expect(auth.register({ fullName: "Weak", email: "weak@example.test", password: "short", acceptTerms: true }, meta)).rejects.toThrow();
  });
});

describe("2. tenant isolation", () => {
  it("business B cannot read, change or reference business A's records", async () => {
    const B = await newUser("Bala");
    const bizB = await newBusiness(B.user, { name: "Bala Computers" });
    // Service layer
    await as(B.user, bizB, async (t) => {
      await expectCode(parties.getParty(t, customerA), "NOT_FOUND");
      await expectCode(products.getProduct(t, productA), "NOT_FOUND");
      const list = await parties.listParties(t, {});
      expect(list.items.find((p) => p.id === customerA)).toBeUndefined();
      // Referencing A's customer on B's invoice fails.
      await expectCode(documents.createDocument(t, { docType: "invoice", partyId: customerA, issueDate: t.today, items: [item()] }), "VALIDATION");
    });
    // Cannot even open a tenant context for a business you do not belong to.
    await expectCode(withTenant(B.user, bizA, meta, async () => 1), "FORBIDDEN");
  });

  it("RLS blocks cross-tenant access even for raw SQL on the app role", async () => {
    const B = await newUser("Bhavna");
    const bizB = await newBusiness(B.user);
    await asAppRole({ userId: B.user.id, businessId: bizB }, async (c) => {
      const all = await c.query("select id from parties");
      expect(all.rows.find((r) => r.id === customerA)).toBeUndefined();
      const upd = await c.query("update parties set name = 'hacked' where id = $1", [customerA]);
      expect(upd.rowCount).toBe(0);
      await expect(c.query("insert into parties(business_id, name) values ($1, 'x')", [bizA])).rejects.toThrow(/row-level security/);
    });
    // Spoofing app.business_id to A without membership yields nothing.
    await asAppRole({ userId: B.user.id, businessId: bizA }, async (c) => {
      const r = await c.query("select count(*)::int n from parties");
      expect(r.rows[0].n).toBe(0);
      const d = await c.query("select count(*)::int n from documents");
      expect(d.rows[0].n).toBe(0);
    });
    // No context at all → nothing.
    await asAppRole({}, async (c) => {
      const r = await c.query("select count(*)::int n from products");
      expect(r.rows[0].n).toBe(0);
    });
  });

  it("the super-admin database role has no access to tenant business data", async () => {
    const pg = await import("pg");
    const c = new pg.default.Client({ connectionString: process.env.PLATFORM_DATABASE_URL });
    await c.connect();
    try {
      for (const tbl of ["parties", "products", "documents", "payments", "expenses", "stock_movements"]) {
        await expect(c.query(`select 1 from ${tbl} limit 1`)).rejects.toThrow(/permission denied/);
      }
    } finally {
      await c.end();
    }
  });
});

describe("3–6. customers, products, quotation → invoice, totals, stock", () => {
  it("creates a quotation, converts it to an invoice and updates stock exactly once", async () => {
    await as(A.user, bizA, async (t) => {
      const q = await documents.createDocument(t, {
        docType: "quotation",
        partyId: customerA,
        issueDate: t.today,
        items: [{ productId: productA, description: "CCTV Camera 2MP", quantity: "3", unit: "pcs", unitPrice: "2000", discountType: "percent", discountValue: "10", taxRate: 18 }],
        additionalCharges: "150",
        additionalChargesLabel: "Installation",
        additionalChargesTaxRate: 18,
        roundOff: true,
      });
      expect(q.status).toBe("draft");
      const sent = await documents.finalizeDocument(t, q.id as string);
      expect(sent.status).toBe("sent");
      expect(sent.number).toMatch(/^QT\/\d{2}-\d{2}\/0001$/);

      // 5. Totals must equal the engine (3×2000 = 6000, −10% = 5400 + 150 charges; 18% intra-state)
      const expected = calculateDocument({ lines: [{ quantity: 3, unitPrice: 2000, discountType: "percent", discountValue: 10, taxRate: 18 }], pricesIncludeTax: false, isInterState: false, additionalCharges: 150, additionalChargesTaxRate: 18, roundOff: true });
      expect(sent.grandTotal).toBe(expected.grandTotal);
      expect(sent.grandTotal).toBe("6549.00");
      expect(sent.cgstTotal).toBe("499.50");
      expect(sent.sgstTotal).toBe("499.50");
      expect(sent.igstTotal).toBe("0.00");

      const before = await products.getProduct(t, productA);
      const stockBefore = Number((before.stock as Array<{ quantity: string }>)[0]!.quantity);
      // Quotations never move stock.
      expect(stockBefore).toBe(10);

      const draftInv = await documents.convertDocument(t, q.id as string, "invoice");
      expect(draftInv.sourceDocumentId).toBe(q.id);
      expect(draftInv.grandTotal).toBe("6549.00");
      const inv = await documents.finalizeDocument(t, draftInv.id as string);
      expect(inv.status).toBe("issued");
      expect(inv.number).toMatch(/^INV\//);
      const after = await products.getProduct(t, productA);
      expect(Number((after.stock as Array<{ quantity: string }>)[0]!.quantity)).toBe(7);

      // Finalising again is rejected and does not move stock again.
      await expectCode(documents.finalizeDocument(t, inv.id as string), "CONFLICT");
      const again = await products.getProduct(t, productA);
      expect(Number((again.stock as Array<{ quantity: string }>)[0]!.quantity)).toBe(7);

      const quote = await documents.getDocument(t, q.id as string);
      expect(quote.status).toBe("converted");
      // Gross profit estimate: taxable 5550 − cost 3×1200
      expect(inv.costTotal).toBe("3600.00");
      expect(inv.grossProfit).toBe("1950.00");
    });
  });

  it("the database refuses a second stock movement for the same document line", async () => {
    await as(A.user, bizA, async (t) => {
      const inv = await documents.createDocument(t, { docType: "invoice", partyId: customerA, issueDate: t.today, items: [{ productId: productA, description: "Cam", quantity: "1", unit: "pcs", unitPrice: "2000", taxRate: 18 }] });
      await documents.finalizeDocument(t, inv.id as string);
    });
    const line = await owner(async (c) => (await c.query("select source_line_id, branch_id from stock_movements where kind = 'sale' and business_id = $1 order by created_at desc limit 1", [bizA])).rows[0]);
    await expect(
      as(A.user, bizA, (t) => t.db.exec("insert into stock_movements(business_id, branch_id, product_id, quantity, kind, source_line_id) values ($1,$2,$3,-1,'sale',$4)", [bizA, line.branch_id, productA, line.source_line_id])),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("finalised invoices cannot be edited, even directly in SQL", async () => {
    await as(A.user, bizA, async (t) => {
      const inv = await documents.createDocument(t, { docType: "invoice", partyId: customerA, issueDate: t.today, items: [item({ unitPrice: "500" })] });
      const fin = await documents.finalizeDocument(t, inv.id as string);
      await expectCode(documents.updateDocument(t, fin.id as string, { docType: "invoice", partyId: customerA, issueDate: t.today, items: [item({ unitPrice: "1" })] }), "BUSINESS_RULE");
    });
    const id = await owner(async (c) => (await c.query("select id from documents where business_id = $1 and doc_type = 'invoice' and status = 'issued' limit 1", [bizA])).rows[0].id);
    await expect(as(A.user, bizA, (t) => t.db.exec("update documents set grand_total = 1, taxable_total = 1, tax_total = 0, cgst_total = 0, sgst_total = 0 where id = $1", [id]))).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await expect(as(A.user, bizA, (t) => t.db.exec("delete from documents where id = $1", [id]))).rejects.toMatchObject({ code: "BUSINESS_RULE" });
    await expect(as(A.user, bizA, (t) => t.db.exec("update document_items set unit_price = 1 where document_id = $1", [id]))).rejects.toMatchObject({ code: "BUSINESS_RULE" });
  });

  it("prevents negative stock by default and allows an audited owner override", async () => {
    const invId = await as(A.user, bizA, async (t) => {
      const p = await products.createProduct(t, { name: "DVR 8CH", costPrice: "3000", sellingPrice: "4500", taxRate: 18, openingStock: "1" });
      const inv = await documents.createDocument(t, { docType: "invoice", partyId: customerA, issueDate: t.today, items: [{ productId: p.id as string, description: "DVR", quantity: "2", unit: "pcs", unitPrice: "4500", taxRate: 18 }] });
      return inv.id as string;
    });
    await expectCode(as(A.user, bizA, (t) => documents.finalizeDocument(t, invId)), "NEGATIVE_STOCK");
    // The failed attempt rolled back completely: the draft is still a draft and stock is unchanged.
    await as(A.user, bizA, async (t) => {
      const list = await products.listProducts(t, { q: "DVR 8CH" });
      expect(Number(list.items[0]!.stock)).toBe(1);
      expect((await documents.getDocument(t, invId)).status).toBe("draft");
      const fin = await documents.finalizeDocument(t, invId, { allowNegativeStock: true });
      expect(fin.status).toBe("issued");
      const after = await products.listProducts(t, { q: "DVR 8CH" });
      expect(Number(after.items[0]!.stock)).toBe(-1);
    });
  });
});

describe("7. partial payments and outstanding balances", () => {
  it("tracks partial, full, over- and voided payments", async () => {
    await as(A.user, bizA, async (t) => {
      const cust = await parties.createParty(t, { name: "Meena Stores", billingAddress: { stateCode: "29" }, openingBalance: "0" });
      const inv = await documents.finalizeDocument(t, (await documents.createDocument(t, { docType: "invoice", partyId: cust.id as string, issueDate: t.today, items: [item({ unitPrice: "1000" })] })).id as string);
      expect(inv.grandTotal).toBe("1180.00");
      const p1 = await payments.recordPayment(t, { direction: "in", partyId: cust.id as string, amount: "400", method: "upi", paidOn: t.today, allocations: [{ documentId: inv.id as string, amount: "400" }] });
      let d = await documents.getDocument(t, inv.id as string);
      expect(d.status).toBe("partially_paid");
      expect(d.balanceDue).toBe("780.00");
      expect((await parties.getParty(t, cust.id as string)).balance).toBe("780.00");

      await expectCode(payments.recordPayment(t, { direction: "in", partyId: cust.id as string, amount: "800", method: "cash", paidOn: t.today, allocations: [{ documentId: inv.id as string, amount: "800" }] }), "BUSINESS_RULE");

      // Split payment: 500 cash + 280 card.
      await payments.recordPayment(t, { direction: "in", partyId: cust.id as string, amount: "500", method: "cash", paidOn: t.today, allocations: [{ documentId: inv.id as string, amount: "500" }] });
      await payments.recordPayment(t, { direction: "in", partyId: cust.id as string, amount: "280", method: "card", paidOn: t.today, allocations: [{ documentId: inv.id as string, amount: "280" }] });
      d = await documents.getDocument(t, inv.id as string);
      expect(d.status).toBe("paid");
      expect(d.balanceDue).toBe("0.00");
      expect((await parties.getParty(t, cust.id as string)).balance).toBe("0.00");

      await payments.voidPayment(t, p1.id as string, "Cheque bounced");
      d = await documents.getDocument(t, inv.id as string);
      expect(d.status).toBe("partially_paid");
      expect(d.balanceDue).toBe("400.00");
      expect((await parties.getParty(t, cust.id as string)).balance).toBe("400.00");

      // Advance payment without allocation reduces the ledger balance.
      await payments.recordPayment(t, { direction: "in", partyId: cust.id as string, amount: "1000", method: "bank_transfer", paidOn: t.today });
      expect((await parties.getParty(t, cust.id as string)).balance).toBe("-600.00");
      const aging = await payments.outstandingReport(t, "receivable");
      const row = aging.items.find((i) => i.partyId === cust.id);
      expect(row?.total).toBe("400.00");
      expect(row?.ledgerBalance).toBe("-600.00");
    });
  });
});

describe("8. purchases and expenses appear in reports", () => {
  it("purchase bill adds stock at cost; expense reduces net profit", async () => {
    const U2 = await newUser("Reports Owner");
    const biz = await newBusiness(U2.user, { stateCode: "27" });
    await as(U2.user, biz, async (t) => {
      const sup = await parties.createParty(t, { name: "Hikvision Distributor", isCustomer: false, isSupplier: true, gstin: null, billingAddress: { stateCode: "27" }, openingBalance: "0" });
      const cust = await parties.createParty(t, { name: "Walk-in", billingAddress: { stateCode: "27" }, openingBalance: "0" });
      const p = await products.createProduct(t, { name: "Hard disk 1TB", costPrice: "0", sellingPrice: "4000", taxRate: 18 });
      const bill = await documents.createDocument(t, { docType: "purchase_bill", partyId: sup.id as string, issueDate: t.today, supplierInvoiceNumber: "HV-991", items: [{ productId: p.id as string, description: "HDD 1TB", quantity: "5", unit: "pcs", unitPrice: "3000", taxRate: 18 }] });
      const fb = await documents.finalizeDocument(t, bill.id as string);
      expect(fb.grandTotal).toBe("17700.00");
      const prod = await products.getProduct(t, p.id as string);
      const st = (prod.stock as Array<{ quantity: string; avgCost: string }>)[0]!;
      expect(Number(st.quantity)).toBe(5);
      expect(Number(st.avgCost)).toBe(3000);

      const inv = await documents.createDocument(t, { docType: "invoice", partyId: cust.id as string, issueDate: t.today, items: [{ productId: p.id as string, description: "HDD 1TB", quantity: "2", unit: "pcs", unitPrice: "4000", taxRate: 18 }] });
      await documents.finalizeDocument(t, inv.id as string);
      const cats = (await finance.listExpenseCategories(t)) as Array<{ id: string; name: string }>;
      await finance.recordExpense(t, { categoryId: cats.find((c) => c.name === "Rent")!.id, amount: "1500", expenseDate: t.today, method: "cash" });
      await payments.recordPayment(t, { direction: "out", partyId: sup.id as string, amount: "10000", method: "bank_transfer", paidOn: t.today, allocations: [{ documentId: fb.id as string, amount: "10000" }] });

      const pl = await reports.profitAndLoss(t, { from: t.today, to: t.today });
      expect(pl.revenue.net).toBe("8000.00");
      expect(pl.costOfGoodsSold).toBe("6000.00");
      expect(pl.grossProfitEstimate).toBe("2000.00");
      expect(pl.expenses.total).toBe("1500.00");
      expect(pl.netProfitEstimate).toBe("500.00");
      expect(pl.outputGstCollected).toBe("1440.00");
      const gst = await reports.gstSummary(t, { from: t.today, to: t.today });
      expect(gst.outputTax).toBe("1440.00");
      expect(gst.inputTax).toBe("2700.00");
      expect(gst.netPayableEstimate).toBe("-1260.00");
      const dash = await reports.dashboard(t, { from: t.today, to: t.today });
      expect(dash.period.purchases).toBe("17700.00");
      expect(dash.period.expenses).toBe("1500.00");
      expect(dash.dues?.payable).toBe("7700.00");
      const book = await finance.cashbook(t, null, t.today, t.today);
      expect(book.outflow).toBe("11500.00");
    });
  });
});

describe("9. unauthorized users cannot access restricted financial records", () => {
  it("salesperson and technician permissions are enforced on the server", async () => {
    const sales = await addMember(bizA, "salesperson", "Sunil Sales");
    const tech = await addMember(bizA, "technician", "Tara Tech");
    await as(sales.user, bizA, async (t) => {
      await expectCode(reports.profitAndLoss(t, { from: t.today, to: t.today }), "FORBIDDEN");
      const p = await products.getProduct(t, productA);
      expect(p.costPrice).toBeUndefined();
      const inv = (await documents.listDocuments(t, ["invoice"], { status: "issued" })).items[0]!;
      const d = await documents.getDocument(t, inv.id as string);
      expect(d.costTotal).toBeUndefined();
      expect(d.grossProfit).toBeUndefined();
      await expectCode(finance.listAccounts(t), "FORBIDDEN");
      const dash = await reports.dashboard(t, { from: t.today, to: t.today });
      expect(dash.period.grossProfitEstimate).toBeUndefined();
      await expectCode(parties.deleteParty(t, customerA), "FORBIDDEN");
    });
    await as(tech.user, bizA, async (t) => {
      await expectCode(documents.listDocuments(t, ["invoice"], {}), "FORBIDDEN");
      await expectCode(payments.listPayments(t, {}), "FORBIDDEN");
      await expectCode(reports.dashboard(t, { from: t.today, to: t.today }), "FORBIDDEN");
    });
  });
});

describe("10. subscription limits are enforced on the server", () => {
  it("blocks invoices beyond the plan's monthly limit", async () => {
    const U3 = await newUser("Limit Owner");
    const biz = await newBusiness(U3.user);
    // Expire the trial → the business falls back to the free plan; tighten the limit for the test.
    await owner(async (c) => {
      await c.query("update subscriptions set status = 'expired', trial_ends_at = now() - interval '1 day' where business_id = $1", [biz]);
      await c.query(`update plans set limits = jsonb_set(limits, '{invoices_per_month}', '2') where code = 'free'`);
    });
    try {
      await as(U3.user, biz, async (t) => {
        expect(t.plan.effectiveCode).toBe("free");
        const c = await parties.createParty(t, { name: "C1", billingAddress: { stateCode: "29" }, openingBalance: "0" });
        for (let i = 0; i < 2; i++) {
          const d = await documents.createDocument(t, { docType: "invoice", partyId: c.id as string, issueDate: t.today, items: [item()] });
          await documents.finalizeDocument(t, d.id as string);
        }
        const d3 = await documents.createDocument(t, { docType: "invoice", partyId: c.id as string, issueDate: t.today, items: [item()] });
        await expectCode(documents.finalizeDocument(t, d3.id as string), "PLAN_LIMIT");
        // Free plan has no expenses module.
        const cats = (await finance.listExpenseCategories(t)) as Array<{ id: string }>;
        await expectCode(finance.recordExpense(t, { categoryId: cats[0]!.id, amount: "10", expenseDate: t.today, method: "cash" }), "FEATURE_NOT_IN_PLAN");
      });
    } finally {
      await owner((c) => c.query(`update plans set limits = jsonb_set(limits, '{invoices_per_month}', '30') where code = 'free'`));
    }
  });
});

describe("11. invoice PDFs", () => {
  it("renders a readable PDF and a public share link", async () => {
    await as(A.user, bizA, async (t) => {
      const inv = (await documents.listDocuments(t, ["invoice"], { status: "issued" })).items[0]!;
      const { pdf, filename } = await pdfs.documentPdf(t, inv.id as string);
      expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
      expect(pdf.length).toBeGreaterThan(5000);
      expect(filename).toMatch(/^INV-/);
      // A short invoice must fit on one page (regression: footer used to spill onto extra pages).
      expect(pdf.toString("latin1").match(/\/Type \/Pages[\s\S]*?\/Count (\d+)/)?.[1]).toBe("1");
      const doc = await documents.getDocument(t, inv.id as string);
      expect(doc.shareToken).toBeTruthy();
      const pub = await pdfs.publicDocumentPdf(doc.shareToken as string);
      expect(pub.pdf.subarray(0, 5).toString()).toBe("%PDF-");
      const data = await pdfs.publicDocument(doc.shareToken as string);
      expect(JSON.stringify(data)).not.toContain("cost_total");
      expect(JSON.stringify(data)).not.toContain("unit_cost");
    });
    await expectCode(pdfs.publicDocument("x".repeat(30)), "NOT_FOUND");
  });
});

describe("12. audit trail", () => {
  it("records important operations and the audit log is append-only", async () => {
    await as(A.user, bizA, async (t) => {
      const rows = await t.db.query<{ action: string }>("select action from audit_logs");
      const actions = new Set(rows.map((r) => r.action));
      for (const a of ["business.create", "party.create", "product.create", "document.finalize", "payment.create", "payment.void"]) expect(actions).toContain(a);
    });
    await expect(as(A.user, bizA, (t) => t.db.exec("update audit_logs set summary = 'x'"))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(owner((c) => c.query("delete from audit_logs where business_id = $1", [bizA]))).rejects.toThrow(/append-only/);
  });
});
