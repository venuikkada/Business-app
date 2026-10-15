import Link from "next/link";
import { listSupportTicketsAdmin } from "@cba/server/platform";
import { formatDateTimeIN } from "@cba/core";
import { requireAdmin } from "@/lib/session";
import { Badge, Card, PageHeader, StatusBadge, Table, Tabs, Td, Th } from "@cba/ui";

export default async function Support({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const sp = await searchParams;
  const a = await requireAdmin();
  const items = (await listSupportTicketsAdmin(a, sp.status ?? "open")) as Array<Record<string, string>>;
  return (
    <>
      <PageHeader title="Support desk" />
      <Tabs active={sp.status ?? "open"} tabs={[["open", "Open"], ["waiting_on_customer", "Waiting on customer"], ["closed", "Closed"]].map(([k, l]) => ({ key: k!, label: l, href: `/support?status=${k}` }))} />
      <Card>
        <Table>
          <thead><tr><Th>Subject</Th><Th>Business</Th><Th>From</Th><Th>Updated</Th><Th>Status</Th></tr></thead>
          <tbody>{items.map((t) => <tr key={t.id}><Td><Link className="font-medium text-brand-700" href={`/support/${t.id}`}>{t.subject}</Link> {t.priority === "high" ? <Badge color="orange">Priority</Badge> : null}</Td><Td>{t.businessName}</Td><Td className="text-xs">{t.createdByEmail}</Td><Td className="text-xs">{formatDateTimeIN(t.updatedAt)}</Td><Td><StatusBadge status={t.status === "waiting_on_customer" ? "pending" : t.status!} /></Td></tr>)}</tbody>
        </Table>
      </Card>
    </>
  );
}
