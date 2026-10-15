/**
 * Creates a demo account with a fictional CCTV & computer shop and a few
 * months of realistic (but entirely made-up) activity. Never use real
 * customer data for demos.
 *
 *   DATABASE_URL=... DEMO_PASSWORD=... pnpm db:seed
 */
import { addDays, istDate } from "@cba/core";
import { auth, businesses, parties, products, documents, payments, finance, service, withTenant, closePools, appTx, type Tenant } from "../src";

const email = process.env.DEMO_EMAIL ?? "demo@crazybusiness.example";
const password = process.env.DEMO_PASSWORD ?? "DemoPassw0rd2026";
const meta = { ip: "127.0.0.1", userAgent: "seed" };
const today = istDate();

async function main() {
  const exists = await appTx({}, (db) => db.maybe("select 1 from users where email = $1", [email]));
  if (exists) {
    console.log(`Demo user ${email} already exists — nothing to do.`);
    return;
  }
  const { user } = await auth.register({ fullName: "Rohan Sharma (Demo)", email, password, phone: "9000000001", acceptTerms: true }, meta);
  const { id: biz } = await businesses.createBusiness(
    user,
    {
      name: "Sharma CCTV & Computers (Demo)",
      legalName: "Sharma Tech Solutions (fictional)",
      businessType: "cctv",
      // Structurally valid but fictional GSTIN (checksum correct, not registered).
      gstin: "27AAACZ9999Z1ZC",
      phone: "9000000001",
      email: "shop@sharma-demo.example",
      address: { line1: "12, MG Road", line2: "Near Clock Tower", city: "Pune", stateCode: "27", pincode: "411001" },
      stateCode: "27",
    },
    {
      invoiceTerms: "1. Goods once sold will not be taken back.\n2. Warranty as per manufacturer terms.\n3. Interest @18% p.a. on overdue bills.",
      quotationTerms: "Prices valid for 15 days. Installation extra unless mentioned.",
      bankName: "Demo Bank",
      bankAccountName: "Sharma Tech Solutions",
      bankAccountNumber: "000123456789",
      bankIfsc: "DEMO0001234",
      upiId: "sharmademo@upi",
      discountApprovalPercent: 15,
    },
  );
  const run = <T>(fn: (t: Tenant) => Promise<T>) => withTenant(user, biz, meta, fn);

  const customers = await run(async (t) => {
    const list = [
      ["Kulkarni Hospital (fictional)", "27", "Pune", "9000000101"],
      ["Green Valley School (fictional)", "27", "Pune", "9000000102"],
      ["Patil Jewellers (fictional)", "27", "Nashik", "9000000103"],
      ["Om Sai Apartments Society (fictional)", "27", "Pune", "9000000104"],
      ["Desai & Co. Chartered Accountants (fictional)", "27", "Mumbai", "9000000105"],
      ["Goa Beach Resort (fictional)", "30", "Panaji", "9000000106"],
      ["Walk-in customer", "27", "Pune", null],
    ] as const;
    const ids: string[] = [];
    for (const [name, st, city, phone] of list) {
      ids.push((await parties.createParty(t, { name, phone, billingAddress: { stateCode: st, city }, openingBalance: "0", paymentTermsDays: name.startsWith("Walk") ? 0 : 15, confirmDuplicate: true })).id as string);
    }
    return ids;
  });
  const suppliers = await run(async (t) => {
    const ids: string[] = [];
    for (const [name, st, city] of [["Vision Security Distributors (fictional)", "27", "Mumbai"], ["Bengaluru IT Wholesale (fictional)", "29", "Bengaluru"], ["Cable World Traders (fictional)", "27", "Pune"]] as const) {
      ids.push((await parties.createParty(t, { name, isCustomer: false, isSupplier: true, billingAddress: { stateCode: st, city }, openingBalance: "0" })).id as string);
    }
    return ids;
  });

  const catalog: Array<{ name: string; sku: string; cost: string; price: string; hsn: string; rate: number; unit?: string; serial?: boolean; service?: boolean; reorder?: string; warranty?: number }> = [
    { name: "2MP Dome Camera", sku: "CAM-D2", cost: "1150", price: "1850", hsn: "85258900", rate: 18, reorder: "10", warranty: 12 },
    { name: "2MP Bullet Camera", sku: "CAM-B2", cost: "1250", price: "1990", hsn: "85258900", rate: 18, reorder: "10", warranty: 12 },
    { name: "5MP IP Camera", sku: "CAM-IP5", cost: "3200", price: "4800", hsn: "85258900", rate: 18, reorder: "5", warranty: 24 },
    { name: "8 Channel DVR", sku: "DVR-8", cost: "3600", price: "5400", hsn: "85219090", rate: 18, serial: true, reorder: "3", warranty: 24 },
    { name: "16 Channel NVR", sku: "NVR-16", cost: "7800", price: "11500", hsn: "85219090", rate: 18, serial: true, reorder: "2", warranty: 24 },
    { name: "1TB Surveillance HDD", sku: "HDD-1T", cost: "3100", price: "4200", hsn: "84717020", rate: 18, reorder: "5", warranty: 36 },
    { name: "CCTV Cable 3+1 (90 m)", sku: "CBL-90", cost: "950", price: "1450", hsn: "85444999", rate: 18, unit: "roll", reorder: "8" },
    { name: "SMPS 12V 10A", sku: "SMPS-10", cost: "420", price: "750", hsn: "85044090", rate: 18, reorder: "6" },
    { name: "BNC Connector", sku: "BNC", cost: "6", price: "15", hsn: "85369090", rate: 18, unit: "pcs", reorder: "100" },
    { name: "Business Laptop i5 16GB", sku: "LAP-I5", cost: "46500", price: "54990", hsn: "84713010", rate: 18, serial: true, reorder: "1", warranty: 12 },
    { name: "Wireless Mouse", sku: "MS-WL", cost: "260", price: "499", hsn: "84716060", rate: 18, reorder: "10" },
    { name: "Installation charges (per camera)", sku: "SRV-INST", cost: "0", price: "500", hsn: "998719", rate: 18, service: true },
    { name: "Annual maintenance visit", sku: "SRV-AMC", cost: "0", price: "1500", hsn: "998719", rate: 18, service: true },
  ];
  const pid: Record<string, string> = {};
  await run(async (t) => {
    for (const c of catalog) {
      const p = await products.createProduct(t, {
        name: c.name, sku: c.sku, costPrice: c.cost, sellingPrice: c.price, hsnCode: c.hsn, taxRate: c.rate, unit: c.unit ?? (c.service ? "job" : "pcs"),
        type: c.service ? "service" : "goods", trackSerials: !!c.serial, reorderLevel: c.reorder ?? "0", warrantyMonths: c.warranty ?? null, brand: c.service ? null : "DemoBrand",
      });
      pid[c.sku] = p.id as string;
    }
  });

  // Purchases 75 days ago (stock in).
  let serialNo = 1000;
  const serials = (n: number, prefix: string) => Array.from({ length: n }, () => `${prefix}${serialNo++}`);
  await run(async (t) => {
    const bills: Array<[number, string, Array<[string, string, string?]>]> = [
      [0, addDays(today, -75), [["CAM-D2", "40"], ["CAM-B2", "40"], ["CAM-IP5", "12"], ["DVR-8", "8"], ["NVR-16", "3"], ["HDD-1T", "15"]]],
      [1, addDays(today, -70), [["LAP-I5", "4"], ["MS-WL", "30"]]],
      [2, addDays(today, -68), [["CBL-90", "25"], ["SMPS-10", "20"], ["BNC", "500"]]],
    ];
    for (const [s, date, lines] of bills) {
      const items = lines.map(([sku, q]) => {
        const c = catalog.find((x) => x.sku === sku)!;
        return { productId: pid[sku]!, description: c.name, hsnCode: c.hsn, quantity: q, unit: c.unit ?? "pcs", unitPrice: c.cost, taxRate: c.rate, serialNumbers: c.serial ? serials(Number(q), `${sku}-`) : [] };
      });
      const d = await documents.createDocument(t, { docType: "purchase_bill", partyId: suppliers[s]!, issueDate: date, supplierInvoiceNumber: `SUP-${1000 + s}`, items });
      const fb = await documents.finalizeDocument(t, d.id as string);
      await payments.recordPayment(t, { direction: "out", partyId: suppliers[s]!, amount: s === 0 ? "100000" : (fb.grandTotal as string), method: "bank_transfer", paidOn: addDays(date, 5), allocations: [{ documentId: fb.id as string, amount: s === 0 ? "100000" : (fb.grandTotal as string) }] });
    }
  });

  // Sales over the last 60 days.
  const serialPool: Record<string, string[]> = {};
  await appTx({ userId: user.id, businessId: biz }, async (db) => {
    const rows = await db.query<{ sku: string; serial_number: string }>("select p.sku, s.serial_number from product_serials s join products p on p.id = s.product_id where s.status = 'in_stock' order by s.serial_number");
    for (const r of rows) (serialPool[r.sku] ??= []).push(r.serial_number);
  });
  const sales: Array<[number, number, Array<[string, string]>, number?]> = [
    [0, 58, [["CAM-D2", "8"], ["DVR-8", "1"], ["HDD-1T", "1"], ["CBL-90", "2"], ["SRV-INST", "8"]], 1],
    [1, 50, [["CAM-B2", "12"], ["NVR-16", "1"], ["HDD-1T", "2"], ["CBL-90", "3"], ["SRV-INST", "12"]], 0.5],
    [2, 41, [["CAM-IP5", "4"], ["NVR-16", "1"], ["HDD-1T", "1"], ["SRV-INST", "4"]], 1],
    [4, 33, [["LAP-I5", "2"], ["MS-WL", "2"]], 1],
    [6, 25, [["CAM-D2", "2"], ["SMPS-10", "1"], ["BNC", "8"]], 1],
    [3, 18, [["CAM-B2", "6"], ["DVR-8", "1"], ["HDD-1T", "1"], ["CBL-90", "2"], ["SRV-INST", "6"]], 0],
    [5, 12, [["CAM-IP5", "6"], ["NVR-16", "1"], ["HDD-1T", "2"], ["SRV-INST", "6"]], 0.3],
    [6, 4, [["MS-WL", "3"]], 1],
    [0, 2, [["SRV-AMC", "1"], ["SMPS-10", "2"]], 0],
    [6, 0, [["CAM-D2", "1"], ["BNC", "4"]], 1],
  ];
  for (const [ci, daysAgo, lines, paidShare] of sales) {
    await run(async (t) => {
      const date = addDays(today, -daysAgo);
      const items = lines.map(([sku, q]) => {
        const c = catalog.find((x) => x.sku === sku)!;
        return { productId: pid[sku]!, description: c.name, hsnCode: c.hsn, quantity: q, unit: c.unit ?? (c.service ? "job" : "pcs"), unitPrice: c.price, taxRate: c.rate, serialNumbers: c.serial ? (serialPool[sku] ?? []).splice(0, Number(q)) : [] };
      });
      const d = await documents.createDocument(t, { docType: "invoice", partyId: customers[ci]!, issueDate: date, items, documentDiscountType: ci === 1 ? "percent" : null, documentDiscountValue: ci === 1 ? "5" : null });
      const inv = await documents.finalizeDocument(t, d.id as string);
      if (paidShare && paidShare > 0) {
        const amt = (Math.round(Number(inv.grandTotal) * paidShare * 100) / 100).toFixed(2);
        await payments.recordPayment(t, { direction: "in", partyId: customers[ci]!, amount: amt, method: ci % 2 ? "upi" : "bank_transfer", paidOn: addDays(date, Math.min(daysAgo, 3)), allocations: [{ documentId: inv.id as string, amount: amt }] });
      }
    });
  }

  // Quotations in different states.
  await run(async (t) => {
    const q1 = await documents.createDocument(t, { docType: "quotation", partyId: customers[3]!, issueDate: addDays(today, -6), items: [{ productId: pid["CAM-IP5"]!, description: "5MP IP Camera", quantity: "16", unit: "pcs", unitPrice: "4800", taxRate: 18 }, { productId: pid["NVR-16"]!, description: "16 Channel NVR", quantity: "1", unit: "pcs", unitPrice: "11500", taxRate: 18 }, { productId: pid["SRV-INST"]!, description: "Installation charges (per camera)", quantity: "16", unit: "job", unitPrice: "500", taxRate: 18 }] });
    await documents.finalizeDocument(t, q1.id as string);
    const q2 = await documents.createDocument(t, { docType: "quotation", partyId: customers[5]!, issueDate: addDays(today, -2), items: [{ productId: pid["CAM-D2"]!, description: "2MP Dome Camera", quantity: "24", unit: "pcs", unitPrice: "1800", taxRate: 18 }] });
    await documents.finalizeDocument(t, q2.id as string);
    await documents.createDocument(t, { docType: "quotation", partyId: customers[4]!, issueDate: today, items: [{ productId: pid["LAP-I5"]!, description: "Business Laptop i5 16GB", quantity: "3", unit: "pcs", unitPrice: "54990", taxRate: 18 }] });
  });

  // Expenses.
  await run(async (t) => {
    const cats = (await finance.listExpenseCategories(t)) as Array<{ id: string; name: string }>;
    const cat = (n: string) => cats.find((c) => c.name === n)!.id;
    for (const m of [60, 30, 0]) {
      await finance.recordExpense(t, { categoryId: cat("Rent"), amount: "18000", expenseDate: addDays(today, -m), method: "bank_transfer", notes: "Shop rent (demo)", confirmDuplicate: true });
      await finance.recordExpense(t, { categoryId: cat("Electricity"), amount: String(2100 + m * 10), expenseDate: addDays(today, -m), method: "upi", confirmDuplicate: true });
      await finance.recordExpense(t, { categoryId: cat("Salaries & wages"), amount: "24000", expenseDate: addDays(today, -m), method: "bank_transfer", notes: "Technician salary (demo)", confirmDuplicate: true });
    }
    await finance.recordExpense(t, { categoryId: cat("Transport & fuel"), amount: "1250", expenseDate: addDays(today, -3), method: "cash" });
    await finance.recordExpense(t, { categoryId: cat("Marketing"), amount: "3500", taxAmount: "533.90", expenseDate: addDays(today, -9), method: "card", notes: "Local newspaper ad (demo)" });
  });

  // Service desk + AMC.
  await run(async (t) => {
    const amc = await service.createAmc(t, { partyId: customers[0]!, title: "CCTV AMC — 8 cameras + DVR", startDate: addDays(today, -340), endDate: addDays(today, 25), amount: "9000", visitsIncluded: 4, reminderDaysBefore: 30 });
    await service.createTicket(t, { partyId: customers[0]!, equipment: "8CH DVR", issue: "Camera 3 shows no video since yesterday", priority: "high", amcContractId: amc.id as string });
    const tk = await service.createTicket(t, { partyId: customers[1]!, equipment: "NVR + 12 cameras", issue: "Remote viewing app not connecting", priority: "normal", serviceCharge: "800" });
    await service.updateTicket(t, tk.id as string, { status: "in_progress", note: "Router port forwarding to be checked" });
    await parties.addInteraction(t, customers[3]!, { kind: "visit", notes: "Site survey done for 16 IP cameras. Waiting for committee approval.", followUpOn: addDays(today, 2) });
    await parties.addInteraction(t, customers[5]!, { kind: "call", notes: "Asked for revised quote with 4MP option", followUpOn: today });
  });

  console.log(`Demo ready. Sign in with ${email} / ${password}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => closePools());
