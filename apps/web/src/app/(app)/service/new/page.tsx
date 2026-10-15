import { tenantOrError } from "@/lib/session";
import { TicketForm } from "@/components/service/forms";
import { technicians } from "@/components/service/load";
import { ErrorPanel, PageHeader } from "@/components/ui";

export const metadata = { title: "New service ticket" };

export default async function NewTicket() {
  const res = await tenantOrError(async (t) => {
    t.require("service.create");
    t.requireFeature("service");
    const amcs = await t.db.query<{ id: string; title: string; partyId: string; number: string }>(`select id, title, party_id as "partyId", number from amc_contracts where status = 'active' and end_date >= $1`, [t.today]);
    return { techs: await technicians(t), amcs };
  });
  if (!res.ok) return <ErrorPanel code={res.code} message={res.message} />;
  return (
    <>
      <PageHeader title="New service ticket" back={{ href: "/service", label: "Service tickets" }} />
      <TicketForm technicians={res.data.techs} amcs={res.data.amcs} />
    </>
  );
}
