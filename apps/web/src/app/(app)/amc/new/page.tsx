import { tenantOrError } from "@/lib/session";
import { AmcForm } from "@/components/service/forms";
import { ErrorPanel, PageHeader } from "@/components/ui";

export const metadata = { title: "New AMC" };

export default async function NewAmc() {
  const res = await tenantOrError(async (t) => {
    t.require("service.create");
    t.requireFeature("service");
    return t.today;
  });
  if (!res.ok) return <ErrorPanel code={res.code} message={res.message} />;
  return (
    <>
      <PageHeader title="New AMC contract" back={{ href: "/amc", label: "AMC contracts" }} />
      <AmcForm today={res.data} />
    </>
  );
}
