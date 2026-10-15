import Link from "next/link";
import { tenantOrError } from "@/lib/session";
import { REPORTS } from "@/lib/reports-def";
import { Badge, Card, ErrorPanel, PageHeader } from "@/components/ui";

export const metadata = { title: "Reports" };

export default async function ReportsHub() {
  const res = await tenantOrError(async (t) => {
    t.require("reports.view");
    return { fin: t.can("financials.view"), adv: t.hasFeature("advanced_reports") };
  });
  if (!res.ok) return <ErrorPanel code={res.code} message={res.message} />;
  const groups = ["Financial", "Sales", "Purchases", "Inventory", "Tax", "Team"] as const;
  return (
    <>
      <PageHeader title="Reports" subtitle="Every figure links back to the transactions behind it. Download as CSV or PDF." />
      <div className="space-y-6">
        {groups.map((g) => {
          const items = Object.entries(REPORTS).filter(([, r]) => r.group === g);
          return (
            <section key={g}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">{g}</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {items.map(([k, r]) => (
                  <Link key={k} href={`/reports/${k}`}>
                    <Card className="h-full p-4 hover:border-brand-300">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{r.title}</span>
                        {r.advanced && !res.data.adv && <Badge color="orange">Pro</Badge>}
                      </div>
                      <p className="mt-1 text-sm text-muted">{r.description}</p>
                    </Card>
                  </Link>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
