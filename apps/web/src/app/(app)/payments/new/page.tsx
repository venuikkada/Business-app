import { finance, parties } from "@cba/server";
import { tenantOrError } from "@/lib/session";
import { PaymentForm } from "@/components/money/payment-form";
import { ErrorPanel, PageHeader } from "@/components/ui";

export const metadata = { title: "Record payment" };

export default async function NewPayment({ searchParams }: { searchParams: Promise<{ direction?: string; partyId?: string; documentId?: string }> }) {
  const sp = await searchParams;
  const direction = sp.direction === "out" ? "out" : "in";
  const res = await tenantOrError(async (t) => {
    t.require("payments.create");
    const party = sp.partyId && /^[0-9a-f-]{36}$/.test(sp.partyId) ? await parties.getParty(t, sp.partyId).catch(() => null) : null;
    const accounts = t.can("accounts.view") ? ((await finance.listAccounts(t)) as Array<{ id: string; name: string; type: string; isDefault: boolean; archivedAt: string | null }>).filter((a) => !a.archivedAt) : [];
    return { today: t.today, party: party ? { id: party.id as string, name: party.name as string } : null, accounts };
  });
  if (!res.ok) return <ErrorPanel code={res.code} message={res.message} />;
  return (
    <>
      <PageHeader title={direction === "in" ? "Receive payment" : "Make payment"} back={{ href: `/payments?direction=${direction}`, label: "Payments" }} />
      <PaymentForm direction={direction} today={res.data.today} party={res.data.party} documentId={sp.documentId} accounts={res.data.accounts} />
    </>
  );
}
