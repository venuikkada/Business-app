import Link from "next/link";
import { parties, documents } from "@cba/server";
import { formatDateIN, formatIndianPhone, stateName, DOC_TYPE_META, type DocType } from "@cba/core";
import { tenantOrError } from "@/lib/session";
import { qs } from "@/lib/fmt";
import { ActionButton, OpenLinkButton } from "@/components/client";
import { Interactions } from "@/components/parties/interactions";
import { Badge, Card, CardHeader, DefinitionList, ErrorPanel, LinkButton, Money, PageHeader, Stat, StatusBadge, Table, Tabs, Td, Th } from "@/components/ui";

export const metadata = { title: "Customer" };

export default async function PartyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; from?: string; to?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const tab = sp.tab ?? "overview";
  const res = await tenantOrError(async (t) => {
    const p = await parties.getParty(t, id);
    const types = (["invoice", "quotation", "sales_order", "credit_note", "purchase_bill", "purchase_order"] as DocType[]).filter((x) => t.can(`${x === "quotation" ? "quotations" : x === "sales_order" ? "sales_orders" : x.startsWith("purchase") ? "purchases" : "invoices"}.view` as never));
    return {
      p,
      today: t.today,
      docs: tab === "overview" && types.length ? await documents.listDocuments(t, types, { partyId: id, pageSize: 15 }) : null,
      ledger: tab === "ledger" && t.can("payments.view") ? await parties.partyLedger(t, id, sp.from, sp.to) : null,
      interactions: tab === "interactions" ? ((await parties.listInteractions(t, id)) as Array<Record<string, string | null>>) : null,
      can: {
        edit: t.can("parties.edit") && !t.isSupport, del: t.can("parties.delete") && !t.isSupport, invoice: t.can("invoices.create"), quote: t.can("quotations.create"),
        pay: t.can("payments.create"), payView: t.can("payments.view"), remind: t.hasFeature("reminders") && t.can("payments.view"), bill: t.can("purchases.create") && t.hasFeature("purchases"),
      },
    };
  });
  if (!res.ok) return <ErrorPanel code={res.code} message={res.message} />;
  const { p, docs, ledger, interactions, can, today } = res.data;
  const bal = Number(p.balance);
  const stats = p.stats as Record<string, string | number>;
  const ba = p.billingAddress;
  return (
    <>
      <PageHeader
        back={{ href: "/parties", label: "Customers & suppliers" }}
        title={<span className="flex flex-wrap items-center gap-2">{p.name as string} {p.archivedAt ? <Badge>Archived</Badge> : null}</span>}
        subtitle={[p.phone ? formatIndianPhone(p.phone as string) : null, p.gstin as string | null, ba.city].filter(Boolean).join(" · ")}
        actions={
          <>
            {p.isCustomer && can.invoice ? <LinkButton href={`/documents/new?type=invoice&partyId=${id}`}>New invoice</LinkButton> : null}
            {p.isCustomer && can.quote ? <LinkButton variant="secondary" href={`/documents/new?type=quotation&partyId=${id}`}>Quotation</LinkButton> : null}
            {p.isSupplier && can.bill ? <LinkButton variant="secondary" href={`/documents/new?type=purchase_bill&partyId=${id}`}>Purchase bill</LinkButton> : null}
            {can.pay && bal !== 0 ? <LinkButton variant="secondary" href={`/payments/new?direction=${bal > 0 ? "in" : "out"}&partyId=${id}`}>{bal > 0 ? "Receive payment" : "Make payment"}</LinkButton> : null}
            {can.remind && bal > 0 && p.phone ? (
              <OpenLinkButton path={`parties/${id}/reminder`} field="url" variant="secondary">WhatsApp reminder</OpenLinkButton>
            ) : null}
            {can.edit && <LinkButton variant="ghost" href={`/parties/${id}/edit`}>Edit</LinkButton>}
          </>
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {can.payView && <Stat label={bal >= 0 ? "To collect" : "To pay"} value={<Money value={Math.abs(bal).toFixed(2)} />} tone={bal > 0 ? "brand" : "default"} hint={Number(stats.overdueAmount) > 0 ? <span className="text-red-700">Overdue ₹{stats.overdueAmount}</span> : undefined} />}
        {p.isCustomer ? <Stat label="Total sales" value={<Money value={stats.totalSales as string} />} hint={`${stats.invoiceCount} invoices`} /> : null}
        {p.isSupplier ? <Stat label="Total purchases" value={<Money value={stats.totalPurchases as string} />} /> : null}
        <Stat label="Last invoice" value={<span className="text-base">{formatDateIN(stats.lastInvoiceDate as string) || "—"}</span>} />
      </div>
      <Tabs
        active={tab}
        tabs={[
          { key: "overview", label: "Overview", href: `/parties/${id}` },
          ...(can.payView ? [{ key: "ledger", label: "Statement", href: `/parties/${id}?tab=ledger` }] : []),
          { key: "interactions", label: "Interactions & follow-ups", href: `/parties/${id}?tab=interactions` },
          { key: "details", label: "Details", href: `/parties/${id}?tab=details` },
        ]}
      />
      {tab === "overview" && docs && (
        <Card>
          <CardHeader title="Recent documents" />
          {docs.items.length ? (
            <Table>
              <thead><tr><Th>Document</Th><Th>Date</Th><Th align="right">Amount</Th><Th align="right">Balance</Th><Th>Status</Th></tr></thead>
              <tbody>
                {docs.items.map((d) => (
                  <tr key={d.id as string} className="hover:bg-stone-50">
                    <Td><Link className="font-medium text-brand-700" href={`/documents/${d.docType}/${d.id}`}>{DOC_TYPE_META[d.docType as DocType].label} {(d.number as string) ?? "(draft)"}</Link></Td>
                    <Td>{formatDateIN(d.issueDate as string)}</Td>
                    <Td align="right"><Money value={d.grandTotal as string} /></Td>
                    <Td align="right">{["invoice", "purchase_bill"].includes(d.docType as string) ? <Money value={d.balanceDue as string} /> : "—"}</Td>
                    <Td><StatusBadge status={d.status as string} overdue={!!d.isOverdue} /></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <p className="p-5 text-sm text-muted">No documents yet.</p>
          )}
        </Card>
      )}
      {tab === "ledger" && ledger && (
        <Card>
          <CardHeader
            title="Account statement"
            subtitle="Debit = billed to them / paid to them; Credit = received from them / billed by them"
            action={
              <form className="flex gap-2 text-sm" method="get">
                <input type="hidden" name="tab" value="ledger" />
                <input type="date" name="from" defaultValue={sp.from} className="h-8 rounded-lg border border-line px-2" aria-label="From" />
                <input type="date" name="to" defaultValue={sp.to} className="h-8 rounded-lg border border-line px-2" aria-label="To" />
                <button className="h-8 rounded-lg border border-line px-3">Go</button>
              </form>
            }
          />
          <Table>
            <thead><tr><Th>Date</Th><Th>Particulars</Th><Th align="right">Debit</Th><Th align="right">Credit</Th><Th align="right">Balance</Th></tr></thead>
            <tbody>
              <tr><Td /><Td className="font-medium">Opening balance</Td><Td /><Td /><Td align="right"><Money value={ledger.openingBalance} /></Td></tr>
              {(ledger.entries as Array<Record<string, string>>).map((e, i) => (
                <tr key={i}>
                  <Td className="whitespace-nowrap">{formatDateIN(e.entryDate)}</Td>
                  <Td>
                    {e.refId && e.kind?.startsWith("payment") ? <Link className="text-brand-700" href={`/payments/${e.refId}`}>{e.refNumber}</Link> : e.refId ? <Link className="text-brand-700" href={`/documents/${e.kind}/${e.refId}`}>{e.refNumber}</Link> : e.refNumber}
                    <span className="ml-2 text-xs text-muted">{e.kind?.replace("_", " ")}</span>
                  </Td>
                  <Td align="right">{Number(e.debit) ? <Money value={e.debit} /> : ""}</Td>
                  <Td align="right">{Number(e.credit) ? <Money value={e.credit} /> : ""}</Td>
                  <Td align="right"><Money value={e.balance} /></Td>
                </tr>
              ))}
              <tr className="bg-stone-50 font-semibold"><Td /><Td>Closing balance</Td><Td /><Td /><Td align="right"><Money value={ledger.closingBalance} /></Td></tr>
            </tbody>
          </Table>
        </Card>
      )}
      {tab === "interactions" && interactions && <Interactions partyId={id} items={interactions} canEdit={can.edit} today={today} />}
      {tab === "details" && (
        <Card className="p-5">
          <DefinitionList
            items={[
              ["Contact person", p.contactPerson as string],
              ["Email", p.email as string],
              ["Alternate phone", formatIndianPhone(p.altPhone as string)],
              ["PAN", p.pan as string],
              ["Billing address", [ba.line1, ba.line2, ba.city, ba.stateCode ? stateName(ba.stateCode) : null, ba.pincode].filter(Boolean).join(", ")],
              ["Shipping address", p.shippingAddress ? [p.shippingAddress.line1, p.shippingAddress.city, p.shippingAddress.pincode].filter(Boolean).join(", ") : "Same as billing"],
              ["Credit limit", p.creditLimit ? <Money value={p.creditLimit as string} /> : null],
              ["Payment terms", p.paymentTermsDays != null ? `${p.paymentTermsDays} days` : "Business default"],
              ["WhatsApp consent", p.whatsappOptIn ? "Yes" : "Not recorded"],
              ["Tags", ((p.tags as string[]) ?? []).join(", ")],
              ["Notes", p.notes as string],
            ]}
          />
          {can.del && (
            <div className="mt-6 flex gap-2 border-t border-line pt-4">
              <ActionButton path={`parties/${id}/${p.archivedAt ? "unarchive" : "archive"}`} variant="secondary" success={p.archivedAt ? "Restored" : "Archived"}>{p.archivedAt ? "Unarchive" : "Archive"}</ActionButton>
              <ActionButton method="DELETE" path={`parties/${id}`} variant="danger" redirect={`/parties${qs({})}`} success="Deleted" confirm={{ title: "Delete permanently?", body: "Only possible when there are no transactions. Otherwise archive instead.", danger: true, confirmLabel: "Delete" }}>Delete</ActionButton>
            </div>
          )}
        </Card>
      )}
    </>
  );
}
