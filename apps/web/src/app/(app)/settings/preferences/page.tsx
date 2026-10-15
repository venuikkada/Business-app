import { tenantOrError } from "@/lib/session";
import { PreferencesForm } from "@/components/settings/forms";
import { ErrorPanel, PageHeader } from "@/components/ui";

export const metadata = { title: "Preferences" };

export default async function PreferencesPage() {
  const res = await tenantOrError(async (t) => {
    t.require("settings.edit");
    return t.settings;
  });
  if (!res.ok) return <ErrorPanel code={res.code} message={res.message} />;
  return (
    <>
      <PageHeader title="Invoice & GST preferences" back={{ href: "/settings", label: "Settings" }} />
      <PreferencesForm initial={res.data} />
    </>
  );
}
