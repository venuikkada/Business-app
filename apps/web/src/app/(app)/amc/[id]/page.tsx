import Link from "next/link";
import { service } from "@cba/server";
import { formatDateIN } from "@cba/core";
import { tenantOrError } from "@/lib/session";
import { ActionButton } from "@/components/client";
import { Card, CardHeader, DefinitionList, ErrorPanel, LinkButton, Money, PageHeader, StatusBadge } from "@/components/ui";

export const metadata = { title: "AMC contract" };

export default async function AmcView({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await tenantOrError(async (t) => ({ a: await service.getAmc(t, id), can: { manage: t.can("service.create") && !t.isSupport, del: t.can("service.delete") && !t.isSupport, invoice: t.can("invoices.create") && !t.isSupport } }));
  if (!res.ok) return <ErrorPanel code={res.code} message={res.message} />;
  const { a, can } = res.data;
  return (
    <>
      <PageHeader
        back={{ href: "/amc", label: "AMC contracts" }}
        title={<span className="flex items-center gap-3">{a.number as string} <StatusBadge status={a.status as string} /></span>}
        subtitle={<>{a.title as string} · <Link className="text-brand-700" href={`/parties/${a.partyId}`}>{a.partyName as string}</Link></>}
        actions={
          <>
            {can.manage && a.status === "active" && <LinkButton href={`/service/new`} variant="secondary">Log visit</LinkButton>}
            {can.invoice && !a.invoiceId && <ActionButton path={`amc/${id}/invoice`} variant="secondary" success="Draft invoice created" redirect="/documents/invoice/{id}/edit">Create invoice</ActionButton>}
            {can.manage && ["active", "expired"].includes(a.status as string) && <ActionButton path={`amc/${id}/renew`} body={{}} variant="primary" success="Renewed" redirect="/amc/{id}" confirm={{ title: "Renew for the same period?", body: "A new contract starts the day after this one ends, with the same value and visits." }}>Renew</ActionButton>}
            {can.del && a.status === "active" && <ActionButton path={`amc/${id}/cancel`} variant="danger" success="Cancelled" confirm={{ title: "Cancel this contract?", danger: true, confirmLabel: "Cancel contract" }}>Cancel</ActionButton>}
          </>
        }
      />
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <DefinitionList
            items={[
              ["Period", `${formatDateIN(a.startDate as string)} – ${formatDateIN(a.endDate as string)}`],
              ["Value", <Money key="v" value={a.amount as string} />],
              ["Visits", `${a.visitsUsed as number} used of ${a.visitsIncluded as number}`],
              ["Renewal reminder", `${a.reminderDaysBefore as number} days before expiry`],
              ["Invoice", a.invoiceId ? <Link key="i" className="text-brand-700" href={`/documents/invoice/${a.invoiceId}`}>{(a.invoiceNumber as string) ?? "Draft"}</Link> : "Not invoiced"],
              ["Covered equipment", a.coveredItems as string],
            ]}
          />
        </Card>
        <Card>
          <CardHeader title="Visits under this contract" />
          <ul className="divide-y divide-line text-sm">
            {(a.tickets as Array<Record<string, string>>).map((x) => (
              <li key={x.id} className="flex justify-between px-5 py-2.5"><Link className="text-brand-700" href={`/service/${x.id}`}>{x.number}</Link><StatusBadge status={x.status!} /></li>
            ))}
            {(a.tickets as unknown[]).length === 0 && <li className="px-5 py-3 text-muted">No visits yet.</li>}
          </ul>
        </Card>
      </div>
    </>
  );
}
