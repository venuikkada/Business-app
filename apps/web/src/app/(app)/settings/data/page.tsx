import Link from "next/link";
import { tenantOrError } from "@/lib/session";
import { DangerCard } from "@/components/settings/account";
import { Card, CardHeader, ErrorPanel, PageHeader, buttonClass } from "@/components/ui";

export const metadata = { title: "Data" };

export default async function DataPage() {
  const res = await tenantOrError(async (t) => ({ name: t.business.name, canExport: t.can("data.export") && t.hasFeature("data_export"), canImport: t.can("data.create"), canDelete: t.can("data.delete") && !t.isSupport }));
  if (!res.ok) return <ErrorPanel code={res.code} message={res.message} />;
  const d = res.data;
  return (
    <>
      <PageHeader back={{ href: "/settings", label: "Settings" }} title="Data, export & deletion" subtitle="Your data belongs to you. Export it any time." />
      <div className="space-y-5">
        <Card>
          <CardHeader title="Export everything" subtitle="A ZIP of CSV files: customers, products, stock ledger, invoices and items, payments, expenses, accounts, service tickets and the audit log." />
          <div className="p-5">{d.canExport ? <a className={buttonClass("primary")} href="/api/v1/export">Download full export (.zip)</a> : <p className="text-sm text-muted">Only the owner, administrator or accountant can export.</p>}</div>
        </Card>
        {d.canImport && (
          <Card>
            <CardHeader title="Import" subtitle="Bring your existing data from Excel / other software via CSV. Every file is checked before anything is saved." />
            <div className="flex flex-wrap gap-2 p-5">
              <Link className={buttonClass("secondary")} href="/parties/import">Import customers & suppliers</Link>
              <Link className={buttonClass("secondary")} href="/products/import">Import products & opening stock</Link>
            </div>
          </Card>
        )}
        <Card>
          <CardHeader title="Retention & privacy" />
          <ul className="list-disc space-y-1 p-5 pl-9 text-sm text-muted">
            <li>Your records are isolated from other businesses at the database level (row-level security).</li>
            <li>Backup retention depends on how this service is hosted. The recommended setup keeps encrypted backups for up to 35 days, after which deleted data no longer exists in backups.</li>
            <li>Platform staff cannot see your records unless you approve time-limited support access (Settings → Help & support).</li>
          </ul>
        </Card>
        {d.canDelete && <DangerCard kind="business" businessName={d.name} />}
      </div>
    </>
  );
}
