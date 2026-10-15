import Link from "next/link";
import { payments } from "@cba/server";
import { formatDateIN, formatIndianPhone } from "@cba/core";
import { tenantOrError } from "@/lib/session";
import { OpenLinkButton } from "@/components/client";
import { Card, EmptyState, ErrorPanel, Money, PageHeader, Stat, Table, Tabs, Td, Th } from "@/components/ui";

export const metadata = { title: "Outstanding dues" };

export default async function OutstandingPage({ searchParams }: { searchParams: Promise<{ side?: string }> }) {
  const side = (await searchParams).side === "payable" ? "payable" : "receivable";
  const res = await tenantOrError(async (t) => ({ o: await payments.outstandingReport(t, side), remind: t.hasFeature("reminders"), today: t.today }));
  if (!res.ok) return <ErrorPanel code={res.code} message={res.message} />;
  const { o, remind, today } = res.data;
  return (
    <>
      <PageHeader title="Outstanding dues" subtitle={`As on ${formatDateIN(o.asOf)} — aging by due date`} actions={<><a className="text-sm text-brand-700" href={`/api/v1/reports/outstanding?side=${side}&format=csv`}>CSV</a><a className="text-sm text-brand-700" href={`/api/v1/reports/outstanding?side=${side}&format=pdf`} target="_blank" rel="noopener">PDF</a></>} />
      <Tabs active={side} tabs={[{ key: "receivable", label: "To collect (customers)", href: "/outstanding" }, { key: "payable", label: "To pay (suppliers)", href: "/outstanding?side=payable" }]} />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Stat label="Total" value={<Money value={o.totals.total} />} tone="brand" />
        <Stat label="Not yet due" value={<Money value={o.totals.notDue} />} />
        <Stat label="1–30 days" value={<Money value={o.totals.d1_30} />} />
        <Stat label="31–60 days" value={<Money value={o.totals.d31_60} />} />
        <Stat label="61–90 days" value={<Money value={o.totals.d61_90} />} tone={Number(o.totals.d61_90) ? "bad" : "default"} />
        <Stat label="90+ days" value={<Money value={o.totals.d90Plus} />} tone={Number(o.totals.d90Plus) ? "bad" : "default"} />
      </div>
      <Card>
        {o.items.length === 0 ? (
          <EmptyState title={side === "receivable" ? "Nobody owes you money" : "You owe nothing"} body="Great job keeping accounts clean." />
        ) : (
          <Table>
            <thead><tr><Th>{side === "receivable" ? "Customer" : "Supplier"}</Th><Th align="right">Not due</Th><Th align="right">1–30</Th><Th align="right">31–60</Th><Th align="right">61–90</Th><Th align="right">90+</Th><Th align="right">Total</Th>{side === "receivable" && remind && <Th />}</tr></thead>
            <tbody>
              {o.items.map((i) => (
                <tr key={i.partyId} className="hover:bg-stone-50">
                  <Td>
                    <Link className="font-medium hover:text-brand-700" href={`/parties/${i.partyId}?tab=ledger`}>{i.partyName}</Link>
                    <div className="text-xs text-muted">{formatIndianPhone(i.partyPhone)} · {i.documents} open · oldest due {formatDateIN(i.oldestDue)}{i.oldestDue && i.oldestDue < today ? "" : ""}</div>
                  </Td>
                  <Td align="right"><Money value={i.notDue} /></Td>
                  <Td align="right"><Money value={i.d1_30} /></Td>
                  <Td align="right"><Money value={i.d31_60} /></Td>
                  <Td align="right" className={Number(i.d61_90) ? "text-red-700" : ""}><Money value={i.d61_90} /></Td>
                  <Td align="right" className={Number(i.d90Plus) ? "font-medium text-red-700" : ""}><Money value={i.d90Plus} /></Td>
                  <Td align="right" className="font-semibold"><Money value={i.total} /></Td>
                  {side === "receivable" && remind && (
                    <Td align="right">{i.partyPhone ? <OpenLinkButton size="sm" variant="ghost" path={`parties/${i.partyId}/reminder`} field="url">Remind</OpenLinkButton> : null}</Td>
                  )}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
