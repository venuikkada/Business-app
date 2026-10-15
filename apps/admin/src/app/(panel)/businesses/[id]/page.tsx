import { getBusinessForAdmin, listPlans } from "@cba/server/platform";
import { formatDateIN, formatDateTimeIN, formatINR } from "@cba/core";
import { requireAdmin } from "@/lib/session";
import { AdminAction } from "@/components/client";
import { SubscriptionOverride } from "@/components/forms";
import { Badge, Card, CardHeader, DefinitionList, PageHeader, StatusBadge, Table, Td, Th } from "@cba/ui";

export default async function BusinessDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const a = await requireAdmin();
  const d = await getBusinessForAdmin(a, id);
  const plans = (await listPlans(a)) as Array<{ code: string; name: string }>;
  const b = d.business as Record<string, string | null>;
  const s = (d.subscription ?? {}) as Record<string, string | null>;
  const st = (d.stats ?? {}) as Record<string, string | number | null>;
  return (
    <>
      <PageHeader
        back={{ href: "/businesses", label: "Businesses" }}
        title={<span className="flex items-center gap-2">{b.name} <StatusBadge status={b.status!} /></span>}
        subtitle={`${b.ownerName} · ${b.ownerEmail}`}
        actions={
          <>
            {b.status === "active" ? <AdminAction danger path={`businesses/${id}/status`} body={{ status: "suspended" }} label="Suspend" /> : b.status === "suspended" ? <AdminAction path={`businesses/${id}/status`} body={{ status: "active" }} label="Reactivate" /> : null}
            <AdminAction path={`businesses/${id}/support-access`} label="Request support access" reasonLabel="Why do you need to see this business's data? (sent to the owner)" />
          </>
        }
      />
      {b.suspendedReason && <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-800">Suspended: {b.suspendedReason}</p>}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <DefinitionList items={[["Type", b.businessType], ["GSTIN", b.gstin], ["City", b.city], ["Phone", b.phone], ["Created", formatDateTimeIN(b.createdAt)], ["Members", String(st.members ?? "")], ["Invoices (30 days)", String(st.invoices30d ?? "")], ["Last activity", formatDateTimeIN(st.lastActivity as string)], ["Deletion", b.deletionRequestedAt ? `Requested; purge after ${formatDateIN(b.purgeAfter)}` : null]]} />
        </Card>
        <Card>
          <CardHeader title="Subscription" subtitle={<>{s.planName} · <StatusBadge status={s.status ?? "—"} /> · {s.status === "trialing" ? `trial ends ${formatDateIN(s.trialEndsAt)}` : `period ends ${formatDateIN(s.currentPeriodEnd)}`}</>} />
          <SubscriptionOverride businessId={id} plans={plans} current={{ planCode: s.planCode ?? "free", status: s.status ?? "active" }} />
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Payments" />
          <Table>
            <thead><tr><Th>Date</Th><Th align="right">Amount</Th><Th>Status</Th><Th>Gateway refs</Th></tr></thead>
            <tbody>{(d.payments as Array<Record<string, string | number | null>>).map((p) => <tr key={p.id as string}><Td>{formatDateTimeIN(p.createdAt as string)}</Td><Td align="right">{formatINR(Number(p.amount) / 100)}</Td><Td><StatusBadge status={p.status === "paid" ? "paid" : (p.status as string)} /></Td><Td className="font-mono text-xs">{p.gatewayOrderId} {p.gatewayPaymentId}</Td></tr>)}</tbody>
          </Table>
        </Card>
        <Card>
          <CardHeader title="Support access grants" />
          <ul className="divide-y divide-line text-sm">{(d.grants as Array<Record<string, string | null>>).map((g) => <li key={g.id!} className="px-5 py-2.5">{g.staffEmail}: {g.reason} {g.approvedAt ? <Badge color="green">Approved until {formatDateTimeIN(g.expiresAt)}</Badge> : g.revokedAt ? <Badge>Denied/revoked</Badge> : <Badge color="orange">Waiting for owner</Badge>}</li>)}</ul>
        </Card>
        <Card>
          <CardHeader title="Admin activity on this business" />
          <ul className="divide-y divide-line text-sm">{(d.audit as Array<Record<string, string | null>>).map((x) => <li key={String(x.id)} className="px-5 py-2.5"><Badge>{x.action}</Badge> {x.actorEmail} · {formatDateTimeIN(x.createdAt)}</li>)}</ul>
        </Card>
      </div>
    </>
  );
}
