import { D, toCSV, dateRangeForPreset, addDays, type DateRangePreset } from "@cba/core";
import type { Tenant } from "../context";
import { AppError } from "../errors";
import { camelize } from "../util";

export interface Range {
  from: string;
  to: string;
}

export function resolveRange(t: Tenant, q: { from?: string; to?: string; preset?: string }): Range {
  if (q.from && q.to) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(q.from) || !/^\d{4}-\d{2}-\d{2}$/.test(q.to)) throw new AppError("VALIDATION", "Dates must be YYYY-MM-DD");
    if (q.from > q.to) throw new AppError("VALIDATION", "From date must be before To date");
    return { from: q.from, to: q.to };
  }
  return dateRangeForPreset((q.preset as DateRangePreset) ?? "month", t.today, t.business.fy_start_month);
}

function branchCond(t: Tenant, col = "d.branch_id") {
  return t.branchIds ? `${col} = any('{${t.branchIds.join(",")}}'::uuid[])` : "true";
}

const fmt = (v: unknown) => new D((v as string) ?? 0).toFixed(2);

/**
 * Profit & loss estimate for a period. Terminology is deliberate:
 * - revenue = taxable value of invoices less credit notes (excludes GST)
 * - cash collected = money actually received (payments in)
 * - gross profit (estimate) = revenue − cost of goods sold (weighted average cost at time of sale)
 * - net profit (estimate) = gross profit − expenses − non-stock purchases
 */
export async function profitAndLoss(t: Tenant, r: Range) {
  t.require("reports.view");
  t.require("financials.view");
  const s = await t.db.one<Record<string, string>>(
    `select
       coalesce(sum(taxable_total) filter (where doc_type = 'invoice'), 0) as sales,
       coalesce(sum(taxable_total) filter (where doc_type = 'credit_note'), 0) as returns,
       coalesce(sum(cost_total) filter (where doc_type = 'invoice'), 0) as cogs,
       coalesce(sum(cost_total) filter (where doc_type = 'credit_note'), 0) as cogs_returned,
       coalesce(sum(tax_total) filter (where doc_type = 'invoice'), 0) - coalesce(sum(tax_total) filter (where doc_type = 'credit_note'), 0) as output_tax,
       count(*) filter (where doc_type = 'invoice')::int as invoice_count
     from documents d where doc_type in ('invoice','credit_note') and status not in ('draft','cancelled')
       and issue_date between $1 and $2 and ${branchCond(t)}`,
    [r.from, r.to],
  );
  const nonStockPurchases = await t.db.one<{ v: string }>(
    `select coalesce(sum(case when d.doc_type = 'purchase_bill' then i.taxable_value else -i.taxable_value end), 0) as v
       from document_items i join documents d on d.id = i.document_id left join products p on p.id = i.product_id
      where d.doc_type in ('purchase_bill','debit_note') and d.status not in ('draft','cancelled') and d.issue_date between $1 and $2
        and (p.id is null or not p.track_inventory) and ${branchCond(t)}`,
    [r.from, r.to],
  );
  const exp = await t.db.query<{ category: string; amount: string }>(
    `select c.name as category, sum(e.amount - e.tax_amount) as amount from expenses e join expense_categories c on c.id = e.category_id
      where e.status = 'active' and e.expense_date between $1 and $2 and ${branchCond(t, "e.branch_id")} group by c.name order by 2 desc`,
    [r.from, r.to],
  );
  const cash = await t.db.one<{ cin: string; cout: string }>(
    `select coalesce(sum(amount) filter (where direction = 'in'), 0) cin, coalesce(sum(amount) filter (where direction = 'out'), 0) cout
       from payments where status = 'active' and paid_on between $1 and $2 and ${branchCond(t, "branch_id")}`,
    [r.from, r.to],
  );
  const revenue = new D(s.sales!).sub(s.returns!);
  const cogs = new D(s.cogs!).sub(s.cogs_returned!);
  const gross = revenue.sub(cogs);
  const expenses = exp.reduce((a, e) => a.add(e.amount), new D(0));
  const net = gross.sub(expenses).sub(nonStockPurchases.v);
  return {
    range: r,
    revenue: { invoiced: fmt(s.sales), returns: fmt(s.returns), net: revenue.toFixed(2), invoiceCount: s.invoice_count },
    costOfGoodsSold: cogs.toFixed(2),
    grossProfitEstimate: gross.toFixed(2),
    grossMarginPercent: revenue.isZero() ? "0.00" : gross.mul(100).div(revenue).toFixed(2),
    expenses: { total: expenses.toFixed(2), byCategory: exp.map((e) => ({ category: e.category, amount: fmt(e.amount) })) },
    nonStockPurchases: fmt(nonStockPurchases.v),
    netProfitEstimate: net.toFixed(2),
    outputGstCollected: fmt(s.output_tax),
    cash: { collected: fmt(cash.cin), paidOut: fmt(cash.cout) },
    notes: [
      "Revenue excludes GST. GST collected is a liability, not income.",
      "Cost of goods sold uses weighted average purchase cost at the time of each sale; it is an estimate.",
      "Cash collected can differ from revenue because of credit sales and advance payments.",
    ],
  };
}

export async function salesSummary(t: Tenant, r: Range, groupBy: "day" | "month" = "day", fromDashboard = false) {
  if (!fromDashboard) t.require("reports.view");
  const bucket = groupBy === "month" ? "to_char(issue_date, 'YYYY-MM')" : "to_char(issue_date, 'YYYY-MM-DD')";
  const rows = await t.db.query<Record<string, string>>(
    `select ${bucket} as period,
            coalesce(sum(case when doc_type = 'invoice' then grand_total else 0 end), 0) as sales,
            coalesce(sum(case when doc_type = 'credit_note' then grand_total else 0 end), 0) as returns,
            coalesce(sum(case when doc_type = 'purchase_bill' then grand_total else 0 end), 0) as purchases,
            count(*) filter (where doc_type = 'invoice')::int as invoices
       from documents d where doc_type in ('invoice','credit_note','purchase_bill') and status not in ('draft','cancelled')
        and issue_date between $1 and $2 and ${branchCond(t)} group by 1 order by 1`,
    [r.from, r.to],
  );
  const pay = await t.db.query<{ period: string; collected: string }>(
    `select ${groupBy === "month" ? "to_char(paid_on, 'YYYY-MM')" : "to_char(paid_on, 'YYYY-MM-DD')"} as period, sum(amount) as collected
       from payments where status = 'active' and direction = 'in' and paid_on between $1 and $2 and ${branchCond(t, "branch_id")} group by 1`,
    [r.from, r.to],
  );
  const pm = new Map(pay.map((p) => [p.period, p.collected]));
  // Include empty periods so charts do not draw misleading lines across gaps.
  const periods = new Set<string>();
  if (groupBy === "day") {
    for (let d = r.from; d <= r.to && periods.size < 400; d = addDays(d, 1)) periods.add(d);
  } else {
    for (let m = r.from.slice(0, 7); m <= r.to.slice(0, 7) && periods.size < 120; ) {
      periods.add(m);
      const [y, mo] = m.split("-").map(Number) as [number, number];
      m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
    }
  }
  for (const x of rows) periods.add(x.period!);
  for (const p of pay) periods.add(p.period);
  const byPeriod = new Map(rows.map((x) => [x.period!, x]));
  return [...periods].sort().map((p) => {
    const x = byPeriod.get(p);
    return { period: p, sales: fmt(x?.sales), returns: fmt(x?.returns), purchases: fmt(x?.purchases), invoices: Number(x?.invoices ?? 0), collected: fmt(pm.get(p)) };
  });
}

export async function productProfitability(t: Tenant, r: Range, limit = 100) {
  t.require("reports.view");
  const fin = t.can("financials.view");
  const rows = await t.db.query(
    `select coalesce(p.id::text, i.description) as key, p.id as product_id, coalesce(p.name, i.description) as name, p.sku,
            sum(case when d.doc_type = 'invoice' then i.quantity else -i.quantity end) as quantity,
            sum(case when d.doc_type = 'invoice' then i.taxable_value else -i.taxable_value end) as revenue,
            sum(case when d.doc_type = 'invoice' then coalesce(i.unit_cost, 0) * i.quantity else -coalesce(i.unit_cost, 0) * i.quantity end) as cost
       from document_items i join documents d on d.id = i.document_id left join products p on p.id = i.product_id
      where d.doc_type in ('invoice','credit_note') and d.status not in ('draft','cancelled') and d.issue_date between $1 and $2 and ${branchCond(t)}
      group by 1, 2, 3, 4 order by revenue desc limit $3`,
    [r.from, r.to, limit],
  );
  return camelize<Record<string, string>>(rows).map((x) => {
    const revenue = new D(x.revenue ?? 0);
    const cost = new D(x.cost ?? 0);
    const base = { productId: x.productId, name: x.name, sku: x.sku, quantity: new D(x.quantity ?? 0).toString(), revenue: revenue.toFixed(2) };
    if (!fin) return base;
    const profit = revenue.sub(cost);
    return { ...base, cost: cost.toFixed(2), grossProfit: profit.toFixed(2), marginPercent: revenue.isZero() ? "0.00" : profit.mul(100).div(revenue).toFixed(2) };
  });
}

export async function partyPerformance(t: Tenant, r: Range, side: "customer" | "supplier") {
  t.require("reports.view");
  const type = side === "customer" ? ["invoice", "credit_note"] : ["purchase_bill", "debit_note"];
  const rows = await t.db.query(
    `select pa.id as party_id, pa.name, pa.phone,
            count(*) filter (where d.doc_type = ($3::text[])[1])::int as documents,
            coalesce(sum(case when d.doc_type = ($3::text[])[1] then d.grand_total else -d.grand_total end), 0) as total,
            coalesce(sum(d.balance_due) filter (where d.doc_type = ($3::text[])[1] and d.status in ('issued','partially_paid')), 0) as outstanding,
            max(d.issue_date) as last_date
       from documents d join parties pa on pa.id = d.party_id
      where d.doc_type = any($3) and d.status not in ('draft','cancelled') and d.issue_date between $1 and $2 and ${branchCond(t)}
      group by pa.id order by total desc limit 200`,
    [r.from, r.to, type],
  );
  return camelize(rows);
}

/**
 * GST summary from recorded transactions — an aid for filing, not a filed
 * return. Output tax: invoices less credit notes. Input tax: purchase bills
 * less debit notes plus GST on expenses.
 */
export async function gstSummary(t: Tenant, r: Range) {
  t.require("reports.view");
  t.require("financials.view");
  t.requireFeature("advanced_reports");
  const rateWise = await t.db.query(
    `select case when d.doc_type in ('invoice','credit_note') then 'output' else 'input' end as side, i.tax_rate,
            sum(case when d.doc_type in ('invoice','purchase_bill') then i.taxable_value else -i.taxable_value end) as taxable_value,
            sum(case when d.doc_type in ('invoice','purchase_bill') then i.cgst else -i.cgst end) as cgst,
            sum(case when d.doc_type in ('invoice','purchase_bill') then i.sgst else -i.sgst end) as sgst,
            sum(case when d.doc_type in ('invoice','purchase_bill') then i.igst else -i.igst end) as igst
       from document_items i join documents d on d.id = i.document_id
      where d.doc_type in ('invoice','credit_note','purchase_bill','debit_note') and d.status not in ('draft','cancelled')
        and d.issue_date between $1 and $2 and ${branchCond(t)}
      group by 1, 2 order by 1, 2`,
    [r.from, r.to],
  );
  // Additional charges are taxed at document level.
  const charges = await t.db.query<Record<string, string>>(
    `select case when doc_type in ('invoice','credit_note') then 'output' else 'input' end as side, additional_charges_tax_rate as tax_rate,
            sum(case when doc_type in ('invoice','purchase_bill') then additional_charges else -additional_charges end) as taxable_value
       from documents d where additional_charges > 0 and doc_type in ('invoice','credit_note','purchase_bill','debit_note')
        and status not in ('draft','cancelled') and issue_date between $1 and $2 and ${branchCond(t)} group by 1, 2`,
    [r.from, r.to],
  );
  const docTotals = await t.db.one<Record<string, string>>(
    `select
       coalesce(sum(tax_total) filter (where doc_type = 'invoice'), 0) - coalesce(sum(tax_total) filter (where doc_type = 'credit_note'), 0) as output_tax,
       coalesce(sum(tax_total) filter (where doc_type = 'purchase_bill'), 0) - coalesce(sum(tax_total) filter (where doc_type = 'debit_note'), 0) as input_tax,
       coalesce(sum(taxable_total) filter (where doc_type = 'invoice' and party_gstin is not null), 0) as b2b_taxable,
       coalesce(sum(taxable_total) filter (where doc_type = 'invoice' and party_gstin is null), 0) as b2c_taxable,
       count(*) filter (where doc_type = 'invoice' and party_gstin is not null)::int as b2b_count,
       count(*) filter (where doc_type = 'invoice' and party_gstin is null)::int as b2c_count
     from documents d where status not in ('draft','cancelled') and issue_date between $1 and $2 and ${branchCond(t)}`,
    [r.from, r.to],
  );
  const expTax = await t.db.one<{ v: string }>(
    `select coalesce(sum(tax_amount), 0) v from expenses e where status = 'active' and expense_date between $1 and $2 and ${branchCond(t, "e.branch_id")}`,
    [r.from, r.to],
  );
  const hsn = await t.db.query(
    `select coalesce(i.hsn_code, '—') as hsn_code, i.tax_rate, sum(case when d.doc_type = 'invoice' then i.quantity else -i.quantity end) as quantity,
            sum(case when d.doc_type = 'invoice' then i.taxable_value else -i.taxable_value end) as taxable_value,
            sum(case when d.doc_type = 'invoice' then i.tax_amount else -i.tax_amount end) as tax
       from document_items i join documents d on d.id = i.document_id
      where d.doc_type in ('invoice','credit_note') and d.status not in ('draft','cancelled') and d.issue_date between $1 and $2 and ${branchCond(t)}
      group by 1, 2 order by 4 desc`,
    [r.from, r.to],
  );
  const inputTax = new D(docTotals.input_tax!).add(expTax.v);
  return {
    range: r,
    outputTax: fmt(docTotals.output_tax),
    inputTax: inputTax.toFixed(2),
    inputTaxFromExpenses: fmt(expTax.v),
    netPayableEstimate: new D(docTotals.output_tax!).sub(inputTax).toFixed(2),
    b2b: { invoices: docTotals.b2b_count, taxable: fmt(docTotals.b2b_taxable) },
    b2c: { invoices: docTotals.b2c_count, taxable: fmt(docTotals.b2c_taxable) },
    rateWise: camelize(rateWise),
    additionalCharges: camelize(charges),
    hsnSummary: camelize(hsn),
    disclaimer:
      "Prepared from transactions recorded in this app. It is not a GST return and is not connected to the GST portal. Verify with your tax professional before filing; input tax credit eligibility depends on supplier filings and GST rules.",
  };
}

export async function employeePerformance(t: Tenant, r: Range) {
  t.require("reports.view");
  t.requireFeature("advanced_reports");
  const rows = await t.db.query(
    `select u.id as user_id, u.full_name,
            count(d.id) filter (where d.doc_type = 'invoice')::int as invoices,
            coalesce(sum(d.grand_total) filter (where d.doc_type = 'invoice'), 0) as invoiced,
            count(d.id) filter (where d.doc_type = 'quotation')::int as quotations,
            count(d.id) filter (where d.doc_type = 'quotation' and d.status in ('accepted','converted'))::int as quotations_won,
            coalesce((select sum(p.amount) from payments p where p.created_by = u.id and p.status = 'active' and p.direction = 'in' and p.paid_on between $1 and $2), 0) as collected,
            (select count(*)::int from service_tickets st where st.assigned_to = u.id and st.status = 'completed' and st.completed_at::date between $1 and $2) as tickets_completed
       from memberships m join users u on u.id = m.user_id
       left join documents d on d.finalized_by = u.id and d.status not in ('draft','cancelled') and d.issue_date between $1 and $2 and ${branchCond(t)}
      group by u.id order by invoiced desc`,
    [r.from, r.to],
  );
  return camelize(rows);
}

export async function branchPerformance(t: Tenant, r: Range) {
  t.require("reports.view");
  t.requireFeature("advanced_reports");
  return camelize(
    await t.db.query(
      `select b.id as branch_id, b.name,
              coalesce(sum(d.grand_total) filter (where d.doc_type = 'invoice'), 0) as sales,
              coalesce(sum(d.grand_total) filter (where d.doc_type = 'purchase_bill'), 0) as purchases,
              count(d.id) filter (where d.doc_type = 'invoice')::int as invoices
         from branches b left join documents d on d.branch_id = b.id and d.status not in ('draft','cancelled') and d.issue_date between $1 and $2
        where ${branchCond(t, "b.id")} group by b.id order by sales desc`,
      [r.from, r.to],
    ),
  );
}

export async function expenseReport(t: Tenant, r: Range) {
  t.require("reports.view");
  t.require("expenses.view");
  return camelize(
    await t.db.query(
      `select c.name as category, count(*)::int as entries, sum(e.amount) as amount, sum(e.tax_amount) as gst
         from expenses e join expense_categories c on c.id = e.category_id
        where e.status = 'active' and e.expense_date between $1 and $2 and ${branchCond(t, "e.branch_id")} group by c.name order by amount desc`,
      [r.from, r.to],
    ),
  );
}

export async function cashFlow(t: Tenant, r: Range) {
  t.require("reports.view");
  t.require("accounts.view");
  const rows = await t.db.query(
    `select to_char(txn_date, 'YYYY-MM') as month, kind, sum(amount) as amount
       from account_transactions where txn_date between $1 and $2 and kind not in ('transfer_in','transfer_out')
      group by 1, 2 order by 1, 2`,
    [r.from, r.to],
  );
  const months = new Map<string, { month: string; inflow: Decimal; outflow: Decimal; byKind: Record<string, string> }>();
  type Decimal = InstanceType<typeof D>;
  for (const x of rows as Array<{ month: string; kind: string; amount: string }>) {
    const m = months.get(x.month) ?? { month: x.month, inflow: new D(0), outflow: new D(0), byKind: {} };
    const a = new D(x.amount);
    if (a.gt(0)) m.inflow = m.inflow.add(a);
    else m.outflow = m.outflow.add(a.neg());
    m.byKind[x.kind] = a.toFixed(2);
    months.set(x.month, m);
  }
  return [...months.values()].map((m) => ({ month: m.month, inflow: m.inflow.toFixed(2), outflow: m.outflow.toFixed(2), net: m.inflow.sub(m.outflow).toFixed(2), byKind: m.byKind }));
}

export async function dashboard(t: Tenant, r: Range) {
  t.require("dashboard.view");
  const fin = t.can("financials.view");
  const canSales = t.can("invoices.view");
  const today = await t.db.one<Record<string, string>>(
    `select coalesce(sum(grand_total) filter (where doc_type = 'invoice'), 0) as sales_today,
            count(*) filter (where doc_type = 'invoice')::int as invoices_today
       from documents d where issue_date = $1 and status not in ('draft','cancelled') and ${branchCond(t)}`,
    [t.today],
  );
  const period = await t.db.one<Record<string, string>>(
    `select coalesce(sum(grand_total) filter (where doc_type = 'invoice'), 0) - coalesce(sum(grand_total) filter (where doc_type = 'credit_note'), 0) as sales,
            coalesce(sum(taxable_total) filter (where doc_type = 'invoice'), 0) - coalesce(sum(taxable_total) filter (where doc_type = 'credit_note'), 0) as revenue,
            coalesce(sum(cost_total) filter (where doc_type = 'invoice'), 0) - coalesce(sum(cost_total) filter (where doc_type = 'credit_note'), 0) as cogs,
            coalesce(sum(grand_total) filter (where doc_type = 'purchase_bill'), 0) as purchases,
            count(*) filter (where doc_type = 'quotation')::int as quotations,
            count(*) filter (where doc_type = 'quotation' and status in ('accepted','converted'))::int as quotations_won
       from documents d where issue_date between $1 and $2 and status not in ('draft','cancelled') and ${branchCond(t)}`,
    [r.from, r.to],
  );
  const expenses = t.can("expenses.view")
    ? await t.db.one<{ v: string }>(`select coalesce(sum(amount), 0) v from expenses e where status = 'active' and expense_date between $1 and $2 and ${branchCond(t, "e.branch_id")}`, [r.from, r.to])
    : null;
  const collected = t.can("payments.view")
    ? await t.db.one<{ v: string }>(`select coalesce(sum(amount), 0) v from payments where status = 'active' and direction = 'in' and paid_on between $1 and $2 and ${branchCond(t, "branch_id")}`, [r.from, r.to])
    : null;
  const dues = canSales
    ? await t.db.one<Record<string, string>>(
        `select coalesce(sum(balance_due) filter (where doc_type = 'invoice'), 0) as receivable,
                coalesce(sum(balance_due) filter (where doc_type = 'invoice' and due_date < $1), 0) as overdue,
                count(*) filter (where doc_type = 'invoice' and due_date < $1)::int as overdue_count,
                coalesce(sum(balance_due) filter (where doc_type = 'purchase_bill'), 0) as payable
           from documents d where status in ('issued','partially_paid') and ${branchCond(t)}`,
        [t.today],
      )
    : null;
  const low = t.can("inventory.view")
    ? await t.db.query(
        `select p.id, p.name, p.unit, p.reorder_level, coalesce(sum(sl.quantity), 0) as stock
           from products p left join stock_levels sl on sl.product_id = p.id and ${branchCond(t, "sl.branch_id")}
          where p.archived_at is null and p.track_inventory group by p.id having coalesce(sum(sl.quantity), 0) <= p.reorder_level
          order by coalesce(sum(sl.quantity), 0) - p.reorder_level limit 8`,
      )
    : [];
  const recentDocs = await t.db.query(
    `select id, doc_type, number, status, party_name, grand_total, issue_date, created_at from documents d
      where doc_type = any($1) and ${branchCond(t)} order by created_at desc limit 8`,
    [[...(canSales ? ["invoice", "credit_note"] : []), ...(t.can("quotations.view") ? ["quotation"] : []), ...(t.can("purchases.view") ? ["purchase_bill"] : [])]],
  );
  const recentPayments = t.can("payments.view")
    ? await t.db.query("select p.id, p.number, p.direction, p.amount, p.method, p.paid_on, pa.name as party_name from payments p join parties pa on pa.id = p.party_id where p.status = 'active' order by p.created_at desc limit 6")
    : [];
  const followUps = t.can("parties.view")
    ? await t.db.query(
        `select i.id, i.kind, i.notes, i.follow_up_on, p.id as party_id, p.name as party_name, p.phone from party_interactions i join parties p on p.id = i.party_id
          where i.completed_at is null and i.follow_up_on <= $1::date + 7 order by i.follow_up_on limit 6`,
        [t.today],
      )
    : [];
  const span = (Date.parse(r.to) - Date.parse(r.from)) / 86_400_000;
  const trend = canSales ? await salesSummary(t, r, span > 62 ? "month" : "day", true) : [];
  const revenue = new D(period.revenue!);
  const gross = revenue.sub(period.cogs!);
  return {
    range: r,
    today: { sales: fmt(today.sales_today), invoices: Number(today.invoices_today) },
    period: {
      sales: canSales ? fmt(period.sales) : undefined,
      revenue: fmt(revenue),
      purchases: t.can("purchases.view") ? fmt(period.purchases) : undefined,
      expenses: expenses ? fmt(expenses.v) : undefined,
      cashCollected: collected ? fmt(collected.v) : undefined,
      grossProfitEstimate: fin ? gross.toFixed(2) : undefined,
      netProfitEstimate: fin && expenses ? gross.sub(expenses.v).toFixed(2) : undefined,
      quotations: Number(period.quotations),
      quotationWinRate: Number(period.quotations) ? Math.round((Number(period.quotations_won) / Number(period.quotations)) * 100) : null,
    },
    dues: dues ? { receivable: fmt(dues.receivable), overdue: fmt(dues.overdue), overdueCount: Number(dues.overdue_count), payable: t.can("purchases.view") ? fmt(dues.payable) : undefined } : null,
    lowStock: camelize(low),
    recentDocuments: camelize(recentDocs),
    recentPayments: camelize(recentPayments),
    followUps: camelize(followUps),
    trend,
  };
}

/** Converts a report into CSV for download. */
export function reportCSV(headers: string[], rows: Record<string, unknown>[], keys?: string[]): string {
  const k = keys ?? headers;
  return toCSV(headers, rows.map((r) => k.map((key) => r[key])));
}
