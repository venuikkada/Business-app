import Link from "next/link";
import { reports } from "@cba/server";
import { formatDateIN, formatINR, DOC_TYPE_META, PAYMENT_METHOD_LABEL, type DocType } from "@cba/core";
import { tenantOrError } from "@/lib/session";
import { Card, CardHeader, ErrorPanel, LinkButton, Money, PageHeader, Stat, StatusBadge, EmptyState } from "@/components/ui";
import { TrendChart } from "@/components/charts/trend";
import { DateFilter } from "@/components/date-filter";

export const metadata = { title: "Dashboard" };

type SP = Promise<{ preset?: string; from?: string; to?: string; welcome?: string }>;

export default async function Dashboard({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const res = await tenantOrError(async (t) => {
    const range = reports.resolveRange(t, sp);
    const d = await reports.dashboard(t, range);
    const counts = await t.db.one<{ parties: number; products: number; invoices: number }>(
      "select (select count(*)::int from parties) parties, (select count(*)::int from products) products, (select count(*)::int from documents where doc_type = 'invoice') invoices",
    );
    return { d, counts, can: (p: string) => t.permissions.has(p), name: t.user.fullName.split(" ")[0] };
  });
  if (!res.ok) return <ErrorPanel code={res.code} message={res.message} />;
  const { d, counts, can, name } = res.data;
  const fresh = counts.invoices === 0;

  return (
    <>
      <PageHeader
        title={`Namaste, ${name}`}
        subtitle={`${formatDateIN(d.range.from)} – ${formatDateIN(d.range.to)}`}
        actions={
          <>
            {can("invoices.create") && <LinkButton href="/documents/new?type=invoice">New invoice</LinkButton>}
            {can("quotations.create") && <LinkButton href="/documents/new?type=quotation" variant="secondary">New quotation</LinkButton>}
          </>
        }
      />

      {(fresh || sp.welcome) && (
        <Card className="mb-5 border-brand-200 bg-gradient-to-r from-brand-50 to-white p-5">
          <h2 className="font-semibold">Get started in 3 steps</h2>
          <ol className="mt-3 grid gap-2 sm:grid-cols-3">
            {[
              { done: counts.parties > 0, href: "/parties/new", label: "Add your first customer", alt: "/parties/import" },
              { done: counts.products > 0, href: "/products/new", label: "Add products or import a CSV", alt: "/products/import" },
              { done: counts.invoices > 0, href: "/documents/new?type=invoice", label: "Create and share an invoice" },
            ].map((s, i) => (
              <li key={i}>
                <Link href={s.href} className="flex items-center gap-3 rounded-xl border border-line bg-white p-3 text-sm hover:border-brand-300">
                  <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold ${s.done ? "bg-emerald-600 text-white" : "bg-brand-100 text-brand-800"}`}>{s.done ? "✓" : i + 1}</span>
                  {s.label}
                </Link>
              </li>
            ))}
          </ol>
        </Card>
      )}

      <DateFilter base="/dashboard" preset={sp.preset} from={sp.from} to={sp.to} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Today's sales" value={<Money value={d.today.sales} />} hint={`${d.today.invoices} invoice${d.today.invoices === 1 ? "" : "s"} today`} tone="brand" href="/documents/invoice" />
        {d.period.sales !== undefined && <Stat label="Sales in period" value={<Money value={d.period.sales} />} hint={`Revenue excl. GST ${formatINR(d.period.revenue)}`} href={`/reports/sales?from=${d.range.from}&to=${d.range.to}`} />}
        {d.period.cashCollected !== undefined && <Stat label="Cash collected" value={<Money value={d.period.cashCollected} />} hint="Payments received" href="/payments?direction=in" />}
        {d.period.expenses !== undefined && <Stat label="Expenses" value={<Money value={d.period.expenses} />} href="/expenses" />}
        {d.period.grossProfitEstimate !== undefined && <Stat label="Gross profit (est.)" value={<Money value={d.period.grossProfitEstimate} />} hint="Revenue − cost of goods" tone={Number(d.period.grossProfitEstimate) < 0 ? "bad" : "good"} href={`/reports/pnl?from=${d.range.from}&to=${d.range.to}`} />}
        {d.period.netProfitEstimate !== undefined && <Stat label="Net profit (est.)" value={<Money value={d.period.netProfitEstimate} />} hint="After expenses" tone={Number(d.period.netProfitEstimate) < 0 ? "bad" : "default"} href={`/reports/pnl?from=${d.range.from}&to=${d.range.to}`} />}
        {d.dues && <Stat label="To collect" value={<Money value={d.dues.receivable} />} hint={d.dues.overdueCount ? `${formatINR(d.dues.overdue)} overdue on ${d.dues.overdueCount} invoice(s)` : "Nothing overdue"} tone={d.dues.overdueCount ? "bad" : "default"} href="/outstanding" />}
        {d.dues?.payable !== undefined && <Stat label="To pay suppliers" value={<Money value={d.dues.payable} />} href="/outstanding?side=payable" />}
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Sales trend" subtitle="Invoiced sales vs money collected vs purchases" />
          <div className="p-3 sm:p-5">
            <TrendChart data={d.trend} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Follow-ups" subtitle="Due in the next 7 days" action={<Link href="/parties" className="text-sm text-brand-700">All</Link>} />
          {d.followUps.length ? (
            <ul className="divide-y divide-line">
              {(d.followUps as Array<Record<string, string>>).map((f) => (
                <li key={f.id} className="px-4 py-3 text-sm sm:px-5">
                  <div className="flex justify-between gap-2">
                    <Link href={`/parties/${f.partyId}`} className="font-medium hover:text-brand-700">{f.partyName}</Link>
                    <span className={f.followUpOn! < d.range.to ? "text-red-700" : "text-muted"}>{formatDateIN(f.followUpOn)}</span>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-muted">{f.notes}</p>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No follow-ups due" body="Log calls and visits on a customer to get reminders here." />
          )}
        </Card>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Recent transactions" />
          {d.recentDocuments.length || d.recentPayments.length ? (
            <ul className="divide-y divide-line">
              {(d.recentDocuments as Array<Record<string, string>>).map((x) => (
                <li key={x.id}>
                  <Link href={`/documents/${x.docType}/${x.id}`} className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-stone-50 sm:px-5">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{x.partyName}</div>
                      <div className="text-xs text-muted">{DOC_TYPE_META[x.docType as DocType]?.label} {x.number ?? "(draft)"} · {formatDateIN(x.issueDate)}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <StatusBadge status={x.status!} />
                      <Money value={x.grandTotal} className="font-medium" />
                    </div>
                  </Link>
                </li>
              ))}
              {(d.recentPayments as Array<Record<string, string>>).map((p) => (
                <li key={p.id}>
                  <Link href={`/payments/${p.id}`} className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-stone-50 sm:px-5">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{p.partyName}</div>
                      <div className="text-xs text-muted">{p.direction === "in" ? "Payment received" : "Payment made"} {p.number} · {PAYMENT_METHOD_LABEL[p.method!]} · {formatDateIN(p.paidOn)}</div>
                    </div>
                    <Money value={p.direction === "in" ? p.amount : `-${p.amount}`} className={p.direction === "in" ? "font-medium text-emerald-700" : "font-medium"} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No transactions yet" body="Your invoices, quotations and payments will appear here." action={can("invoices.create") ? <LinkButton href="/documents/new?type=invoice">Create invoice</LinkButton> : undefined} />
          )}
        </Card>
        <Card>
          <CardHeader title="Low stock" action={<Link href="/inventory?tab=low" className="text-sm text-brand-700">All</Link>} />
          {d.lowStock.length ? (
            <ul className="divide-y divide-line">
              {(d.lowStock as Array<Record<string, string>>).map((p) => (
                <li key={p.id} className="flex items-center justify-between px-4 py-2.5 text-sm sm:px-5">
                  <Link href={`/products/${p.id}`} className="truncate hover:text-brand-700">{p.name}</Link>
                  <span className={Number(p.stock) <= 0 ? "font-medium text-red-700" : "text-amber-700"}>
                    {Number(p.stock)} {p.unit}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="Stock levels look healthy" />
          )}
          {d.period.quotationWinRate !== null && (
            <div className="border-t border-line px-5 py-3 text-sm text-muted">
              Quotation win rate: <span className="font-semibold text-ink">{d.period.quotationWinRate}%</span> of {d.period.quotations}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
