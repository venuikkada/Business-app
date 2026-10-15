import "server-only";
import { reports, payments, products, pdfs, type Tenant } from "@cba/server";
import { toCSV, formatDateIN } from "@cba/core";
import { fileResponse } from "./router";

type Row = Record<string, unknown>;
export interface Column {
  key: string;
  label: string;
  money?: boolean;
  align?: "left" | "right";
}
export interface ReportDef {
  title: string;
  description: string;
  group: "Financial" | "Sales" | "Purchases" | "Inventory" | "Tax" | "Team";
  needsRange: boolean;
  advanced?: boolean;
  load: (t: Tenant, r: reports.Range, q: Record<string, string>) => Promise<unknown>;
  table: (data: unknown) => { columns: Column[]; rows: Row[]; totals?: Row; notes?: string[] };
}

const m = (key: string, label: string): Column => ({ key, label, money: true, align: "right" });
const c = (key: string, label: string): Column => ({ key, label });
const n = (key: string, label: string): Column => ({ key, label, align: "right" });

export const REPORTS: Record<string, ReportDef> = {
  pnl: {
    title: "Profit & loss (estimate)",
    description: "Revenue, cost of goods sold, gross profit, expenses and net profit for the period.",
    group: "Financial",
    needsRange: true,
    load: (t, r) => reports.profitAndLoss(t, r),
    table: (d) => {
      const p = d as Awaited<ReturnType<typeof reports.profitAndLoss>>;
      const rows: Row[] = [
        { line: "Sales invoiced (excl. GST)", amount: p.revenue.invoiced },
        { line: "Less: sales returns (credit notes)", amount: `-${p.revenue.returns}` },
        { line: "Net revenue", amount: p.revenue.net },
        { line: "Less: cost of goods sold (estimate)", amount: `-${p.costOfGoodsSold}` },
        { line: "Gross profit (estimate)", amount: p.grossProfitEstimate },
        ...p.expenses.byCategory.map((e) => ({ line: `Less: ${e.category}`, amount: `-${e.amount}` })),
        { line: "Less: non-stock purchases", amount: `-${p.nonStockPurchases}` },
      ];
      return { columns: [c("line", "Particulars"), m("amount", "Amount (₹)")], rows, totals: { line: "Net profit (estimate)", amount: p.netProfitEstimate }, notes: [...p.notes, `Cash collected in period: ₹${p.cash.collected}; GST collected (liability): ₹${p.outputGstCollected}`] };
    },
  },
  sales: {
    title: "Sales & purchases by period",
    description: "Invoiced sales, returns, purchases and cash collected per day or month.",
    group: "Sales",
    needsRange: true,
    load: (t, r, q) => reports.salesSummary(t, r, q.groupBy === "month" ? "month" : "day"),
    table: (d) => {
      const rows = d as Row[];
      const sum = (k: string) => rows.reduce((a, x) => a + Number(x[k] ?? 0), 0).toFixed(2);
      return {
        columns: [c("period", "Period"), n("invoices", "Invoices"), m("sales", "Sales (₹)"), m("returns", "Returns (₹)"), m("purchases", "Purchases (₹)"), m("collected", "Collected (₹)")],
        rows,
        totals: { period: "Total", invoices: rows.reduce((a, x) => a + Number(x.invoices ?? 0), 0), sales: sum("sales"), returns: sum("returns"), purchases: sum("purchases"), collected: sum("collected") },
      };
    },
  },
  products: {
    title: "Product profitability & best sellers",
    description: "Quantity sold, revenue, estimated cost and margin per product.",
    group: "Sales",
    needsRange: true,
    load: (t, r) => reports.productProfitability(t, r, 500),
    table: (d) => {
      const rows = d as Row[];
      const fin = rows.length > 0 && "grossProfit" in rows[0]!;
      return { columns: [c("name", "Product"), c("sku", "SKU"), n("quantity", "Qty sold"), m("revenue", "Revenue (₹)"), ...(fin ? [m("cost", "Cost (₹)"), m("grossProfit", "Gross profit (₹)"), n("marginPercent", "Margin %")] : [])], rows };
    },
  },
  customers: {
    title: "Customer performance",
    description: "Sales, invoices and outstanding per customer.",
    group: "Sales",
    needsRange: true,
    load: (t, r) => reports.partyPerformance(t, r, "customer"),
    table: (d) => ({ columns: [c("name", "Customer"), c("phone", "Phone"), n("documents", "Invoices"), m("total", "Net sales (₹)"), m("outstanding", "Outstanding (₹)"), c("lastDate", "Last invoice")], rows: (d as Row[]).map((x) => ({ ...x, lastDate: formatDateIN(x.lastDate as string) })) }),
  },
  suppliers: {
    title: "Supplier report",
    description: "Purchases and payables per supplier.",
    group: "Purchases",
    needsRange: true,
    load: (t, r) => reports.partyPerformance(t, r, "supplier"),
    table: (d) => ({ columns: [c("name", "Supplier"), c("phone", "Phone"), n("documents", "Bills"), m("total", "Net purchases (₹)"), m("outstanding", "Payable (₹)"), c("lastDate", "Last bill")], rows: (d as Row[]).map((x) => ({ ...x, lastDate: formatDateIN(x.lastDate as string) })) }),
  },
  outstanding: {
    title: "Outstanding & aging",
    description: "Unpaid invoices grouped by how long they are overdue.",
    group: "Financial",
    needsRange: false,
    load: (t, _r, q) => payments.outstandingReport(t, q.side === "payable" ? "payable" : "receivable"),
    table: (d) => {
      const o = d as Awaited<ReturnType<typeof payments.outstandingReport>>;
      return {
        columns: [c("partyName", o.side === "receivable" ? "Customer" : "Supplier"), m("notDue", "Not due"), m("d1_30", "1–30 days"), m("d31_60", "31–60"), m("d61_90", "61–90"), m("d90Plus", "90+"), m("total", "Total (₹)")],
        rows: o.items as unknown as Row[],
        totals: { partyName: "Total", ...o.totals },
      };
    },
  },
  gst: {
    title: "GST summary",
    description: "Output and input GST by rate, B2B/B2C split and HSN summary from recorded transactions.",
    group: "Tax",
    needsRange: true,
    advanced: true,
    load: (t, r) => reports.gstSummary(t, r),
    table: (d) => {
      const g = d as Awaited<ReturnType<typeof reports.gstSummary>>;
      return {
        columns: [c("side", "Type"), n("taxRate", "GST %"), m("taxableValue", "Taxable (₹)"), m("cgst", "CGST"), m("sgst", "SGST"), m("igst", "IGST")],
        rows: g.rateWise as Row[],
        totals: { side: "Net GST payable (estimate)", taxRate: "", taxableValue: "", cgst: "", sgst: "", igst: g.netPayableEstimate },
        notes: [`Output tax ₹${g.outputTax}; input tax ₹${g.inputTax} (incl. ₹${g.inputTaxFromExpenses} on expenses)`, `B2B invoices: ${g.b2b.invoices} (taxable ₹${g.b2b.taxable}); B2C: ${g.b2c.invoices} (taxable ₹${g.b2c.taxable})`, g.disclaimer],
      };
    },
  },
  expenses: {
    title: "Expenses by category",
    description: "Where the money went.",
    group: "Financial",
    needsRange: true,
    load: (t, r) => reports.expenseReport(t, r),
    table: (d) => {
      const rows = d as Row[];
      return { columns: [c("category", "Category"), n("entries", "Entries"), m("gst", "GST (₹)"), m("amount", "Amount (₹)")], rows, totals: { category: "Total", entries: rows.reduce((a, x) => a + Number(x.entries), 0), gst: rows.reduce((a, x) => a + Number(x.gst), 0).toFixed(2), amount: rows.reduce((a, x) => a + Number(x.amount), 0).toFixed(2) } };
    },
  },
  cashflow: {
    title: "Cash flow",
    description: "Money in and out of cash and bank accounts per month (transfers excluded).",
    group: "Financial",
    needsRange: true,
    load: (t, r) => reports.cashFlow(t, r),
    table: (d) => ({ columns: [c("month", "Month"), m("inflow", "Inflow (₹)"), m("outflow", "Outflow (₹)"), m("net", "Net (₹)")], rows: d as Row[] }),
  },
  "stock-valuation": {
    title: "Stock valuation",
    description: "Quantity on hand valued at weighted average cost.",
    group: "Inventory",
    needsRange: false,
    load: (t) => products.stockValuation(t),
    table: (d) => {
      const v = d as Awaited<ReturnType<typeof products.stockValuation>>;
      return { columns: [c("name", "Product"), c("sku", "SKU"), c("categoryName", "Category"), n("quantity", "Qty"), m("avgCost", "Avg cost"), m("value", "Value (₹)"), m("retailValue", "At selling price (₹)")], rows: v.items as Row[], totals: { name: "Total", value: v.totalValue, retailValue: v.totalRetailValue } };
    },
  },
  employees: {
    title: "Employee performance",
    description: "Invoices, quotations won, collections and service tickets per team member.",
    group: "Team",
    needsRange: true,
    advanced: true,
    load: (t, r) => reports.employeePerformance(t, r),
    table: (d) => ({ columns: [c("fullName", "Employee"), n("invoices", "Invoices"), m("invoiced", "Invoiced (₹)"), n("quotations", "Quotes"), n("quotationsWon", "Won"), m("collected", "Collected (₹)"), n("ticketsCompleted", "Tickets done")], rows: d as Row[] }),
  },
  branches: {
    title: "Branch performance",
    description: "Sales and purchases per branch.",
    group: "Team",
    needsRange: true,
    advanced: true,
    load: (t, r) => reports.branchPerformance(t, r),
    table: (d) => ({ columns: [c("name", "Branch"), n("invoices", "Invoices"), m("sales", "Sales (₹)"), m("purchases", "Purchases (₹)")], rows: d as Row[] }),
  },
};

export async function renderReport(t: Tenant, def: ReportDef, data: unknown, range: reports.Range, format: "csv" | "pdf") {
  const tbl = def.table(data);
  const slug = def.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  await t.audit("report.export", "report", null, `${def.title} exported as ${format.toUpperCase()}`);
  if (format === "csv") {
    const rows = [...tbl.rows, ...(tbl.totals ? [tbl.totals] : [])];
    const csv = toCSV(tbl.columns.map((x) => x.label), rows.map((r) => tbl.columns.map((x) => r[x.key])));
    return fileResponse(Buffer.from(csv, "utf8"), "text/csv; charset=utf-8", `${slug}-${range.from}-to-${range.to}.csv`);
  }
  const pdf = await pdfs.reportPdf(t, { title: def.title, subtitle: def.needsRange ? `${formatDateIN(range.from)} – ${formatDateIN(range.to)}` : `As on ${formatDateIN(t.today)}`, columns: tbl.columns, rows: tbl.rows, totals: tbl.totals, notes: tbl.notes });
  return fileResponse(pdf, "application/pdf", `${slug}.pdf`, true);
}
