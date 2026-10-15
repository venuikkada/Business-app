import Link from "next/link";
import { payments } from "@cba/server";
import { formatDateIN, formatDateTimeIN, PAYMENT_METHOD_LABEL, DOC_TYPE_META, receiptMessage, whatsappLink, type DocType } from "@cba/core";
import { tenantOrError } from "@/lib/session";
import { ActionButton } from "@/components/client";
import { Card, CardHeader, DefinitionList, ErrorPanel, Money, PageHeader, StatusBadge, buttonClass } from "@/components/ui";

export const metadata = { title: "Payment" };

export default async function PaymentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await tenantOrError(async (t) => ({
    p: await payments.getPayment(t, id),
    business: t.business.name,
    can: { void: t.can("payments.delete") && !t.isSupport, pdf: t.hasFeature("pdf") },
  }));
  if (!res.ok) return <ErrorPanel code={res.code} message={res.message} />;
  const { p, business, can } = res.data;
  const wa = p.direction === "in" && p.status === "active" ? whatsappLink(p.partyPhone as string | null, receiptMessage({ businessName: business, customerName: p.partyName as string, amount: p.amount as string, number: p.number as string, date: p.paidOn as string })) : null;
  return (
    <>
      <PageHeader
        back={{ href: `/payments?direction=${p.direction}`, label: "Payments" }}
        title={<span className="flex items-center gap-3">{p.number as string} <StatusBadge status={p.status as string} /></span>}
        subtitle={<>{p.direction === "in" ? "Received from" : "Paid to"} <Link className="text-brand-700" href={`/parties/${p.partyId}`}>{p.partyName as string}</Link></>}
        actions={
          <>
            {can.pdf && <a className={buttonClass("secondary")} href={`/api/v1/payments/${id}/pdf`} target="_blank" rel="noopener">Receipt PDF</a>}
            {wa && <a className={buttonClass("secondary")} href={wa} target="_blank" rel="noopener">WhatsApp</a>}
            {can.void && p.status === "active" && (
              <ActionButton variant="danger" path={`payments/${id}/void`} success="Payment voided" confirm={{ title: "Void this payment?", body: "Invoices it settled become unpaid again. The receipt number is kept and marked void.", danger: true, confirmLabel: "Void payment", reason: { label: "Reason (e.g. cheque bounced)", minLength: 3 } }}>
                Void
              </ActionButton>
            )}
          </>
        }
      />
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <div className="mb-5 text-3xl font-semibold"><Money value={p.amount as string} className={p.direction === "in" ? "text-emerald-700" : ""} /></div>
          <DefinitionList
            items={[
              ["Date", formatDateIN(p.paidOn as string)],
              ["Mode", PAYMENT_METHOD_LABEL[p.method as string]],
              ["Account", p.accountName as string],
              ["Reference", p.reference as string],
              ["Notes", p.notes as string],
              ["Recorded by", `${(p.createdByName as string) ?? ""} · ${formatDateTimeIN(p.createdAt as string)}`],
              ...(p.status === "void" ? [["Voided", `${formatDateTimeIN(p.voidedAt as string)} — ${p.voidReason as string}`] as [string, string]] : []),
            ]}
          />
        </Card>
        <Card>
          <CardHeader title="Adjusted against" />
          <ul className="divide-y divide-line text-sm">
            {(p.allocations as Array<Record<string, string>>).map((a) => (
              <li key={a.id} className="flex justify-between px-5 py-2.5">
                <Link className="text-brand-700" href={`/documents/${a.docType}/${a.documentId}`}>{DOC_TYPE_META[a.docType as DocType].label} {a.number}</Link>
                <Money value={a.amount} />
              </li>
            ))}
            {Number(p.unallocated) > 0 && (
              <li className="flex justify-between px-5 py-2.5 text-muted"><span>Advance (not adjusted)</span><Money value={p.unallocated as string} /></li>
            )}
          </ul>
        </Card>
      </div>
    </>
  );
}
