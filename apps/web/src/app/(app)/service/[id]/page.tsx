import Link from "next/link";
import { service } from "@cba/server";
import { formatDateIN, formatDateTimeIN, formatIndianPhone } from "@cba/core";
import { tenantOrError } from "@/lib/session";
import { TicketControls } from "@/components/service/forms";
import { technicians } from "@/components/service/load";
import { ActionButton } from "@/components/client";
import { Badge, Card, CardHeader, DefinitionList, ErrorPanel, Money, PageHeader, StatusBadge, Table, Td, Th } from "@/components/ui";

export const metadata = { title: "Service ticket" };

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await tenantOrError(async (t) => ({
    tk: await service.getTicket(t, id),
    techs: await technicians(t),
    can: { manage: t.can("service.create") && !t.isSupport, edit: t.can("service.edit") && !t.isSupport, invoice: t.can("invoices.create") && !t.isSupport },
  }));
  if (!res.ok) return <ErrorPanel code={res.code} message={res.message} />;
  const { tk, techs, can } = res.data;
  const parts = tk.parts as Array<Record<string, string | null>>;
  return (
    <>
      <PageHeader
        back={{ href: "/service", label: "Service tickets" }}
        title={<span className="flex items-center gap-3">{tk.number as string} <StatusBadge status={tk.status as string} /></span>}
        subtitle={<><Link className="text-brand-700" href={`/parties/${tk.partyId}`}>{tk.partyName as string}</Link> {tk.partyPhone ? `· ${formatIndianPhone(tk.partyPhone as string)}` : ""}</>}
      />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card className="p-5">
            <p className="whitespace-pre-line">{tk.issue as string}</p>
            <div className="mt-4">
              <DefinitionList
                items={[
                  ["Equipment", [tk.productName, tk.equipment].filter(Boolean).join(" — ")],
                  ["Serial number", tk.serialNumber as string],
                  ["Priority", <Badge key="p" color={tk.priority === "urgent" ? "red" : tk.priority === "high" ? "orange" : "gray"}>{tk.priority as string}</Badge>],
                  ["Coverage", tk.underWarranty ? "Under warranty" : tk.amcTitle ? `AMC: ${tk.amcTitle as string}` : "Chargeable"],
                  ["Technician", tk.assignedToName as string],
                  ["Visit", formatDateTimeIN(tk.scheduledAt as string)],
                  ["Service charge", <Money key="c" value={tk.serviceCharge as string} />],
                  ["Invoice", tk.invoiceId ? <Link key="i" className="text-brand-700" href={`/documents/invoice/${tk.invoiceId}`}>{(tk.invoiceNumber as string) ?? "Draft invoice"}</Link> : null],
                  ["Resolution", tk.resolution as string],
                ]}
              />
            </div>
          </Card>
          <Card>
            <CardHeader title="Spare parts" />
            {parts.length ? (
              <Table>
                <thead><tr><Th>Part</Th><Th align="right">Qty</Th><Th align="right">Price</Th><Th>Stock</Th><Th /></tr></thead>
                <tbody>
                  {parts.map((p) => (
                    <tr key={p.id!}>
                      <Td>{p.productName}</Td>
                      <Td align="right">{Number(p.quantity)} {p.unit}</Td>
                      <Td align="right"><Money value={p.unitPrice} /></Td>
                      <Td>{p.consumedAt ? <Badge color="green">Deducted</Badge> : <Badge>On completion</Badge>}</Td>
                      <Td align="right">{!p.consumedAt && can.edit ? <ActionButton size="sm" variant="ghost" method="DELETE" path={`service/tickets/${id}/parts/${p.id}`}>Remove</ActionButton> : null}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <p className="p-5 text-sm text-muted">No parts used.</p>
            )}
          </Card>
          <Card>
            <CardHeader title="Activity" />
            <ol className="space-y-3 p-5 text-sm">
              {(tk.events as Array<Record<string, string | null>>).map((e) => (
                <li key={e.id!} className="flex gap-3">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-500" />
                  <div>
                    <div className="text-xs text-muted">{formatDateTimeIN(e.createdAt)} · {e.createdByName}</div>
                    <div>{e.kind === "status" ? <>Status: {e.fromStatus?.replace("_", " ")} → <b>{e.toStatus?.replace("_", " ")}</b></> : e.kind === "assigned" ? "Technician changed" : null} {e.note}</div>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
          {(tk.history as unknown[]).length > 0 && (
            <Card>
              <CardHeader title="Service history" subtitle="Same customer or serial number" />
              <ul className="divide-y divide-line text-sm">
                {(tk.history as Array<Record<string, string>>).map((h) => (
                  <li key={h.id} className="flex justify-between gap-2 px-5 py-2.5"><Link className="text-brand-700" href={`/service/${h.id}`}>{h.number}</Link><span className="truncate text-muted">{h.issue}</span><span className="text-xs">{formatDateIN(h.createdAt)}</span></li>
                ))}
              </ul>
            </Card>
          )}
        </div>
        <TicketControls id={id} status={tk.status as string} assignedTo={tk.assignedTo as string | null} technicians={techs} canManage={can.manage} canInvoice={can.invoice} invoiced={!!tk.invoiceId} />
      </div>
    </>
  );
}
