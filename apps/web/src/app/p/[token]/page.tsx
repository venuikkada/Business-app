import { notFound } from "next/navigation";
import { pdfs, camelize } from "@cba/server";
import { stateName, DOC_TYPE_META, type DocType, upiPaymentUri, formatINR } from "@cba/core";
import { DocumentPreview } from "@/components/documents/preview";
import { buttonClass } from "@/components/ui";

export const metadata = { title: "Document", robots: { index: false, follow: false } };

/** Public, read-only view of a shared document. The token is unguessable (192-bit). */
export default async function PublicDocument({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let data;
  try {
    data = await pdfs.publicDocument(token);
  } catch {
    notFound();
  }
  const d: Record<string, unknown> = { ...camelize<Record<string, unknown>>(data.document), items: camelize<Record<string, unknown>>(data.items) };
  const b = data.business as Record<string, string | null> & { settings?: Record<string, unknown> };
  const s = (b.settings ?? {}) as Record<string, string | null>;
  const type = d.docType as DocType;
  const noTax = DOC_TYPE_META[type].side === "sales" && (s.gstScheme ?? "regular") !== "regular";
  const upi = s.upiId && type === "invoice" && Number(d.balanceDue) > 0 && d.status !== "cancelled" ? upiPaymentUri({ upiId: s.upiId, payeeName: b.name!, amount: d.balanceDue as string, note: d.number as string }) : null;
  return (
    <main className="mx-auto max-w-4xl px-3 py-6 sm:py-10">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-muted">{DOC_TYPE_META[type].label} from <b className="text-ink">{b.name}</b></div>
        <div className="flex gap-2">
          {upi && <a className={buttonClass("primary")} href={upi}>Pay {formatINR(d.balanceDue as string)} by UPI</a>}
          <a className={buttonClass("secondary")} href={`/api/v1/public/documents/${token}/pdf`} target="_blank" rel="noopener">Download PDF</a>
        </div>
      </div>
      <DocumentPreview
        d={d}
        noTax={noTax}
        business={{ name: b.name!, gstin: b.gstin ?? null, phone: b.phone ?? null, address: [[b.address_line1, b.address_line2].filter(Boolean).join(", "), [b.city, b.state_code ? stateName(b.state_code) : null, b.pincode].filter(Boolean).join(", ")].filter(Boolean) }}
      />
      <p className="mt-6 text-center text-xs text-muted">Shared securely with CRAZY BUSINESS APP — One App. Complete Business Control.</p>
    </main>
  );
}
