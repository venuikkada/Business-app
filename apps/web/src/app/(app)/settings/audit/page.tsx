import { team } from "@cba/server";
import { formatDateTimeIN } from "@cba/core";
import { tenantOrError } from "@/lib/session";
import { Badge, Card, ErrorPanel, LinkButton, PageHeader, Table, Td, Th } from "@/components/ui";

export const metadata = { title: "Audit log" };

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ page?: string; entityType?: string }> }) {
  const sp = await searchParams;
  const res = await tenantOrError(async (t) => team.listAudit(t, { page: Number(sp.page ?? 1), entityType: sp.entityType }));
  if (!res.ok) return <ErrorPanel code={res.code} message={res.message} />;
  const items = res.data.items as Array<Record<string, string | boolean | null>>;
  const page = res.data.page;
  return (
    <>
      <PageHeader back={{ href: "/settings", label: "Settings" }} title="Audit log" subtitle="Append-only record of important changes. Entries cannot be edited or deleted." />
      <Card>
        <Table>
          <thead><tr><Th>When</Th><Th>Who</Th><Th>Action</Th><Th>Details</Th></tr></thead>
          <tbody>
            {items.map((a) => (
              <tr key={String(a.id)}>
                <Td className="whitespace-nowrap text-xs">{formatDateTimeIN(a.createdAt as string)}<div className="text-muted">{a.ip as string}</div></Td>
                <Td className="text-sm">{(a.userName as string) ?? "System"} {a.viaSupport ? <Badge color="amber">Support</Badge> : null}</Td>
                <Td><Badge>{a.action as string}</Badge></Td>
                <Td className="max-w-md text-sm">{a.summary as string}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <div className="flex justify-between border-t border-line px-5 py-3">
          {page > 1 ? <LinkButton size="sm" variant="secondary" href={`/settings/audit?page=${page - 1}`}>Newer</LinkButton> : <span />}
          {items.length === 50 ? <LinkButton size="sm" variant="secondary" href={`/settings/audit?page=${page + 1}`}>Older</LinkButton> : null}
        </div>
      </Card>
    </>
  );
}
