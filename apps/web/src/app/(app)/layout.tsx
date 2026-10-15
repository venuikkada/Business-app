import { tenant, getMyBusinesses } from "@/lib/session";
import { Shell } from "@/components/shell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const mine = await getMyBusinesses();
  const ctx = await tenant(async (t) => {
    const unread = await t.db.one<{ n: number }>("select count(*)::int n from notifications where read_at is null");
    const approvals = await t.db.one<{ n: number }>(
      `select count(*)::int n from approval_requests where status = 'pending' and requested_by <> $1 and (
         (kind = 'discount' and $2::text[] @> array['invoices.approve']) or (kind in ('refund','payment_void') and $2::text[] @> array['payments.approve'])
         or (kind in ('stock_adjustment','negative_stock') and $2::text[] @> array['inventory.approve']))`,
      [t.userId, [...t.permissions]],
    );
    return {
      businessName: t.business.name,
      userName: t.user.fullName,
      userEmail: t.user.email,
      roleName: t.roleName,
      permissions: [...t.permissions],
      planName: t.plan.effectiveCode === t.plan.code ? `${t.plan.name}${t.plan.status === "trialing" ? " trial" : ""}` : "Free",
      planStatus: t.plan.status,
      trialEndsAt: t.plan.trialEndsAt,
      unread: unread.n,
      pendingApprovals: approvals.n,
      isSupport: t.isSupport,
      suspended: t.business.status === "suspended",
    };
  });
  return (
    <Shell {...ctx} multipleBusinesses={mine.length > 1}>
      {children}
    </Shell>
  );
}
