import Link from "next/link";
import { documents } from "@cba/server";
import { CONVERSIONS, DOC_TYPE_META, formatDateIN, formatDateTimeIN, stateName, PAYMENT_METHOD_LABEL, type DocType } from "@cba/core";
import { tenantOrError } from "@/lib/session";
import { DocumentActions } from "@/components/documents/actions";
import { DocumentPreview } from "@/components/documents/preview";
import { docPermFor } from "@/components/documents/perm";
import { Card, CardHeader, ErrorPanel, Money, PageHeader, StatusBadge } from "@/components/ui";

export const metadata = { title: "Document" };

export default async function DocumentView({ params }: { params: Promise<{ type: string; id: string }> }) {
  const { id } = await params;
  const res = await tenantOrError(async (t) => {
    const d = await documents.getDocument(t, id);
    const type = d.docType as DocType;
    const approval = await t.db.maybe<{ id: string; status: string; reason: string }>(
      "select id, status, reason from approval_requests where entity_id = $1 and kind = 'discount' and status in ('pending','approved') order by created_at desc limit 1",
      [id],
    );
    const b = t.business;
    return {
      d,
      type,
      approval,
      noTax: DOC_TYPE_META[type].side === "sales" && t.settings.gstScheme !== "regular",
      business: { name: b.name, gstin: (d.branchGstin as string) ?? b.gstin, phone: b.phone, address: [[b.address_line1, b.address_line2].filter(Boolean).join(", "), [b.city, stateName(b.state_code), b.pincode].filter(Boolean).join(", ")].filter(Boolean) },
      perms: {
        create: t.can(docPermFor(type, "create")) && !t.isSupport,
        edit: t.can(docPermFor(type, "edit")) && !t.isSupport,
        del: t.can(docPermFor(type, "delete")) && !t.isSupport,
        pay: t.can("payments.create") && !t.isSupport,
        pdf: t.hasFeature("pdf"),
        convertTo: (CONVERSIONS[type] ?? []).filter((x) => t.can(docPermFor(x, "create")) && (DOC_TYPE_META[x].side === "sales" || t.hasFeature("purchases"))),
      },
      fin: t.can("financials.view"),
    };
  });
  if (!res.ok) return <ErrorPanel code={res.code} message={res.message} />;
  const { d, type, approval, business, perms, noTax, fin } = res.data;
  const meta = DOC_TYPE_META[type];
  const allocations = d.allocations as Array<Record<string, string>>;
  const children = d.children as Array<Record<string, string>>;
  return (
    <>
      <PageHeader
        back={{ href: `/documents/${type}`, label: meta.plural }}
        title={<span className="flex items-center gap-3">{(d.number as string) ?? `Draft ${meta.label.toLowerCase()}`} <StatusBadge status={d.status as string} overdue={!!d.isOverdue} /></span>}
        subtitle={<>{d.partyName as string} · <Money value={d.grandTotal as string} /> · {formatDateIN(d.issueDate as string)}</>}
        actions={<DocumentActions id={id} type={type} status={d.status as string} partyId={d.partyId as string} balanceDue={d.balanceDue as string} perms={perms} approval={approval} hasShareToken={!!d.shareToken} />}
      />
      {approval?.status === "pending" && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">Waiting for owner/manager approval: {approval.reason}</div>
      )}
      {approval?.status === "approved" && d.status === "draft" && (
        <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">Approved. You can issue this document now.</div>
      )}
      {d.status === "cancelled" && (
        <div className="mb-4 rounded-xl border border-line bg-stone-50 px-4 py-3 text-sm">Cancelled on {formatDateTimeIN(d.cancelledAt as string)} — {d.cancelReason as string}</div>
      )}
      <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
        <DocumentPreview d={d} business={business} noTax={noTax} />
        <div className="space-y-5">
          {(type === "invoice" || type === "purchase_bill" || type === "credit_note" || type === "debit_note") && d.status !== "draft" && (
            <Card>
              <CardHeader title="Payments & adjustments" />
              {allocations.length ? (
                <ul className="divide-y divide-line text-sm">
                  {allocations.map((a) => (
                    <li key={a.id} className="flex items-center justify-between px-5 py-2.5">
                      {a.paymentId ? (
                        <Link href={`/payments/${a.paymentId}`} className={a.paymentStatus === "void" ? "text-muted line-through" : "hover:text-brand-700"}>
                          {a.paymentNumber} · {PAYMENT_METHOD_LABEL[a.method!]} · {formatDateIN(a.paidOn)}
                        </Link>
                      ) : (
                        <Link href={`/documents/${a.creditType}/${a.creditDocumentId === id ? a.targetId : a.creditDocumentId}`} className="hover:text-brand-700">
                          {a.creditDocumentId === id ? `Applied to ${a.targetNumber}` : `${a.creditNumber} (${DOC_TYPE_META[a.creditType as DocType]?.label})`}
                        </Link>
                      )}
                      <Money value={a.amount} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-5 py-4 text-sm text-muted">No payments recorded yet.</p>
              )}
              <div className="flex justify-between border-t border-line px-5 py-3 text-sm font-medium">
                <span>Balance</span>
                <Money value={d.balanceDue as string} />
              </div>
            </Card>
          )}
          {fin && d.grossProfit !== undefined && (
            <Card className="p-5">
              <div className="text-xs font-medium uppercase tracking-wide text-muted">Gross profit (estimate)</div>
              <div className="mt-1 text-xl font-semibold"><Money value={d.grossProfit as string} /></div>
              <p className="mt-1 text-xs text-muted">Taxable value <Money value={d.taxableTotal as string} /> − cost <Money value={d.costTotal as string} /> (weighted average cost at sale)</p>
            </Card>
          )}
          {(children.length > 0 || !!d.sourceNumber) && (
            <Card>
              <CardHeader title="Related documents" />
              <ul className="divide-y divide-line text-sm">
                {d.sourceNumber ? (
                  <li className="px-5 py-2.5">
                    From <Link className="font-medium text-brand-700" href={`/documents/${d.sourceType}/${d.sourceDocumentId}`}>{DOC_TYPE_META[d.sourceType as DocType].label} {d.sourceNumber as string}</Link>
                  </li>
                ) : null}
                {children.map((c) => (
                  <li key={c.id} className="flex items-center justify-between px-5 py-2.5">
                    <Link className="text-brand-700" href={`/documents/${c.docType}/${c.id}`}>{DOC_TYPE_META[c.docType as DocType].label} {c.number ?? "(draft)"}</Link>
                    <StatusBadge status={c.status!} />
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card className="p-5 text-xs text-muted">
            <div>Created by {(d.createdByName as string) ?? "—"} on {formatDateTimeIN(d.createdAt as string)}</div>
            {d.finalizedAt ? <div className="mt-1">Issued on {formatDateTimeIN(d.finalizedAt as string)}</div> : null}
            {d.sentAt ? <div className="mt-1">Last shared {formatDateTimeIN(d.sentAt as string)}</div> : null}
            <div className="mt-1">Branch: {d.branchName as string}</div>
          </Card>
        </div>
      </div>
    </>
  );
}
