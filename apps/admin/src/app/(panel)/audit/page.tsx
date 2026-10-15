import { platformAudit } from "@cba/server/platform";
import { formatDateTimeIN } from "@cba/core";
import { requireAdmin } from "@/lib/session";
import { Badge, Card, PageHeader, Table, Td, Th } from "@cba/ui";

export default async function Audit() {
  const a = await requireAdmin();
  const rows = (await platformAudit(a)) as Array<Record<string, unknown>>;
  return (
    <>
      <PageHeader title="Platform audit log" subtitle="Append-only. Every admin action, plan change and payment activation." />
      <Card>
        <Table>
          <thead><tr><Th>When</Th><Th>Who</Th><Th>Action</Th><Th>Target</Th><Th>Details</Th></tr></thead>
          <tbody>{rows.map((r) => <tr key={String(r.id)}><Td className="whitespace-nowrap text-xs">{formatDateTimeIN(r.createdAt as string)}<div className="text-muted">{r.ip as string}</div></Td><Td className="text-xs">{(r.actorEmail as string) ?? "system"}</Td><Td><Badge>{r.action as string}</Badge></Td><Td className="text-xs">{r.targetType as string} {String(r.targetId ?? "").slice(0, 8)}</Td><Td className="max-w-md truncate font-mono text-xs">{JSON.stringify(r.details)}</Td></tr>)}</tbody>
        </Table>
      </Card>
    </>
  );
}
