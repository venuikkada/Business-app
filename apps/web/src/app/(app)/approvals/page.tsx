import Link from "next/link";
import { approvals } from "@cba/server";
import { formatDateTimeIN } from "@cba/core";
import { tenantOrError } from "@/lib/session";
import { ActionButton } from "@/components/client";
import { Badge, Card, EmptyState, ErrorPanel, PageHeader, StatusBadge, Tabs } from "@/components/ui";

export const metadata = { title: "Approvals" };

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const status = (await searchParams).status ?? "pending";
  const res = await tenantOrError(async (t) => ({ items: (await approvals.listApprovals(t, status)) as Array<Record<string, unknown>>, me: t.userId, owner: t.roleKey === "owner", support: t.isSupport }));
  if (!res.ok) return <ErrorPanel code={res.code} message={res.message} />;
  const { items, me, owner, support } = res.data;
  return (
    <>
      <PageHeader title="Approvals" subtitle="High discounts, refunds and large stock adjustments that need an owner or manager" />
      <Tabs active={status} tabs={[{ key: "pending", label: "Pending", href: "/approvals" }, { key: "all", label: "History", href: "/approvals?status=all" }]} />
      <Card>
        {items.length === 0 ? (
          <EmptyState title="Nothing waiting" body="Set approval thresholds in Settings → Controls." />
        ) : (
          <ul className="divide-y divide-line">
            {items.map((a) => {
              const mine = a.requestedBy === me;
              const link = a.entityType === "document" ? `/documents/invoice/${a.entityId}` : a.entityType === "product" ? `/products/${a.entityId}` : a.entityType === "party" ? `/parties/${a.entityId}` : null;
              return (
                <li key={a.id as string} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2"><Badge color="orange">{String(a.kind).replace("_", " ")}</Badge><StatusBadge status={a.status as string} /></div>
                    <p className="mt-1 text-sm">{a.reason as string}</p>
                    <p className="text-xs text-muted">Requested by {a.requestedByName as string} · {formatDateTimeIN(a.createdAt as string)}{a.decidedByName ? ` · decided by ${a.decidedByName as string}` : ""}</p>
                    {link && <Link className="text-xs text-brand-700" href={link}>Open record</Link>}
                  </div>
                  {a.status === "pending" && !support && (!mine || owner) && (
                    <div className="flex gap-2">
                      <ActionButton variant="success" path={`approvals/${a.id}`} body={{ approve: true }} success="Approved">Approve</ActionButton>
                      <ActionButton variant="danger" path={`approvals/${a.id}`} body={{ approve: false }} success="Rejected" confirm={{ title: "Reject request?", reason: { label: "Reason (shown to the requester)", minLength: 2, field: "note" } }}>Reject</ActionButton>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
