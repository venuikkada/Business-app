import "server-only";
import type { Tenant } from "@cba/server";
import { documents, parties } from "@cba/server";
import { addDays, type DocType } from "@cba/core";
import type { EditorInitial, EditorParty } from "./editor";
import { docPermFor } from "./perm";

export async function editorContext(t: Tenant, type: DocType) {
  const branch = await t.db.one<{ state_code: string }>("select state_code from branches where id = $1", [t.defaultBranchId]);
  return {
    branchState: branch.state_code,
    gstScheme: t.settings.gstScheme,
    canFinalize: t.can(docPermFor(type, "create")),
    canSeeCost: t.can("financials.view"),
    canOverrideStock: t.can("inventory.approve"),
  };
}

export async function partyForEditor(t: Tenant, id: string): Promise<EditorParty | null> {
  try {
    const p = await parties.getParty(t, id);
    return {
      id: p.id as string,
      name: p.name as string,
      stateCode: p.shippingAddress?.stateCode ?? p.billingAddress.stateCode ?? ((p.gstin as string | null)?.slice(0, 2) ?? null),
      gstin: p.gstin as string | null,
      phone: p.phone as string | null,
    };
  } catch {
    return null;
  }
}

export function blankInitial(t: Tenant, type: DocType, party: EditorParty | null): EditorInitial {
  return {
    party,
    issueDate: t.today,
    validUntil: type === "quotation" ? addDays(t.today, t.settings.quotationValidityDays) : null,
    pricesIncludeTax: t.settings.pricesIncludeTax,
    roundOff: t.settings.roundOffTotals,
    terms: type === "quotation" ? t.settings.quotationTerms : type === "invoice" ? t.settings.invoiceTerms : null,
    lines: [],
  };
}

export async function initialFromDocument(t: Tenant, id: string): Promise<{ type: DocType; initial: EditorInitial; status: string }> {
  const d = await documents.getDocument(t, id);
  const productIds = d.items.map((i) => i.productId).filter(Boolean) as string[];
  const info = productIds.length
    ? await t.db.query<{ id: string; track_serials: boolean; track_inventory: boolean; stock: string }>(
        "select p.id, p.track_serials, p.track_inventory, coalesce((select sum(quantity) from stock_levels s where s.product_id = p.id), 0) stock from products p where p.id = any($1)",
        [productIds],
      )
    : [];
  const byId = new Map(info.map((x) => [x.id, x]));
  const party = await partyForEditor(t, d.partyId as string);
  return {
    type: d.docType as DocType,
    status: d.status as string,
    initial: {
      id,
      party,
      issueDate: d.issueDate as string,
      dueDate: d.dueDate as string | null,
      validUntil: d.validUntil as string | null,
      placeOfSupply: d.placeOfSupply as string,
      pricesIncludeTax: d.pricesIncludeTax as boolean,
      roundOff: d.roundOffEnabled as boolean,
      documentDiscountType: d.documentDiscountType as "percent" | "amount" | null,
      documentDiscountValue: d.documentDiscountType ? (d.documentDiscountValue as string) : null,
      additionalCharges: Number(d.additionalCharges) ? (d.additionalCharges as string) : null,
      additionalChargesLabel: d.additionalChargesLabel as string | null,
      additionalChargesTaxRate: Number(d.additionalChargesTaxRate),
      referenceNumber: d.referenceNumber as string | null,
      supplierInvoiceNumber: d.supplierInvoiceNumber as string | null,
      notes: d.notes as string | null,
      terms: d.terms as string | null,
      sourceDocumentId: d.sourceDocumentId as string | null,
      lines: d.items.map((i, n) => {
        const p = i.productId ? byId.get(i.productId as string) : undefined;
        return {
          key: `e${n}-${i.id as string}`,
          productId: (i.productId as string) ?? null,
          description: i.description as string,
          hsnCode: (i.hsnCode as string) ?? "",
          quantity: String(Number(i.quantity)),
          unit: i.unit as string,
          unitPrice: i.unitPrice as string,
          discountType: (i.discountType as "percent" | "amount" | null) ?? null,
          discountValue: i.discountType ? String(i.discountValue) : "",
          taxRate: Number(i.taxRate),
          serialNumbers: ((i.serialNumbers as string[]) ?? []).join(", "),
          trackSerials: !!p?.track_serials,
          stock: p?.track_inventory ? Number(p.stock) : null,
          sourceItemId: (i.sourceItemId as string) ?? null,
        };
      }),
    },
  };
}
