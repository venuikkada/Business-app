import { billing } from "@cba/server";
import { formatDateIN, formatDateTimeIN, formatINR } from "@cba/core";
import { tenantOrError } from "@/lib/session";
import { PlanPicker } from "@/components/settings/billing";
import { ActionButton } from "@/components/client";
import { Badge, Card, CardHeader, ErrorPanel, PageHeader, StatusBadge, Table, Td, Th, cn } from "@/components/ui";

export const metadata = { title: "Plan & billing" };

export default async function BillingPage() {
  const res = await tenantOrError(async (t) => ({ o: await billing.subscriptionOverview(t), canEdit: t.can("billing.edit") && !t.isSupport }));
  if (!res.ok) return <ErrorPanel code={res.code} message={res.message} />;
  const { o, canEdit } = res.data;
  const sub = o.subscription as Record<string, string | boolean | null>;
  return (
    <>
      <PageHeader back={{ href: "/settings", label: "Settings" }} title="Plan & billing" subtitle="Prices exclude 18% GST. Change or cancel any time." />
      <div className="mb-5 grid gap-5 lg:grid-cols-3">
        <Card className="p-5">
          <div className="text-xs font-medium uppercase text-muted">Current plan</div>
          <div className="mt-1 flex items-center gap-2 text-2xl font-semibold">{o.plan.name} <StatusBadge status={o.plan.status} /></div>
          {o.plan.effectiveCode !== o.plan.code && <p className="mt-2 text-sm text-red-700">Your {o.plan.name} plan has lapsed — Free plan limits apply until you renew.</p>}
          {sub.status === "trialing" && <p className="mt-2 text-sm">Trial ends {formatDateIN(sub.trialEndsAt as string)}. After that you move to the Free plan unless you subscribe.</p>}
          {sub.currentPeriodEnd && sub.status !== "trialing" ? <p className="mt-2 text-sm text-muted">{sub.cancelAtPeriodEnd ? "Ends" : "Renews"} on {formatDateIN(sub.currentPeriodEnd as string)}</p> : null}
          {canEdit && sub.status === "active" && Number(o.plans.find((p) => p.code === o.plan.code)?.priceMonthly ?? 0) > 0 && (
            <div className="mt-3"><ActionButton size="sm" variant="ghost" path="billing/cancel" success="Your plan will end at the end of the period" confirm={{ title: "Cancel at the end of the period?", body: "You keep all features until then. Your data is never deleted when a plan ends.", danger: true, confirmLabel: "Cancel plan" }}>Cancel subscription</ActionButton></div>
          )}
          {canEdit && sub.cancelAtPeriodEnd ? <div className="mt-3"><ActionButton size="sm" path="billing/resume" success="Subscription resumed">Keep my subscription</ActionButton></div> : null}
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Usage this month" />
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            {o.usage.map((u) => {
              const pct = u.limit ? Math.min(100, Math.round((u.used / u.limit) * 100)) : 0;
              return (
                <div key={u.key}>
                  <div className="flex justify-between text-sm"><span>{u.label}</span><span className="tabular text-muted">{u.used} / {u.limit ?? "∞"}</span></div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-stone-100"><div className={cn("h-full rounded-full", pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-500" : "bg-brand-500")} style={{ width: `${u.limit ? pct : 4}%` }} /></div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
      <PlanPicker plans={o.plans as never} currentCode={o.plan.code} status={o.plan.status} gatewayConfigured={o.gatewayConfigured} canEdit={canEdit} />
      {(o.payments as unknown[]).length > 0 && (
        <Card className="mt-5">
          <CardHeader title="Payment history" />
          <Table>
            <thead><tr><Th>Date</Th><Th>Plan</Th><Th align="right">Amount</Th><Th>Status</Th><Th>Reference</Th></tr></thead>
            <tbody>
              {(o.payments as Array<Record<string, string | number | null>>).map((p) => (
                <tr key={p.id as string}>
                  <Td>{formatDateTimeIN(p.createdAt as string)}</Td>
                  <Td>{p.billingInterval === "year" ? "Yearly" : "Monthly"}</Td>
                  <Td align="right">{formatINR(Number(p.amount) / 100)}</Td>
                  <Td>{p.status === "paid" ? <Badge color="green">Paid</Badge> : p.status === "failed" ? <Badge color="red">Failed</Badge> : <Badge>Pending</Badge>}{p.failureReason ? <div className="text-xs text-muted">{p.failureReason as string}</div> : null}</Td>
                  <Td className="font-mono text-xs">{(p.gatewayPaymentId as string) ?? ""}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}
