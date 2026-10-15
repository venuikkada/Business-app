import Link from "next/link";
import { service } from "@cba/server";
import { formatDateIN } from "@cba/core";
import { tenantOrError } from "@/lib/session";
import { Card, EmptyState, ErrorPanel, LinkButton, Money, PageHeader, StatusBadge, Table, Tabs, Td, Th } from "@/components/ui";

export const metadata = { title: "AMC contracts" };

export default async function AmcPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const sp = await searchParams;
  const status = sp.status ?? "active";
  const res = await tenantOrError(async (t) => {
    t.requireFeature("service");
    return { list: await service.listAmcs(t, { status: status === "all" ? undefined : status, q: sp.q }), canCreate: t.can("service.create") && !t.isSupport };
  });
  if (!res.ok) return <ErrorPanel code={res.code} message={res.message} />;
  const { list, canCreate } = res.data;
  return (
    <>
      <PageHeader title="AMC contracts" subtitle="Annual maintenance contracts and renewals" actions={canCreate && <LinkButton href="/amc/new">New contract</LinkButton>} />
      <Tabs active={status} tabs={[["active", "Active"], ["expiring", "Renewal due"], ["expired", "Expired"], ["renewed", "Renewed"], ["all", "All"]].map(([k, l]) => ({ key: k!, label: l, href: `/amc?status=${k}` }))} />
      <Card>
        {list.items.length === 0 ? (
          <EmptyState title="No contracts" body="Recurring AMC revenue is the most predictable income for service businesses. Track contracts and get renewal reminders." action={canCreate ? <LinkButton href="/amc/new">New contract</LinkButton> : undefined} />
        ) : (
          <Table>
            <thead><tr><Th>Contract</Th><Th>Customer</Th><Th>Period</Th><Th align="right">Value</Th><Th>Status</Th></tr></thead>
            <tbody>
              {list.items.map((a) => (
                <tr key={a.id as string} className="hover:bg-stone-50">
                  <Td><Link className="font-medium text-brand-700" href={`/amc/${a.id}`}>{a.number as string}</Link><div className="text-xs text-muted">{a.title as string}</div></Td>
                  <Td>{a.partyName as string}</Td>
                  <Td className="whitespace-nowrap">{formatDateIN(a.startDate as string)} – {formatDateIN(a.endDate as string)}{a.status === "active" && Number(a.daysLeft) <= 30 ? <div className={Number(a.daysLeft) < 0 ? "text-xs text-red-700" : "text-xs text-amber-700"}>{Number(a.daysLeft) < 0 ? "Expired" : `${a.daysLeft} days left`}</div> : null}</Td>
                  <Td align="right"><Money value={a.amount as string} /></Td>
                  <Td><StatusBadge status={a.status as string} /></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
