import Link from "next/link";
import { notifications } from "@cba/server";
import { formatDateTimeIN } from "@cba/core";
import { tenantOrError } from "@/lib/session";
import { ActionButton } from "@/components/client";
import { Card, EmptyState, ErrorPanel, PageHeader, cn } from "@/components/ui";

export const metadata = { title: "Notifications" };

const HREF: Record<string, (id: string) => string> = {
  document: (id) => `/documents/invoice/${id}`,
  product: (id) => `/products/${id}`,
  party: (id) => `/parties/${id}`,
  amc: (id) => `/amc/${id}`,
  service_ticket: (id) => `/service/${id}`,
  approval: () => `/approvals`,
};

export default async function NotificationsPage() {
  const res = await tenantOrError(async (t) => notifications.listNotifications(t));
  if (!res.ok) return <ErrorPanel code={res.code} message={res.message} />;
  const items = res.data.items as Array<Record<string, string | null>>;
  return (
    <>
      <PageHeader title="Notifications" subtitle="Overdue payments, low stock, warranty and AMC renewals, follow-ups and approvals" actions={res.data.unread > 0 && <ActionButton path="notifications/read" body={{ ids: "all" }} success="All marked read">Mark all read</ActionButton>} />
      <Card>
        {items.length === 0 ? (
          <EmptyState title="You're all caught up" body="Alerts are generated every morning." />
        ) : (
          <ul className="divide-y divide-line">
            {items.map((n) => {
              const href = n.entityType && n.entityId ? HREF[n.entityType]?.(n.entityId) : null;
              const body = (
                <div className={cn("flex gap-3 px-5 py-3", !n.readAt && "bg-brand-50/50")}>
                  <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.readAt ? "bg-stone-300" : "bg-brand-600")} />
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{n.title}</div>
                    {n.body && <div className="text-sm text-muted">{n.body}</div>}
                    <div className="mt-0.5 text-xs text-muted">{formatDateTimeIN(n.createdAt)}</div>
                  </div>
                </div>
              );
              return <li key={n.id!}>{href ? <Link href={href} className="block hover:bg-stone-50">{body}</Link> : body}</li>;
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
