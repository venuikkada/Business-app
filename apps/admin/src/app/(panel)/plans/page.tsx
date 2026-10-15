import { listPlans } from "@cba/server/platform";
import { requireAdmin } from "@/lib/session";
import { PlanEditor } from "@/components/forms";
import { PageHeader } from "@cba/ui";

export default async function Plans() {
  const a = await requireAdmin();
  const plans = (await listPlans(a)) as Array<Parameters<typeof PlanEditor>[0]["plan"] & { subscribers: number }>;
  return (
    <>
      <PageHeader title="Plans & pricing" subtitle="Prices are hypotheses — test them with real customers. Limits and features are enforced by the server immediately." />
      <div className="space-y-5">
        {plans.map((p) => <PlanEditor key={p!.code} plan={p} />)}
        <PlanEditor plan={null} />
      </div>
    </>
  );
}
