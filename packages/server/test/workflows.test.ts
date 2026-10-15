import { describe, it, expect, beforeAll } from "vitest";
import { parties, products, documents, payments, finance, service, approvals, businesses, team, idempotent, exportsSvc, notifications } from "../src";
import { runDailyJobs } from "../src/platform";
import { newUser, newBusiness, as, owner, expectCode, addMember, item } from "./helpers";
import JSZip from "jszip";

type U = Awaited<ReturnType<typeof newUser>>;
let O: U;
let biz: string;
let cust: string;
let sup: string;

const stockOf = async (t: Parameters<Parameters<typeof as>[2]>[0], productId: string) =>
  Number(((await products.getProduct(t, productId)).stock as Array<{ quantity: string }>).reduce((a, s) => a + Number(s.quantity), 0));

beforeAll(async () => {
  O = await newUser("Workflow Owner");
  biz = await newBusiness(O.user, { name: "Workflow IT Solutions", stateCode: "33" });
  // Business plan so multi-branch and every module are available.
  await owner((c) => c.query("update subscriptions set plan_id = (select id from plans where code = 'business'), status = 'active', current_period_end = now() + interval '30 days' where business_id = $1", [biz]));
  await as(O.user, biz, async (t) => {
    cust = (await parties.createParty(t, { name: "Chennai Clinic", billingAddress: { stateCode: "33" }, openingBalance: "0" })).id as string;
    sup = (await parties.createParty(t, { name: "Delhi Distributor", isCustomer: false, isSupplier: true, billingAddress: { stateCode: "07" }, openingBalance: "0" })).id as string;
  });
});

describe("credit notes and cancellations", () => {
  it("a sales return restores stock at original cost and settles the invoice", async () => {
    await as(O.user, biz, async (t) => {
      const p = await products.createProduct(t, { name: "Router", costPrice: "800", sellingPrice: "1500", taxRate: 18, openingStock: "5" });
      const inv = await documents.finalizeDocument(t, (await documents.createDocument(t, { docType: "invoice", partyId: cust, issueDate: t.today, items: [{ productId: p.id as string, description: "Router", quantity: "3", unit: "pcs", unitPrice: "1500", taxRate: 18 }] })).id as string);
      expect(await stockOf(t, p.id as string)).toBe(2);
      expect(inv.grandTotal).toBe("5310.00");
      const cnDraft = await documents.convertDocument(t, inv.id as string, "credit_note");
      // Return only 1 of 3.
      const items = (cnDraft.items as Array<Record<string, unknown>>).map((i) => ({ productId: i.productId as string, description: i.description as string, quantity: "1", unit: "pcs", unitPrice: i.unitPrice as string, taxRate: Number(i.taxRate), sourceItemId: i.sourceItemId as string }));
      await documents.updateDocument(t, cnDraft.id as string, { docType: "credit_note", partyId: cust, issueDate: t.today, items, sourceDocumentId: inv.id as string });
      const cn = await documents.finalizeDocument(t, cnDraft.id as string);
      expect(cn.number).toMatch(/^CN\//);
      expect(cn.grandTotal).toBe("1770.00");
      expect(await stockOf(t, p.id as string)).toBe(3);
      const after = await documents.getDocument(t, inv.id as string);
      expect(after.balanceDue).toBe("3540.00");
      expect(after.status).toBe("partially_paid");
      expect((await parties.getParty(t, cust)).balance).toBe("3540.00");

      // Returning more than sold is refused.
      const cn2 = await documents.convertDocument(t, inv.id as string, "credit_note");
      const tooMany = (cn2.items as Array<Record<string, unknown>>).map((i) => ({ productId: i.productId as string, description: "Router", quantity: "3", unit: "pcs", unitPrice: "1500", taxRate: 18, sourceItemId: i.sourceItemId as string }));
      await documents.updateDocument(t, cn2.id as string, { docType: "credit_note", partyId: cust, issueDate: t.today, items: tooMany, sourceDocumentId: inv.id as string });
      await expectCode(documents.finalizeDocument(t, cn2.id as string), "BUSINESS_RULE");
    });
  });

  it("cancelling an invoice reverses stock; invoices with payments cannot be cancelled", async () => {
    await as(O.user, biz, async (t) => {
      const p = await products.createProduct(t, { name: "Switch 8 port", costPrice: "500", sellingPrice: "900", taxRate: 18, openingStock: "4" });
      const inv = await documents.finalizeDocument(t, (await documents.createDocument(t, { docType: "invoice", partyId: cust, issueDate: t.today, items: [{ productId: p.id as string, description: "Switch", quantity: "2", unit: "pcs", unitPrice: "900", taxRate: 18 }] })).id as string);
      expect(await stockOf(t, p.id as string)).toBe(2);
      const pay = await payments.recordPayment(t, { direction: "in", partyId: cust, amount: "100", method: "cash", paidOn: t.today, allocations: [{ documentId: inv.id as string, amount: "100" }] });
      await expectCode(documents.cancelDocument(t, inv.id as string, { reason: "Customer changed mind" }), "BUSINESS_RULE");
      await payments.voidPayment(t, pay.id as string, "Refunded in cash");
      const c = await documents.cancelDocument(t, inv.id as string, { reason: "Customer changed mind" });
      expect(c.status).toBe("cancelled");
      expect(await stockOf(t, p.id as string)).toBe(4);
      await expectCode(documents.cancelDocument(t, inv.id as string, { reason: "again" }), "CONFLICT");
      // Number is kept (no gaps, no reuse).
      expect(c.number).toBe(inv.number);
    });
  });
});

describe("serial numbers and warranty", () => {
  it("tracks serials through purchase, sale and warranty", async () => {
    await as(O.user, biz, async (t) => {
      const p = await products.createProduct(t, { name: "Laptop i5", costPrice: "0", sellingPrice: "52000", taxRate: 18, trackSerials: true, warrantyMonths: 12 });
      const bill = await documents.createDocument(t, { docType: "purchase_bill", partyId: sup, issueDate: t.today, items: [{ productId: p.id as string, description: "Laptop i5", quantity: "2", unit: "pcs", unitPrice: "45000", taxRate: 18, serialNumbers: ["SN-A1", "SN-A2"] }] });
      const fb = await documents.finalizeDocument(t, bill.id as string);
      // Supplier in Delhi (07), business in Tamil Nadu (33) → IGST.
      expect(fb.isInterState).toBe(true);
      expect(fb.igstTotal).toBe("16200.00");
      expect(await stockOf(t, p.id as string)).toBe(2);

      return p.id as string;
    }).then(async (pid) => {
      const mk = (serials?: string[]) =>
        as(O.user, biz, async (t) => (await documents.createDocument(t, { docType: "invoice", partyId: cust, issueDate: t.today, items: [{ productId: pid, description: "Laptop", quantity: "1", unit: "pcs", unitPrice: "52000", taxRate: 18, serialNumbers: serials }] })).id as string);
      const wrongCount = await mk();
      await expectCode(as(O.user, biz, (t) => documents.finalizeDocument(t, wrongCount)), "VALIDATION");
      const unknown = await mk(["NOPE"]);
      await expectCode(as(O.user, biz, (t) => documents.finalizeDocument(t, unknown)), "BUSINESS_RULE");
      const ok = await mk(["sn-a1"]);
      await as(O.user, biz, (t) => documents.finalizeDocument(t, ok));
    });
    await owner(async (c) => {
      const r = await c.query("select status, warranty_until, sold_on from product_serials where business_id = $1 and serial_number = 'SN-A1'", [biz]);
      expect(r.rows[0].status).toBe("sold");
      expect(r.rows[0].warranty_until > r.rows[0].sold_on).toBe(true);
    });
    await as(O.user, biz, async (t) => {
      const found = await products.findByBarcode(t, "SN-A1");
      expect(found.name).toBe("Laptop i5");
    });
  });
});

describe("approvals for high discounts", () => {
  it("salesperson needs owner approval above the threshold; approval is single-use", async () => {
    await as(O.user, biz, (t) => businesses.updateSettings(t, { discountApprovalPercent: 10 }));
    const sp = await addMember(biz, "salesperson", "Sales Sam");
    const draftId = await as(sp.user, biz, async (t) => (await documents.createDocument(t, { docType: "invoice", partyId: cust, issueDate: t.today, items: [item({ unitPrice: "1000", discountType: "percent", discountValue: "25" })] })).id as string);
    const err = await expectCode(as(sp.user, biz, (t) => documents.finalizeDocument(t, draftId)), "APPROVAL_REQUIRED");
    // The approval request must persist even though finalisation failed → it is created in its own call.
    const approvalId = (err.details as { approvalId: string }).approvalId;
    expect(approvalId).toBeTruthy();
    const pending = await as(O.user, biz, (t) => approvals.listApprovals(t, "pending"));
    expect((pending as Array<{ id: string }>).some((a) => a.id === approvalId)).toBe(true);
    await expectCode(as(sp.user, biz, (t) => approvals.decideApproval(t, approvalId, true)), "FORBIDDEN");
    await as(O.user, biz, (t) => approvals.decideApproval(t, approvalId, true, "OK for this customer"));
    const fin = await as(sp.user, biz, (t) => documents.finalizeDocument(t, draftId, { approvalId }));
    expect(fin.status).toBe("issued");
    await as(O.user, biz, (t) => businesses.updateSettings(t, { discountApprovalPercent: null }));
  });
});

describe("document numbering under concurrency", () => {
  it("parallel finalisations get unique, gap-free numbers", async () => {
    const U2 = await newUser("Concurrency");
    const b2 = await newBusiness(U2.user);
    const c2 = await as(U2.user, b2, async (t) => (await parties.createParty(t, { name: "Parallel Co", billingAddress: { stateCode: "29" }, openingBalance: "0" })).id as string);
    const drafts = await Promise.all(Array.from({ length: 12 }, () => as(U2.user, b2, async (t) => (await documents.createDocument(t, { docType: "invoice", partyId: c2, issueDate: t.today, items: [item()] })).id as string)));
    const results = await Promise.all(drafts.map((id) => as(U2.user, b2, (t) => documents.finalizeDocument(t, id))));
    const seqs = results.map((r) => Number(String(r.number).split("/")[2])).sort((a, b) => a - b);
    expect(seqs).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
  });
});

describe("GST schemes", () => {
  it("unregistered businesses issue a Bill of Supply without tax", async () => {
    const U3 = await newUser("Small Shop");
    const b3 = await newBusiness(U3.user, {}, { gstScheme: "unregistered" });
    await as(U3.user, b3, async (t) => {
      const c = await parties.createParty(t, { name: "Neighbour", billingAddress: { stateCode: "29" }, openingBalance: "0" });
      const inv = await documents.finalizeDocument(t, (await documents.createDocument(t, { docType: "invoice", partyId: c.id as string, issueDate: t.today, items: [item({ unitPrice: "250", taxRate: 18 })] })).id as string);
      expect(inv.taxTotal).toBe("0.00");
      expect(inv.grandTotal).toBe("250.00");
    });
  });
  it("inter-state sales use IGST based on place of supply", async () => {
    await as(O.user, biz, async (t) => {
      const k = await parties.createParty(t, { name: "Kerala Buyer", billingAddress: { stateCode: "32" }, openingBalance: "0" });
      const d = await documents.createDocument(t, { docType: "invoice", partyId: k.id as string, issueDate: t.today, items: [item({ unitPrice: "1000" })] });
      expect(d.isInterState).toBe(true);
      expect(d.placeOfSupply).toBe("32");
      expect(d.igstTotal).toBe("180.00");
      expect(d.cgstTotal).toBe("0.00");
    });
  });
});

describe("purchase orders, goods receipt and supplier payments", () => {
  it("a PO tracks partial and full receipt; stock moves only on receipt", async () => {
    await as(O.user, biz, async (t) => {
      const p = await products.createProduct(t, { name: "Cat6 cable box", costPrice: "0", sellingPrice: "9000", taxRate: 18 });
      const po = await documents.finalizeDocument(t, (await documents.createDocument(t, { docType: "purchase_order", partyId: sup, issueDate: t.today, items: [{ productId: p.id as string, description: "Cat6 305m", quantity: "10", unit: "box", unitPrice: "6000", taxRate: 18 }] })).id as string);
      expect(await stockOf(t, p.id as string)).toBe(0);
      const bill1 = await documents.convertDocument(t, po.id as string, "purchase_bill");
      const its = (bill1.items as Array<Record<string, unknown>>).map((i) => ({ productId: i.productId as string, description: i.description as string, quantity: "4", unit: "box", unitPrice: "6000", taxRate: 18, sourceItemId: i.sourceItemId as string }));
      await documents.updateDocument(t, bill1.id as string, { docType: "purchase_bill", partyId: sup, issueDate: t.today, items: its, sourceDocumentId: po.id as string });
      const fb1 = await documents.finalizeDocument(t, bill1.id as string);
      expect(await stockOf(t, p.id as string)).toBe(4);
      expect((await documents.getDocument(t, po.id as string)).status).toBe("partially_received");
      const bill2 = await documents.convertDocument(t, po.id as string, "purchase_bill", { finalize: true });
      expect((bill2.items as Array<{ quantity: string }>)[0]!.quantity).toBe("6.000");
      expect(await stockOf(t, p.id as string)).toBe(10);
      expect((await documents.getDocument(t, po.id as string)).status).toBe("received");
      const pay = await payments.recordPayment(t, { direction: "out", partyId: sup, amount: fb1.grandTotal as string, method: "bank_transfer", paidOn: t.today }, { autoAllocate: true });
      expect((pay.allocations as unknown[]).length).toBeGreaterThan(0);
    });
  });
});

describe("branches and stock transfers", () => {
  it("moves stock between branches without changing the total", async () => {
    await as(O.user, biz, async (t) => {
      const b2 = await team.saveBranch(t, null, { name: "Madurai", stateCode: "33", address: { city: "Madurai" } });
      const p = await products.createProduct(t, { name: "UPS 1kVA", costPrice: "3500", sellingPrice: "5000", taxRate: 18, openingStock: "6" });
      await products.transferStock(t, { productId: p.id as string, fromBranchId: t.defaultBranchId, toBranchId: b2.id, quantity: "2" });
      const prod = await products.getProduct(t, p.id as string);
      const byBranch = Object.fromEntries((prod.stock as Array<{ branchId: string; quantity: string }>).map((s) => [s.branchId, Number(s.quantity)]));
      expect(byBranch[t.defaultBranchId]).toBe(4);
      expect(byBranch[b2.id]).toBe(2);
      await expectCode(products.transferStock(t, { productId: p.id as string, fromBranchId: b2.id, toBranchId: t.defaultBranchId, quantity: "3" }), "NEGATIVE_STOCK");
    });
  });
});

describe("service tickets and AMC", () => {
  it("consumes spare parts on completion and bills the ticket", async () => {
    const tech = await addMember(biz, "technician", "Tech Tom");
    const { ticketId, partId } = await as(O.user, biz, async (t) => {
      const part = await products.createProduct(t, { name: "SMPS 12V", costPrice: "250", sellingPrice: "450", taxRate: 18, openingStock: "3" });
      const tk = await service.createTicket(t, { partyId: cust, equipment: "CCTV DVR", issue: "No video on 2 channels", assignedTo: tech.user.id, serviceCharge: "500", priority: "high" });
      expect(tk.status).toBe("assigned");
      return { ticketId: tk.id as string, partId: part.id as string };
    });
    await as(tech.user, biz, async (t) => {
      const mine = await service.listTickets(t, {});
      expect(mine.items.map((i) => i.id)).toContain(ticketId);
      await service.addPart(t, ticketId, { productId: partId, quantity: "1", unitPrice: "450" });
      await service.updateTicket(t, ticketId, { status: "in_progress" });
      await service.updateTicket(t, ticketId, { status: "completed", resolution: "Replaced SMPS" });
      await expectCode(service.updateTicket(t, ticketId, { assignedTo: null }), "BUSINESS_RULE");
    });
    await as(O.user, biz, async (t) => {
      expect(await stockOf(t, partId)).toBe(2);
      const inv = await service.invoiceTicket(t, ticketId, true);
      expect(inv.status).toBe("issued");
      expect(inv.grandTotal).toBe("1121.00"); // (500 + 450) × 1.18 = 1121
      expect(await stockOf(t, partId)).toBe(2); // parts are not deducted twice
      await expectCode(service.invoiceTicket(t, ticketId), "CONFLICT");
    });
  });

  it("creates, renews and lists expiring AMC contracts", async () => {
    await as(O.user, biz, async (t) => {
      const start = t.today;
      const end = new Date(Date.parse(start) + 20 * 86400000).toISOString().slice(0, 10);
      const amc = await service.createAmc(t, { partyId: cust, title: "CCTV AMC — 16 cameras", startDate: start, endDate: end, amount: "12000", visitsIncluded: 4, reminderDaysBefore: 30 });
      const expiring = await service.listAmcs(t, { status: "expiring" });
      expect(expiring.items.map((a) => a.id)).toContain(amc.id);
      const renewed = await service.renewAmc(t, amc.id as string);
      expect(renewed.renewedFromId).toBe(amc.id);
      expect((await service.getAmc(t, amc.id as string)).status).toBe("renewed");
    });
  });
});

describe("daily jobs and notifications", () => {
  it("generates overdue and low-stock notifications idempotently and expires quotations", async () => {
    const qid = await as(O.user, biz, async (t) => {
      const p = await products.createProduct(t, { name: "Battery 7Ah", costPrice: "600", sellingPrice: "900", taxRate: 18, openingStock: "1", reorderLevel: "5" });
      void p;
      const inv = await documents.createDocument(t, { docType: "invoice", partyId: cust, issueDate: "2026-01-01", dueDate: "2026-01-15", items: [item({ unitPrice: "300" })] });
      await documents.finalizeDocument(t, inv.id as string);
      const q = await documents.createDocument(t, { docType: "quotation", partyId: cust, issueDate: "2026-01-01", validUntil: "2026-01-10", items: [item()] });
      return (await documents.finalizeDocument(t, q.id as string)).id as string;
    });
    const r1 = await runDailyJobs();
    expect(r1.expiredQuotations).toBeGreaterThanOrEqual(1);
    const r2 = await runDailyJobs();
    expect((r2 as Record<string, number>).notifications).toBe(0);
    await as(O.user, biz, async (t) => {
      const n = await notifications.listNotifications(t);
      const kinds = new Set((n.items as Array<{ kind: string }>).map((i) => i.kind));
      expect(kinds).toContain("overdue_invoice");
      expect(kinds).toContain("low_stock");
      expect((await documents.getDocument(t, qid)).status).toBe("expired");
      await notifications.markNotificationsRead(t, "all");
      expect((await notifications.listNotifications(t)).unread).toBe(0);
    });
  });
});

describe("CSV import, export, idempotency, duplicates", () => {
  it("previews errors without writing, then imports valid rows", async () => {
    const U4 = await newUser("Importer");
    const b4 = await newBusiness(U4.user);
    await as(U4.user, b4, async (t) => {
      const bad = "name,type,phone,gstin\nGood Co,customer,9876500001,\n,customer,123,\nBad GST,customer,,29ABCDE1234F1Z0\n";
      const pv = await parties.previewPartyImport(t, bad);
      expect(pv.valid).toBe(1);
      expect(pv.invalid).toBe(2);
      await expectCode(parties.commitPartyImport(t, bad), "VALIDATION");
      expect((await parties.listParties(t, {})).total).toBe(0);
      const good = "name,type,phone,city,state_code,opening_balance\nGood Co,customer,9876500001,Hubli,29,1500\nSupplier X,supplier,9876500002,Pune,27,-200\n";
      expect((await parties.commitPartyImport(t, good)).imported).toBe(2);
      const list = await parties.listParties(t, {});
      expect(list.total).toBe(2);
      const prodCsv = "name,sku,category,cost_price,selling_price,gst_rate,opening_stock\nMouse,MS-1,Accessories,150,299,18,25\nKeyboard,KB-1,Accessories,300,599,18,10\n";
      const pp = await products.previewProductImport(t, prodCsv);
      expect(pp.invalid).toBe(0);
      expect((await products.commitProductImport(t, prodCsv)).imported).toBe(2);
      const dup = await products.previewProductImport(t, "name,sku\nMouse again,MS-1\n");
      expect(dup.invalid).toBe(1);
      const csv = await parties.exportPartiesCSV(t);
      expect(csv.split("\r\n")[0]).toContain("name,type,phone");
      expect(csv).toContain("Good Co");
    });
  });

  it("warns about duplicate customers and expenses", async () => {
    await as(O.user, biz, async (t) => {
      await parties.createParty(t, { name: "Unique Phone Co", phone: "9123456780", billingAddress: { stateCode: "33" }, openingBalance: "0" });
      const e = await expectCode(parties.createParty(t, { name: "Another Name", phone: "+91 91234 56780", billingAddress: { stateCode: "33" }, openingBalance: "0" }), "POSSIBLE_DUPLICATE");
      expect((e.details as { duplicates: Array<{ reason: string }> }).duplicates[0]!.reason).toBe("Same phone number");
      const cats = (await finance.listExpenseCategories(t)) as Array<{ id: string }>;
      await finance.recordExpense(t, { categoryId: cats[0]!.id, amount: "999", expenseDate: t.today, method: "cash" });
      await expectCode(finance.recordExpense(t, { categoryId: cats[0]!.id, amount: "999", expenseDate: t.today, method: "cash" }), "POSSIBLE_DUPLICATE");
      const ok = await finance.recordExpense(t, { categoryId: cats[0]!.id, amount: "999", expenseDate: t.today, method: "cash", confirmDuplicate: true });
      expect(ok.number).toMatch(/^EXP\//);
    });
  });

  it("replays an idempotent request instead of creating a duplicate", async () => {
    const body = { direction: "in" as const, partyId: cust, amount: "50", method: "cash" as const, paidOn: "2026-10-01" };
    const r1 = await as(O.user, biz, (t) => idempotent(t, "retry-key-0001", body, () => payments.recordPayment(t, body)));
    const r2 = await as(O.user, biz, (t) => idempotent(t, "retry-key-0001", body, () => payments.recordPayment(t, body)));
    expect(r2.id).toBe(r1.id);
    await expectCode(as(O.user, biz, (t) => idempotent(t, "retry-key-0001", { ...body, amount: "60" }, () => payments.recordPayment(t, { ...body, amount: "60" }))), "CONFLICT");
  });

  it("full data export contains only this business's rows", async () => {
    const other = await newUser("Other");
    const ob = await newBusiness(other.user, { name: "Other Biz" });
    await as(other.user, ob, (t) => parties.createParty(t, { name: "SECRET-OTHER-TENANT", billingAddress: { stateCode: "29" }, openingBalance: "0" }));
    const { zip } = await as(O.user, biz, (t) => exportsSvc.exportBusinessData(t));
    const z = await JSZip.loadAsync(zip);
    const csv = await z.file("customers_suppliers.csv")!.async("string");
    expect(csv).toContain("Chennai Clinic");
    expect(csv).not.toContain("SECRET-OTHER-TENANT");
    const manifest = JSON.parse(await z.file("manifest.json")!.async("string"));
    expect(manifest.business.id).toBe(biz);
  });
});

describe("every report runs", () => {
  it("returns data for all report types and date presets", async () => {
    const { reports, products: prod, payments: pay } = await import("../src");
    await as(O.user, biz, async (t) => {
      for (const preset of ["today", "week", "month", "last_month", "fy", "last_fy"]) {
        const r = reports.resolveRange(t, { preset });
        await reports.profitAndLoss(t, r);
        await reports.salesSummary(t, r, "day");
        await reports.salesSummary(t, r, "month");
        await reports.productProfitability(t, r);
        await reports.partyPerformance(t, r, "customer");
        await reports.partyPerformance(t, r, "supplier");
        await reports.gstSummary(t, r);
        await reports.employeePerformance(t, r);
        await reports.branchPerformance(t, r);
        await reports.expenseReport(t, r);
        await reports.cashFlow(t, r);
        await reports.dashboard(t, r);
      }
      await prod.stockValuation(t);
      await pay.outstandingReport(t, "receivable");
      await pay.outstandingReport(t, "payable");
      const cust = await reports.partyPerformance(t, { from: "2020-01-01", to: "2030-12-31" }, "customer");
      expect((cust as Array<{ name: string }>).some((c) => c.name === "Chennai Clinic")).toBe(true);
    });
  });
});
