import { parties } from "@cba/server";
import { formatIndianPhone } from "@cba/core";
import { tenantOrError } from "@/lib/session";
import { PartyForm, type PartyFormValue } from "@/components/parties/party-form";
import { ErrorPanel, PageHeader } from "@/components/ui";

export const metadata = { title: "Edit" };

export default async function EditParty({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await tenantOrError(async (t) => {
    t.require("parties.edit");
    return { p: await parties.getParty(t, id), fin: t.can("financials.view") };
  });
  if (!res.ok) return <ErrorPanel code={res.code} message={res.message} />;
  const { p, fin } = res.data;
  const a = (x: Record<string, unknown> | null) => ({ line1: (x?.line1 as string) ?? "", line2: (x?.line2 as string) ?? "", city: (x?.city as string) ?? "", stateCode: (x?.stateCode as string) ?? "", pincode: (x?.pincode as string) ?? "" });
  const ob = Number(p.openingBalance);
  const v: PartyFormValue = {
    name: p.name as string, isCustomer: !!p.isCustomer, isSupplier: !!p.isSupplier, contactPerson: (p.contactPerson as string) ?? "", phone: formatIndianPhone(p.phone as string), altPhone: formatIndianPhone(p.altPhone as string),
    email: (p.email as string) ?? "", gstin: (p.gstin as string) ?? "", pan: (p.pan as string) ?? "", billingAddress: a(p.billingAddress), shipSame: !p.shippingAddress, shippingAddress: a(p.shippingAddress),
    openingBalance: ob ? String(Math.abs(ob)) : "", openingSide: ob < 0 ? "payable" : "receivable", creditLimit: (p.creditLimit as string) ?? "", paymentTermsDays: p.paymentTermsDays != null ? String(p.paymentTermsDays) : "",
    notes: (p.notes as string) ?? "", tags: ((p.tags as string[]) ?? []).join(", "), whatsappOptIn: !!p.whatsappOptIn,
  };
  return (
    <>
      <PageHeader title={`Edit ${p.name as string}`} back={{ href: `/parties/${id}`, label: "Back" }} />
      <PartyForm id={id} initial={v} canEditOpening={fin} />
    </>
  );
}
