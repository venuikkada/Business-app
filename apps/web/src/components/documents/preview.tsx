import { amountInWords, formatDateIN, formatINR, stateName, DOC_TYPE_META, type DocType } from "@cba/core";

type Obj = Record<string, unknown>;
const addr = (a: Obj | null | undefined) =>
  a ? [[a.line1, a.line2].filter(Boolean).join(", "), [a.city, a.stateCode ? stateName(a.stateCode as string) : null, a.pincode].filter(Boolean).join(", ")].filter(Boolean) : [];

/** On-screen rendition of a document (the PDF is generated on the server separately). */
export function DocumentPreview({ d, business, noTax }: { d: Obj; business: { name: string; gstin: string | null; address: string[]; phone: string | null }; noTax: boolean }) {
  const type = d.docType as DocType;
  const items = d.items as Obj[];
  const inter = d.isInterState as boolean;
  const title = type === "invoice" ? (noTax ? "Bill of Supply" : business.gstin ? "Tax Invoice" : "Invoice") : DOC_TYPE_META[type].label;
  const sales = DOC_TYPE_META[type].side === "sales";
  return (
    <div className="relative overflow-hidden rounded-[14px] border border-line bg-white">
      <div className="h-1.5 bg-brand-600" />
      {d.status === "cancelled" && <div className="pointer-events-none absolute inset-0 grid place-items-center text-6xl font-bold text-red-600/10 sm:text-8xl">CANCELLED</div>}
      {d.status === "draft" && <div className="pointer-events-none absolute inset-0 grid place-items-center text-6xl font-bold text-stone-400/15 sm:text-8xl">DRAFT</div>}
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:justify-between sm:p-7">
        <div>
          <div className="text-lg font-semibold">{business.name}</div>
          <div className="mt-1 text-xs leading-5 text-muted">
            {business.address.map((l, i) => <div key={i}>{l}</div>)}
            {business.gstin && <div>GSTIN: {business.gstin}</div>}
            {business.phone && <div>{business.phone}</div>}
          </div>
        </div>
        <div className="sm:text-right">
          <div className="text-lg font-semibold uppercase tracking-wide text-brand-700">{title}</div>
          <div className="mt-1 text-sm">
            <div><span className="text-muted">No. </span><span className="font-medium">{(d.number as string) ?? "Draft"}</span></div>
            <div><span className="text-muted">Date </span>{formatDateIN(d.issueDate as string)}</div>
            {d.dueDate ? <div><span className="text-muted">Due </span>{formatDateIN(d.dueDate as string)}</div> : null}
            {d.validUntil ? <div><span className="text-muted">Valid until </span>{formatDateIN(d.validUntil as string)}</div> : null}
            {sales && <div><span className="text-muted">Place of supply </span>{stateName(d.placeOfSupply as string)}</div>}
            {d.supplierInvoiceNumber ? <div><span className="text-muted">Supplier bill </span>{d.supplierInvoiceNumber as string}</div> : null}
          </div>
        </div>
      </div>
      <div className="grid gap-4 px-5 sm:grid-cols-2 sm:px-7">
        <div className="rounded-xl border border-line p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-brand-700">{sales ? "Bill to" : "Supplier"}</div>
          <div className="mt-1 font-medium">{d.partyName as string}</div>
          <div className="text-xs leading-5 text-muted">
            {addr(d.partyBillingAddress as Obj).map((l, i) => <div key={i}>{l}</div>)}
            {d.partyGstin ? <div>GSTIN: {d.partyGstin as string}</div> : null}
            {d.partyPhone ? <div>{d.partyPhone as string}</div> : null}
          </div>
        </div>
        {d.partyShippingAddress ? (
          <div className="rounded-xl border border-line p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-brand-700">Ship to</div>
            <div className="text-xs leading-5 text-muted">{addr(d.partyShippingAddress as Obj).map((l, i) => <div key={i}>{l}</div>)}</div>
          </div>
        ) : null}
      </div>
      <div className="mt-5 overflow-x-auto px-2 sm:px-4">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="bg-brand-50 text-left text-xs uppercase tracking-wide text-stone-600">
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Item</th>
              <th className="px-3 py-2">HSN/SAC</th>
              <th className="px-3 py-2 text-right">Qty</th>
              <th className="px-3 py-2 text-right">Rate</th>
              <th className="px-3 py-2 text-right">Disc.</th>
              {!noTax && <th className="px-3 py-2 text-right">GST</th>}
              <th className="px-3 py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i, n) => (
              <tr key={i.id as string} className="border-b border-line/70 align-top">
                <td className="px-3 py-2.5 text-muted">{n + 1}</td>
                <td className="px-3 py-2.5">
                  <div className="font-medium">{i.description as string}</div>
                  {(i.serialNumbers as string[])?.length ? <div className="text-xs text-muted">S/N: {(i.serialNumbers as string[]).join(", ")}</div> : null}
                </td>
                <td className="px-3 py-2.5 text-muted">{(i.hsnCode as string) ?? ""}</td>
                <td className="px-3 py-2.5 text-right tabular">{Number(i.quantity)} {i.unit as string}</td>
                <td className="px-3 py-2.5 text-right tabular">{formatINR(i.unitPrice as string)}</td>
                <td className="px-3 py-2.5 text-right tabular">{Number(i.lineDiscount) ? formatINR(i.lineDiscount as string) : "—"}</td>
                {!noTax && <td className="px-3 py-2.5 text-right">{Number(i.taxRate)}%</td>}
                <td className="px-3 py-2.5 text-right font-medium tabular">{formatINR(i.total as string)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-5 p-5 sm:grid-cols-2 sm:p-7">
        <div className="text-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-muted">Amount in words</div>
          <div className="mt-1">{amountInWords(d.grandTotal as string)}</div>
          {d.notes ? <div className="mt-4"><div className="text-xs font-medium uppercase tracking-wide text-muted">Notes</div><p className="mt-1 whitespace-pre-line">{d.notes as string}</p></div> : null}
          {d.terms ? <div className="mt-4"><div className="text-xs font-medium uppercase tracking-wide text-muted">Terms</div><p className="mt-1 whitespace-pre-line text-xs text-muted">{d.terms as string}</p></div> : null}
        </div>
        <dl className="space-y-1.5 text-sm sm:ml-auto sm:w-72">
          {Number(d.lineDiscountTotal) + Number(d.documentDiscount) > 0 && <Line k="Discount" v={`-${(Number(d.lineDiscountTotal) + Number(d.documentDiscount)).toFixed(2)}`} />}
          {Number(d.additionalCharges) > 0 && <Line k={(d.additionalChargesLabel as string) || "Charges"} v={d.additionalCharges as string} />}
          {!noTax && <Line k="Taxable value" v={d.taxableTotal as string} />}
          {!noTax && (inter ? <Line k="IGST" v={d.igstTotal as string} /> : (<><Line k="CGST" v={d.cgstTotal as string} /><Line k="SGST" v={d.sgstTotal as string} /></>))}
          {Number(d.roundOff) !== 0 && <Line k="Round off" v={d.roundOff as string} />}
          <div className="flex justify-between rounded-lg bg-brand-50 px-3 py-2 text-base font-semibold">
            <dt>Total</dt>
            <dd className="tabular text-brand-700">{formatINR(d.grandTotal as string)}</dd>
          </div>
          {(type === "invoice" || type === "purchase_bill") && Number(d.amountSettled) > 0 && (
            <>
              <Line k="Paid / adjusted" v={d.amountSettled as string} />
              <div className="flex justify-between font-semibold"><dt>Balance due</dt><dd className="tabular">{formatINR(d.balanceDue as string)}</dd></div>
            </>
          )}
        </dl>
      </div>
    </div>
  );
}

function Line({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-muted">{k}</dt>
      <dd className="tabular">{formatINR(v)}</dd>
    </div>
  );
}
