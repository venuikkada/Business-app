import Link from "next/link";
import { notFound } from "next/navigation";
import { reports } from "@cba/server";
import { formatDateIN, formatINR } from "@cba/core";
import { tenantOrError } from "@/lib/session";
import { qs } from "@/lib/fmt";
import { REPORTS } from "@/lib/reports-def";
import { DateFilter } from "@/components/date-filter";
import { BarsChart, TrendChart } from "@/components/charts/trend";
import { Card, ErrorPanel, PageHeader, Table, Tabs, Td, Th, buttonClass } from "@/components/ui";

export async function generateMetadata({ params }: { params: Promise<{ name: string }> }) {
  return { title: REPORTS[(await params).name]?.title ?? "Report" };
}

/** Where a report row should drill down to. */
function drill(name: string, row: Record<string, unknown>, range: { from: string; to: string }): string | null {
  if (name === "products" && row.productId) return `/products/${row.productId}`;
  if ((name === "customers" || name === "suppliers" || name === "outstanding") && (row.partyId)) return `/parties/${row.partyId}?tab=ledger`;
  if (name === "sales" && typeof row.period === "string" && row.period.length === 10) return `/documents/invoice${qs({ from: row.period, to: row.period })}`;
  if (name === "sales" && typeof row.period === "string" && row.period.length === 7) return `/reports/sales${qs({ from: `${row.period}-01`, to: range.to < `${row.period}-31` ? range.to : `${row.period}-28`, groupBy: "day" })}`;
  if (name === "expenses") return `/expenses${qs({ from: range.from, to: range.to })}`;
  return null;
}

export default async function ReportPage({ params, searchParams }: { params: Promise<{ name: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { name } = await params;
  const sp = await searchParams;
  const def = REPORTS[name];
  if (!def) notFound();
  const res = await tenantOrError(async (t) => {
    t.require("reports.view");
    const range = reports.resolveRange(t, sp);
    const data = await def.load(t, range, sp as Record<string, string>);
    return { range, data, canExport: t.can("reports.export") };
  });
  if (!res.ok) return <ErrorPanel code={res.code} message={res.message} />;
  const { range, data, canExport } = res.data;
  const tbl = def.table(data);
  const exportQs = qs({ from: range.from, to: range.to, side: sp.side, groupBy: sp.groupBy });
  const sep = exportQs ? "&" : "?";
  const fmtCell = (v: unknown, money?: boolean) => (v === null || v === undefined || v === "" ? "" : money ? formatINR(v as string) : String(v));
  return (
    <>
      <PageHeader
        back={{ href: "/reports", label: "Reports" }}
        title={def.title}
        subtitle={def.needsRange ? `${formatDateIN(range.from)} – ${formatDateIN(range.to)}` : `As on today`}
        actions={canExport && (
          <>
            <a className={buttonClass("secondary", "sm")} href={`/api/v1/reports/${name}${exportQs}${sep}format=csv`}>CSV</a>
            <a className={buttonClass("secondary", "sm")} href={`/api/v1/reports/${name}${exportQs}${sep}format=pdf`} target="_blank" rel="noopener">PDF</a>
          </>
        )}
      />
      {def.needsRange && <DateFilter base={`/reports/${name}`} preset={sp.preset} from={sp.from} to={sp.to} extra={{ side: sp.side, groupBy: sp.groupBy }} />}
      {name === "outstanding" && <Tabs active={sp.side === "payable" ? "payable" : "receivable"} tabs={[{ key: "receivable", label: "Receivables", href: "/reports/outstanding" }, { key: "payable", label: "Payables", href: "/reports/outstanding?side=payable" }]} />}
      {name === "sales" && (
        <>
          <Tabs active={sp.groupBy === "month" ? "month" : "day"} tabs={[{ key: "day", label: "By day", href: `/reports/sales${qs({ from: range.from, to: range.to, groupBy: "day" })}` }, { key: "month", label: "By month", href: `/reports/sales${qs({ from: range.from, to: range.to, groupBy: "month" })}` }]} />
          <Card className="mb-5 p-4"><TrendChart data={data as never} /></Card>
        </>
      )}
      {name === "cashflow" && (
        <Card className="mb-5 p-4"><BarsChart data={tbl.rows} labelKey="month" keys={[{ key: "inflow", label: "Inflow", color: "#059669" }, { key: "outflow", label: "Outflow", color: "#ea580c" }]} /></Card>
      )}
      <Card>
        <Table>
          <thead>
            <tr>{tbl.columns.map((c) => <Th key={c.key} align={c.align ?? (c.money ? "right" : "left")}>{c.label}</Th>)}</tr>
          </thead>
          <tbody>
            {tbl.rows.map((r, i) => {
              const href = drill(name, r, range);
              return (
                <tr key={i} className="hover:bg-stone-50">
                  {tbl.columns.map((c, j) => (
                    <Td key={c.key} align={c.align ?? (c.money ? "right" : "left")} className="tabular">
                      {j === 0 && href ? <Link className="text-brand-700 hover:underline" href={href}>{fmtCell(r[c.key], c.money)}</Link> : fmtCell(r[c.key], c.money)}
                    </Td>
                  ))}
                </tr>
              );
            })}
            {!tbl.rows.length && <tr><Td className="text-muted">No data for this period.</Td></tr>}
            {tbl.totals && (
              <tr className="bg-stone-50 font-semibold">
                {tbl.columns.map((c) => <Td key={c.key} align={c.align ?? (c.money ? "right" : "left")} className="tabular">{fmtCell(tbl.totals![c.key], c.money)}</Td>)}
              </tr>
            )}
          </tbody>
        </Table>
        {tbl.notes?.length ? (
          <ul className="space-y-1 border-t border-line px-5 py-4 text-xs text-muted">{tbl.notes.map((n, i) => <li key={i}>• {n}</li>)}</ul>
        ) : null}
      </Card>
    </>
  );
}
