import { support, team } from "@cba/server";
import { formatDateTimeIN } from "@cba/core";
import { tenantOrError } from "@/lib/session";
import { SupportForm } from "@/components/settings/account";
import { ActionButton } from "@/components/client";
import { Badge, Card, CardHeader, ErrorPanel, PageHeader, StatusBadge } from "@/components/ui";

export const metadata = { title: "Help & support" };

export default async function SupportPage() {
  const res = await tenantOrError(async (t) => ({
    tickets: (await support.listSupportTickets(t)) as Array<Record<string, string | number>>,
    grants: t.can("settings.view") ? ((await team.listSupportGrants(t)) as Array<Record<string, string | null>>) : [],
    owner: t.roleKey === "owner",
    priority: t.hasFeature("priority_support"),
  }));
  if (!res.ok) return <ErrorPanel code={res.code} message={res.message} />;
  const { tickets, grants, owner, priority } = res.data;
  return (
    <>
      <PageHeader back={{ href: "/settings", label: "Settings" }} title="Help & support" subtitle={priority ? "Priority support is included in your plan." : "We usually reply within one working day."} />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Contact support" />
          <SupportForm />
        </Card>
        <Card>
          <CardHeader title="Your requests" />
          <ul className="divide-y divide-line text-sm">
            {tickets.map((t) => (
              <li key={t.id as string} className="flex items-center justify-between px-5 py-3"><span>{t.subject as string} <span className="text-xs text-muted">· {formatDateTimeIN(t.updatedAt as string)}</span></span><StatusBadge status={t.status === "waiting_on_customer" ? "pending" : (t.status as string)} /></li>
            ))}
            {tickets.length === 0 && <li className="px-5 py-3 text-muted">No requests yet.</li>}
          </ul>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Support access to your data" subtitle="Platform staff cannot see your records unless the owner approves a time-limited, read-only grant. Every access is logged." />
          <ul className="divide-y divide-line text-sm">
            {grants.map((g) => {
              const active = g.approvedAt && !g.revokedAt && g.expiresAt && new Date(g.expiresAt) > new Date();
              return (
                <li key={g.id!} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div>{g.staffName} <span className="text-xs text-muted">({g.staffEmail})</span> {active ? <Badge color="amber">Active until {formatDateTimeIN(g.expiresAt)}</Badge> : g.revokedAt ? <Badge>Revoked/denied</Badge> : g.approvedAt ? <Badge>Expired</Badge> : <Badge color="orange">Requested</Badge>}</div>
                    <div className="text-xs text-muted">Reason: {g.reason} · {formatDateTimeIN(g.requestedAt)}</div>
                  </div>
                  {owner && !g.revokedAt && (
                    <div className="flex gap-2">
                      {!g.approvedAt && <ActionButton size="sm" variant="primary" path={`support-grants/${g.id}`} body={{ approve: true, hours: 24 }} success="Access granted for 24 hours">Allow 24h</ActionButton>}
                      <ActionButton size="sm" variant="danger" path={`support-grants/${g.id}`} body={{ approve: false }} success="Access revoked">{g.approvedAt ? "Revoke" : "Deny"}</ActionButton>
                    </div>
                  )}
                </li>
              );
            })}
            {grants.length === 0 && <li className="px-5 py-3 text-muted">No support access requests.</li>}
          </ul>
        </Card>
      </div>
    </>
  );
}
