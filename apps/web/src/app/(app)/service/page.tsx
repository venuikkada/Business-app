import Link from "next/link";
import { service } from "@cba/server";
import { formatDateTimeIN } from "@cba/core";
import { tenantOrError } from "@/lib/session";
import { qs } from "@/lib/fmt";
import { Badge, Card, EmptyState, ErrorPanel, LinkButton, PageHeader, Pagination, SearchForm, StatusBadge, Table, Tabs, Td, Th } from "@/components/ui";

export const metadata = { title: "Service tickets" };
const PRIORITY_COLOR = { urgent: "red", high: "orange", normal: "gray", low: "gray" } as const;

export default async function ServicePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const status = sp.status ?? "active";
  const res = await tenantOrError(async (t) => {
    t.requireFeature("service");
    return { list: await service.listTickets(t, { ...sp, status: status === "all" ? undefined : status }), canCreate: t.can("service.create") && !t.isSupport };
  });
  if (!res.ok) return <ErrorPanel code={res.code} message={res.message} />;
  const { list, canCreate } = res.data;
  return (
    <>
      <PageHeader title="Service tickets" subtitle="Repairs, installations and site visits" actions={canCreate && <LinkButton href="/service/new">New ticket</LinkButton>} />
      <Tabs active={status} tabs={[["active", "Active"], ["open", "Unassigned"], ["in_progress", "In progress"], ["on_hold", "On hold"], ["completed", "Completed"], ["all", "All"]].map(([k, l]) => ({ key: k!, label: l, href: `/service${qs({ q: sp.q, status: k, assignedTo: sp.assignedTo })}` }))} />
      <Card>
        <SearchForm action="/service" q={sp.q} placeholder="Ticket no., customer, serial">
          <input type="hidden" name="status" value={status} />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="assignedTo" value="me" defaultChecked={sp.assignedTo === "me"} className="accent-brand-600" /> Mine</label>
        </SearchForm>
        {list.items.length === 0 ? (
          <EmptyState title="No tickets here" body="Log customer complaints, assign technicians and bill the job when done." action={canCreate ? <LinkButton href="/service/new">New ticket</LinkButton> : undefined} />
        ) : (
          <>
            <Table>
              <thead><tr><Th>Ticket</Th><Th>Customer</Th><Th>Issue</Th><Th>Technician</Th><Th>Visit</Th><Th>Status</Th></tr></thead>
              <tbody>
                {list.items.map((x) => (
                  <tr key={x.id as string} className="hover:bg-stone-50">
                    <Td><Link className="font-medium text-brand-700" href={`/service/${x.id}`}>{x.number as string}</Link><div className="mt-0.5"><Badge color={PRIORITY_COLOR[x.priority as keyof typeof PRIORITY_COLOR]}>{x.priority as string}</Badge> {x.underWarranty ? <Badge color="green">Warranty</Badge> : null}</div></Td>
                    <Td>{x.partyName as string}</Td>
                    <Td className="max-w-xs"><div className="truncate">{x.issue as string}</div><div className="text-xs text-muted">{[x.equipment, x.serialNumber].filter(Boolean).join(" · ")}</div></Td>
                    <Td>{(x.assignedToName as string) ?? <span className="text-muted">—</span>}</Td>
                    <Td className="whitespace-nowrap text-xs">{formatDateTimeIN(x.scheduledAt as string)}</Td>
                    <Td><StatusBadge status={x.status as string} /></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={list.page} pageSize={list.pageSize} total={list.total} hrefFor={(p) => `/service${qs({ ...sp, status, page: p })}`} />
          </>
        )}
      </Card>
    </>
  );
}
