import { platformMetrics } from "@cba/server/platform";
import { formatINR } from "@cba/core";
import { requireAdmin } from "@/lib/session";
import { PostButton } from "@/components/client";
import { Card, CardHeader, PageHeader, Stat, Table, Td, Th } from "@cba/ui";

export default async function Overview() {
  const a = await requireAdmin();
  const m = await platformMetrics(a);
  return (
    <>
      <PageHeader title="Platform overview" actions={<PostButton path="jobs/daily" label="Run daily jobs now" />} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Businesses" value={m.businesses} hint={`${m.suspended} suspended`} />
        <Stat label="Active users" value={m.users} hint={`${m.signups_30d} signups in 30 days`} />
        <Stat label="MRR (est.)" value={formatINR(m.mrrPaise / 100)} hint="Active paid subscriptions" tone="brand" />
        <Stat label="Collected (30 days)" value={formatINR(m.revenue30dPaise / 100)} hint={`${m.trials} active trials · ${m.open_tickets} open tickets`} />
      </div>
      <Card className="mt-5">
        <CardHeader title="Subscriptions by plan" />
        <Table>
          <thead><tr><Th>Plan</Th><Th align="right">Businesses</Th><Th align="right">Paying</Th></tr></thead>
          <tbody>{(m.byPlan as Array<Record<string, string | number>>).map((p) => <tr key={p.code}><Td>{p.name}</Td><Td align="right">{p.subscriptions}</Td><Td align="right">{p.paying}</Td></tr>)}</tbody>
        </Table>
      </Card>
    </>
  );
}
