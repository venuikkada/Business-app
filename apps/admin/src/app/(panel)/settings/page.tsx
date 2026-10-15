import { getPlatformSettings } from "@cba/server/platform";
import { requireAdmin } from "@/lib/session";
import { SettingRow } from "@/components/forms";
import { Card, CardHeader, PageHeader } from "@cba/ui";

export default async function Settings() {
  const a = await requireAdmin();
  const rows = (await getPlatformSettings(a)) as Array<{ key: string; value: unknown }>;
  return (
    <>
      <PageHeader title="Platform settings" />
      <Card>
        <CardHeader title="Policies" subtitle="max_unpaid_businesses_per_user limits free/trial businesses per person; grace_period_days and support_grant_hours tune billing and support." />
        <div className="divide-y divide-line">{rows.map((r) => <SettingRow key={r.key} k={r.key} value={r.value} />)}</div>
      </Card>
    </>
  );
}
