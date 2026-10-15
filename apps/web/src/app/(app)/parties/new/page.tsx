import { tenantOrError } from "@/lib/session";
import { PartyForm } from "@/components/parties/party-form";
import { blankParty } from "@/components/parties/defaults";
import { ErrorPanel, PageHeader } from "@/components/ui";

export const metadata = { title: "Add customer" };

export default async function NewParty({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const { kind } = await searchParams;
  const res = await tenantOrError(async (t) => {
    t.require("parties.create");
    return { state: t.business.state_code, fin: t.can("financials.view") };
  });
  if (!res.ok) return <ErrorPanel code={res.code} message={res.message} />;
  const k = kind === "supplier" ? "supplier" : "customer";
  return (
    <>
      <PageHeader title={`Add ${k}`} back={{ href: "/parties", label: "Customers & suppliers" }} />
      <PartyForm initial={blankParty(k, res.data.state)} canEditOpening />
    </>
  );
}
