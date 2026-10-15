import Link from "next/link";
import { businesses } from "@cba/server";
import { tenantOrError } from "@/lib/session";
import { BusinessProfileForm } from "@/components/settings/forms";
import { Card, ErrorPanel, PageHeader } from "@/components/ui";

export const metadata = { title: "Settings" };

const SECTIONS = [
  ["/settings/preferences", "Invoice & GST preferences", "GST scheme, bank & UPI, terms, numbering, approval limits"],
  ["/settings/billing", "Plan & billing", "Your subscription, usage and upgrades"],
  ["/team", "Team, roles & branches", "Employees, permissions and branches"],
  ["/settings/security", "Profile & security", "Password, two-factor authentication, sessions"],
  ["/settings/data", "Data, export & deletion", "Download everything, import, delete business"],
  ["/settings/audit", "Audit log", "Who changed what, and when"],
  ["/settings/support", "Help & support", "Contact support and manage support access"],
] as const;

export default async function SettingsPage() {
  const res = await tenantOrError(async (t) => ({ p: t.can("settings.view") ? businesses.businessProfile(t) : null, canEdit: t.can("settings.edit") }));
  if (!res.ok) return <ErrorPanel code={res.code} message={res.message} />;
  const { p, canEdit } = res.data;
  return (
    <>
      <PageHeader title="Settings" />
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {SECTIONS.map(([href, title, sub]) => (
          <Link key={href} href={href}><Card className="h-full p-4 hover:border-brand-300"><div className="font-medium">{title}</div><div className="mt-1 text-xs text-muted">{sub}</div></Card></Link>
        ))}
      </div>
      {p && canEdit && (
        <BusinessProfileForm
          logoUrl={p.logoFileId ? `/api/v1/files/${p.logoFileId}` : null}
          initial={{ name: p.name, legalName: p.legalName ?? "", businessType: p.businessType, gstin: p.gstin ?? "", pan: p.pan ?? "", phone: p.phone ?? "", email: (p.email as string) ?? "", line1: p.address.line1 ?? "", line2: p.address.line2 ?? "", city: p.address.city ?? "", pincode: p.address.pincode ?? "", stateCode: p.stateCode }}
        />
      )}
    </>
  );
}
