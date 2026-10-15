"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  calculateDocument, CalculationError, COMMON_GST_RATES, formatIndianPhone, GST_RATES, INDIAN_STATES, amountInWords, formatINR, DOC_TYPE_META, validateGSTIN, D, type DocType,
} from "@cba/core";
import { api, ApiError, newIdempotencyKey } from "@/lib/api-client";
import { AsyncCombobox, type ComboItem } from "../combobox";
import { Modal, useToast } from "../client";
import { Button, Card, CardHeader, Field, Input, Select, Textarea, cn, inputClass } from "../ui";
import { CameraScanner, cameraScanSupported } from "../scanner";

export interface EditorLine {
  key: string;
  productId: string | null;
  description: string;
  hsnCode: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  discountType: "percent" | "amount" | null;
  discountValue: string;
  taxRate: number;
  serialNumbers: string;
  trackSerials?: boolean;
  stock?: number | null;
  sourceItemId?: string | null;
}

export interface EditorParty {
  id: string;
  name: string;
  stateCode: string | null;
  gstin: string | null;
  phone?: string | null;
}

export interface EditorInitial {
  id?: string;
  party?: EditorParty | null;
  issueDate: string;
  dueDate?: string | null;
  validUntil?: string | null;
  placeOfSupply?: string | null;
  pricesIncludeTax: boolean;
  roundOff: boolean;
  documentDiscountType?: "percent" | "amount" | null;
  documentDiscountValue?: string | null;
  additionalCharges?: string | null;
  additionalChargesLabel?: string | null;
  additionalChargesTaxRate?: number;
  referenceNumber?: string | null;
  supplierInvoiceNumber?: string | null;
  notes?: string | null;
  terms?: string | null;
  sourceDocumentId?: string | null;
  lines: EditorLine[];
}

let lineSeq = 0;
const newKey = () => `l${++lineSeq}-${Date.now()}`;
export const emptyLine = (taxRate = 18): EditorLine => ({ key: newKey(), productId: null, description: "", hsnCode: "", quantity: "1", unit: "pcs", unitPrice: "", discountType: null, discountValue: "", taxRate, serialNumbers: "" });

function convertPrice(price: string, rate: number, fromIncl: boolean, toIncl: boolean) {
  if (fromIncl === toIncl || !price) return price;
  const p = new D(price);
  return (toIncl ? p.mul(100 + rate).div(100) : p.mul(100).div(100 + rate)).toDecimalPlaces(2).toFixed(2);
}

export function DocumentEditor({ type, initial, branchState, gstScheme, canFinalize, canSeeCost, canOverrideStock }: {
  type: DocType;
  initial: EditorInitial;
  branchState: string;
  gstScheme: "regular" | "composition" | "unregistered";
  canFinalize: boolean;
  canSeeCost: boolean;
  canOverrideStock: boolean;
}) {
  const meta = DOC_TYPE_META[type];
  const sales = meta.side === "sales";
  const noTax = sales && gstScheme !== "regular";
  const router = useRouter();
  const toast = useToast();
  const idemKey = useRef(newIdempotencyKey());

  const [party, setParty] = useState<EditorParty | null>(initial.party ?? null);
  const [doc, setDoc] = useState({
    issueDate: initial.issueDate,
    dueDate: initial.dueDate ?? "",
    validUntil: initial.validUntil ?? "",
    placeOfSupply: initial.placeOfSupply ?? "",
    pricesIncludeTax: initial.pricesIncludeTax,
    roundOff: initial.roundOff,
    documentDiscountType: initial.documentDiscountType ?? null,
    documentDiscountValue: initial.documentDiscountValue ?? "",
    additionalCharges: initial.additionalCharges ?? "",
    additionalChargesLabel: initial.additionalChargesLabel ?? "",
    additionalChargesTaxRate: initial.additionalChargesTaxRate ?? 18,
    referenceNumber: initial.referenceNumber ?? "",
    supplierInvoiceNumber: initial.supplierInvoiceNumber ?? "",
    notes: initial.notes ?? "",
    terms: initial.terms ?? "",
  });
  const [lines, setLines] = useState<EditorLine[]>(initial.lines.length ? initial.lines : [emptyLine()]);
  const [busy, setBusy] = useState<null | "draft" | "issue">(null);
  const [error, setError] = useState<string | null>(null);
  const [override, setOverride] = useState<{ id: string; message: string } | null>(null);
  const [addParty, setAddParty] = useState<string | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [barcode, setBarcode] = useState("");
  const [showMore, setShowMore] = useState(!!(initial.documentDiscountType || Number(initial.additionalCharges) || initial.notes));

  const pos = sales ? doc.placeOfSupply || party?.stateCode || branchState : branchState;
  const interState = sales ? pos !== branchState : !!party?.stateCode && party.stateCode !== branchState;

  const calc = useMemo(() => {
    try {
      const valid = lines.filter((l) => l.description.trim() && Number(l.quantity) > 0 && l.unitPrice !== "");
      if (!valid.length) return { ok: true as const, r: null };
      return {
        ok: true as const,
        r: calculateDocument({
          lines: valid.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice || "0", discountType: l.discountType, discountValue: l.discountValue || "0", taxRate: noTax ? 0 : l.taxRate })),
          pricesIncludeTax: doc.pricesIncludeTax,
          isInterState: interState,
          documentDiscountType: doc.documentDiscountType,
          documentDiscountValue: doc.documentDiscountValue || "0",
          additionalCharges: doc.additionalCharges || "0",
          additionalChargesTaxRate: noTax ? 0 : doc.additionalChargesTaxRate,
          roundOff: doc.roundOff,
        }),
      };
    } catch (e) {
      return { ok: false as const, message: e instanceof CalculationError ? e.message : "Check the amounts" };
    }
  }, [lines, doc, interState, noTax]);
  const lineTotals = useMemo(() => {
    const m = new Map<string, string>();
    if (calc.ok && calc.r) {
      const valid = lines.filter((l) => l.description.trim() && Number(l.quantity) > 0 && l.unitPrice !== "");
      valid.forEach((l, i) => m.set(l.key, calc.r!.lines[i]!.total));
    }
    return m;
  }, [calc, lines]);

  const update = (key: string, patch: Partial<EditorLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const remove = (key: string) => setLines((ls) => (ls.length === 1 ? [emptyLine()] : ls.filter((l) => l.key !== key)));

  const productToLine = useCallback(
    (p: Record<string, unknown>, existing?: EditorLine): EditorLine => {
      const rate = Number(p.taxRate ?? 18);
      const base = sales ? String(p.sellingPrice ?? "") : canSeeCost ? String(p.costPrice ?? "") : "";
      const price = sales ? convertPrice(base, rate, !!p.pricesIncludeTax, doc.pricesIncludeTax) : base;
      return {
        ...(existing ?? emptyLine(rate)),
        productId: p.id as string,
        description: p.name as string,
        hsnCode: (p.hsnCode as string) ?? "",
        unit: (p.unit as string) ?? "pcs",
        unitPrice: price,
        taxRate: rate,
        trackSerials: !!p.trackSerials,
        stock: p.trackInventory ? Number(p.stock ?? 0) : null,
      };
    },
    [sales, canSeeCost, doc.pricesIncludeTax],
  );

  async function addByBarcode(code: string) {
    const c = code.trim();
    if (!c) return;
    try {
      const p = await api<Record<string, unknown>>("GET", `products/barcode/${encodeURIComponent(c)}`);
      const stock = (p.stock as Array<{ quantity: string }> | undefined)?.reduce((a, s) => a + Number(s.quantity), 0) ?? null;
      setLines((ls) => {
        const serial = p.matchedSerial as string | undefined;
        const same = ls.find((l) => l.productId === p.id);
        if (same) {
          return ls.map((l) =>
            l.key === same.key ? { ...l, quantity: String(Number(l.quantity || 0) + 1), serialNumbers: serial ? [l.serialNumbers, serial].filter(Boolean).join(", ") : l.serialNumbers } : l,
          );
        }
        const line = { ...productToLine({ ...p, stock }), serialNumbers: serial ?? "" };
        const blank = ls.findIndex((l) => !l.description && !l.productId);
        return blank >= 0 ? ls.map((l, i) => (i === blank ? { ...line, key: l.key } : l)) : [...ls, line];
      });
      toast("success", `Added ${p.name as string}`);
    } catch (e) {
      toast("error", e instanceof ApiError && e.code === "NOT_FOUND" ? `No product with barcode ${c}` : "Lookup failed");
    }
    setBarcode("");
  }

  function payload() {
    return {
      docType: type,
      partyId: party?.id,
      issueDate: doc.issueDate,
      dueDate: doc.dueDate || null,
      validUntil: doc.validUntil || null,
      placeOfSupply: sales ? doc.placeOfSupply || null : null,
      pricesIncludeTax: doc.pricesIncludeTax,
      roundOff: doc.roundOff,
      documentDiscountType: doc.documentDiscountType,
      documentDiscountValue: doc.documentDiscountType ? doc.documentDiscountValue || "0" : null,
      additionalCharges: doc.additionalCharges || null,
      additionalChargesLabel: doc.additionalChargesLabel || null,
      additionalChargesTaxRate: doc.additionalChargesTaxRate,
      referenceNumber: doc.referenceNumber || null,
      supplierInvoiceNumber: doc.supplierInvoiceNumber || null,
      notes: doc.notes || null,
      terms: doc.terms || null,
      sourceDocumentId: initial.sourceDocumentId ?? null,
      items: lines
        .filter((l) => l.description.trim() || l.productId)
        .map((l) => ({
          productId: l.productId,
          description: l.description,
          hsnCode: l.hsnCode || null,
          quantity: l.quantity,
          unit: l.unit || "pcs",
          unitPrice: l.unitPrice || "0",
          discountType: l.discountType,
          discountValue: l.discountType ? l.discountValue || "0" : null,
          taxRate: l.taxRate,
          serialNumbers: l.serialNumbers.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean),
          sourceItemId: l.sourceItemId ?? null,
        })),
    };
  }

  async function save(issue: boolean) {
    setError(null);
    if (!party) return setError(`Select a ${sales ? "customer" : "supplier"}`);
    if (!calc.ok) return setError(calc.message);
    setBusy(issue ? "issue" : "draft");
    let id = initial.id;
    try {
      const saved = id
        ? await api<{ id: string }>("PUT", `documents/${id}`, payload())
        : await api<{ id: string }>("POST", "documents", payload(), { idempotencyKey: idemKey.current });
      id = saved.id;
      if (issue) {
        try {
          await api("POST", `documents/${id}/finalize`, {});
        } catch (e) {
          if (e instanceof ApiError && e.code === "NEGATIVE_STOCK" && canOverrideStock) {
            setOverride({ id, message: e.message });
            return;
          }
          if (e instanceof ApiError && e.code === "APPROVAL_REQUIRED") {
            toast("info", e.message);
            router.push(`/documents/${type}/${id}`);
            return;
          }
          toast("error", `Saved as draft, but not issued: ${e instanceof ApiError ? e.message : "network error"}`);
          router.push(`/documents/${type}/${id}`);
          return;
        }
      }
      toast("success", issue ? `${meta.label} issued` : "Draft saved");
      router.push(`/documents/${type}/${id}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Network problem. Your changes are still on this screen — try again.");
    } finally {
      setBusy(null);
    }
  }

  const [canCamera, setCanCamera] = useState(false);
  useEffect(() => setCanCamera(cameraScanSupported()), []);

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
      <div className="space-y-5">
        <Card className="p-4 sm:p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={sales ? "Customer" : "Supplier"} required>
              <AsyncCombobox
                ariaLabel={sales ? "Customer" : "Supplier"}
                autoFocus={!party}
                value={party?.name}
                placeholder="Search name, phone or GSTIN"
                endpoint={(q) => `parties?type=${sales ? "customer" : "supplier"}&pageSize=8&q=${encodeURIComponent(q)}`}
                map={(r) => ({ id: r.id as string, label: r.name as string, sub: [formatIndianPhone(r.phone as string), r.gstin, r.billingCity].filter(Boolean).join(" · "), raw: r })}
                onPick={async (it: ComboItem) => {
                  const full = await api<Record<string, unknown>>("GET", `parties/${it.id}`);
                  const ba = full.billingAddress as { stateCode: string | null };
                  const sa = full.shippingAddress as { stateCode: string | null } | null;
                  setParty({ id: it.id, name: it.label, stateCode: sa?.stateCode ?? ba?.stateCode ?? ((full.gstin as string | null)?.slice(0, 2) ?? null), gstin: full.gstin as string | null, phone: full.phone as string | null });
                  setDoc((d) => ({ ...d, placeOfSupply: "" }));
                }}
                footer={(q, close) => (
                  <button type="button" className="w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-brand-700 hover:bg-brand-50" onClick={() => { close(); setAddParty(q); }}>
                    + Add new {sales ? "customer" : "supplier"}{q ? ` “${q}”` : ""}
                  </button>
                )}
              />
              {party && <span className="mt-1 block text-xs text-muted">{[party.gstin ? `GSTIN ${party.gstin}` : "Unregistered", formatIndianPhone(party.phone)].filter(Boolean).join(" · ")}</span>}
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date" required>
                <Input type="date" value={doc.issueDate} onChange={(e) => setDoc({ ...doc, issueDate: e.target.value })} />
              </Field>
              {type === "quotation" ? (
                <Field label="Valid until">
                  <Input type="date" value={doc.validUntil} onChange={(e) => setDoc({ ...doc, validUntil: e.target.value })} />
                </Field>
              ) : type === "invoice" || type === "purchase_bill" ? (
                <Field label="Due date" hint="Blank = payment terms">
                  <Input type="date" value={doc.dueDate} onChange={(e) => setDoc({ ...doc, dueDate: e.target.value })} />
                </Field>
              ) : (
                <Field label="Reference no.">
                  <Input value={doc.referenceNumber} onChange={(e) => setDoc({ ...doc, referenceNumber: e.target.value })} />
                </Field>
              )}
            </div>
            {sales ? (
              <Field label="Place of supply" hint={interState ? "Inter-state → IGST" : "Same state → CGST + SGST"}>
                <Select value={doc.placeOfSupply || pos} onChange={(e) => setDoc({ ...doc, placeOfSupply: e.target.value })}>
                  {INDIAN_STATES.map((s) => <option key={s.code} value={s.code}>{s.name} ({s.code})</option>)}
                </Select>
              </Field>
            ) : (
              <Field label="Supplier bill number" hint={interState ? "Supplier in another state → IGST" : undefined}>
                <Input value={doc.supplierInvoiceNumber} onChange={(e) => setDoc({ ...doc, supplierInvoiceNumber: e.target.value })} />
              </Field>
            )}
            <div className="flex flex-wrap items-end gap-4 pb-1 text-sm">
              {!noTax && (
                <label className="flex items-center gap-2">
                  <input type="checkbox" className="accent-brand-600" checked={doc.pricesIncludeTax} onChange={(e) => setDoc({ ...doc, pricesIncludeTax: e.target.checked })} />
                  Prices include GST
                </label>
              )}
              <label className="flex items-center gap-2">
                <input type="checkbox" className="accent-brand-600" checked={doc.roundOff} onChange={(e) => setDoc({ ...doc, roundOff: e.target.checked })} />
                Round off total
              </label>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Items"
            action={
              <div className="flex items-center gap-2">
                <input
                  value={barcode}
                  onChange={(e) => setBarcode(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addByBarcode(barcode);
                    }
                  }}
                  placeholder="Scan / type barcode"
                  aria-label="Barcode"
                  className={cn(inputClass, "h-8 w-40 py-1 text-xs")}
                />
                {canCamera && <Button type="button" size="sm" variant="secondary" onClick={() => setScanOpen(true)}>Camera</Button>}
              </div>
            }
          />
          <div className="divide-y divide-line">
            {lines.map((l, idx) => {
              const total = lineTotals.get(l.key);
              const serialCount = l.serialNumbers.split(/[\s,;]+/).filter(Boolean).length;
              return (
                <div key={l.key} className="grid gap-3 px-4 py-4 sm:px-5 md:grid-cols-12">
                  <div className="md:col-span-5">
                    <label className="mb-1 block text-xs font-medium text-muted">Item {idx + 1}</label>
                    <AsyncCombobox
                      ariaLabel={`Item ${idx + 1}`}
                      value={l.description}
                      placeholder="Search product or type a description"
                      endpoint={(q) => `products?pageSize=8&q=${encodeURIComponent(q)}`}
                      map={(r) => ({ id: r.id as string, label: r.name as string, sub: [r.sku, `₹${r.sellingPrice}`, r.trackInventory ? `Stock ${Number(r.stock)}` : null].filter(Boolean).join(" · "), raw: r })}
                      onPick={(it) => update(l.key, productToLine(it.raw, l))}
                      footer={(q, close) =>
                        q ? (
                          <button type="button" className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-stone-50" onClick={() => { update(l.key, { description: q, productId: null }); close(); }}>
                            Use “{q}” as a one-off item
                          </button>
                        ) : null
                      }
                    />
                    {l.stock !== undefined && l.stock !== null && sales && (
                      <span className={cn("mt-1 block text-xs", Number(l.quantity) > l.stock ? "text-red-700" : "text-muted")}>In stock: {l.stock}</span>
                    )}
                    {l.trackSerials && (
                      <input
                        className={cn(inputClass, "mt-2 text-xs")}
                        placeholder={`Serial numbers (${serialCount}/${Number(l.quantity) || 0}) — comma separated`}
                        value={l.serialNumbers}
                        onChange={(e) => update(l.key, { serialNumbers: e.target.value })}
                        aria-label="Serial numbers"
                      />
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-2 md:col-span-4">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-muted">Qty</label>
                      <input className={inputClass} inputMode="decimal" value={l.quantity} onChange={(e) => update(l.key, { quantity: e.target.value })} aria-label="Quantity" />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-muted">Rate ₹</label>
                      <input className={inputClass} inputMode="decimal" value={l.unitPrice} onChange={(e) => update(l.key, { unitPrice: e.target.value })} aria-label="Rate" />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-muted">GST</label>
                      <select className={inputClass} value={noTax ? 0 : l.taxRate} disabled={noTax} onChange={(e) => update(l.key, { taxRate: Number(e.target.value) })} aria-label="GST rate">
                        {(noTax ? [0] : [...new Set<number>([...COMMON_GST_RATES, ...GST_RATES.filter((r) => r === l.taxRate)])].sort((a, b) => a - b)).map((r) => <option key={r} value={r}>{r}%</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-[1fr_auto] items-end gap-2 md:col-span-3">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-muted">Discount</label>
                      <div className="flex">
                        <input className={cn(inputClass, "rounded-r-none")} inputMode="decimal" value={l.discountValue} onChange={(e) => update(l.key, { discountValue: e.target.value, discountType: e.target.value ? l.discountType ?? "percent" : null })} aria-label="Discount" placeholder="0" />
                        <select className="rounded-r-lg border border-l-0 border-line bg-stone-50 px-1.5 text-xs" value={l.discountType ?? "percent"} onChange={(e) => update(l.key, { discountType: e.target.value as "percent" | "amount" })} aria-label="Discount type">
                          <option value="percent">%</option>
                          <option value="amount">₹</option>
                        </select>
                      </div>
                    </div>
                    <button type="button" onClick={() => remove(l.key)} className="mb-1 rounded-lg p-2 text-stone-400 hover:bg-red-50 hover:text-red-700" aria-label={`Remove item ${idx + 1}`}>✕</button>
                    <div className="col-span-2 text-right text-sm">
                      <span className="text-muted">Amount </span>
                      <span className="font-semibold tabular">{total ? formatINR(total) : "—"}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-2 border-t border-line px-4 py-3 sm:px-5">
            <Button type="button" variant="secondary" size="sm" onClick={() => setLines((ls) => [...ls, emptyLine(ls[ls.length - 1]?.taxRate ?? 18)])}>+ Add item</Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowMore((s) => !s)}>{showMore ? "Hide" : "Add"} discount, charges & notes</Button>
          </div>
        </Card>

        {showMore && (
          <Card className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5">
            <Field label="Discount on total (before tax)">
              <div className="flex">
                <input className={cn(inputClass, "rounded-r-none")} inputMode="decimal" value={doc.documentDiscountValue} onChange={(e) => setDoc({ ...doc, documentDiscountValue: e.target.value, documentDiscountType: e.target.value ? doc.documentDiscountType ?? "percent" : null })} placeholder="0" />
                <select className="rounded-r-lg border border-l-0 border-line bg-stone-50 px-2 text-sm" value={doc.documentDiscountType ?? "percent"} onChange={(e) => setDoc({ ...doc, documentDiscountType: e.target.value as "percent" | "amount" })}>
                  <option value="percent">%</option>
                  <option value="amount">₹</option>
                </select>
              </div>
            </Field>
            <div className="grid grid-cols-[1fr_1fr_90px] gap-2">
              <Field label="Charges label"><Input value={doc.additionalChargesLabel} onChange={(e) => setDoc({ ...doc, additionalChargesLabel: e.target.value })} placeholder="Delivery" /></Field>
              <Field label="Amount ₹"><Input inputMode="decimal" value={doc.additionalCharges} onChange={(e) => setDoc({ ...doc, additionalCharges: e.target.value })} placeholder="0" /></Field>
              <Field label="GST">
                <Select value={noTax ? 0 : doc.additionalChargesTaxRate} disabled={noTax} onChange={(e) => setDoc({ ...doc, additionalChargesTaxRate: Number(e.target.value) })}>
                  {(noTax ? [0] : COMMON_GST_RATES).map((r) => <option key={r} value={r}>{r}%</option>)}
                </Select>
              </Field>
            </div>
            <Field label="Notes (printed)"><Textarea value={doc.notes} onChange={(e) => setDoc({ ...doc, notes: e.target.value })} /></Field>
            <Field label="Terms & conditions" hint="Defaults come from Settings"><Textarea value={doc.terms} onChange={(e) => setDoc({ ...doc, terms: e.target.value })} /></Field>
          </Card>
        )}
      </div>

      <div className="lg:sticky lg:top-20 lg:self-start">
        <Card>
          <CardHeader title="Summary" subtitle={noTax ? "Bill of Supply — no GST charged" : interState ? "IGST (inter-state)" : "CGST + SGST (intra-state)"} />
          <div className="space-y-2 px-5 py-4 text-sm">
            {calc.ok && calc.r ? (
              <>
                <Row k="Items total" v={calc.r.grossTotal} />
                {Number(calc.r.discountTotal) > 0 && <Row k="Discount" v={`-${calc.r.discountTotal}`} />}
                {Number(calc.r.additionalCharges) > 0 && <Row k={doc.additionalChargesLabel || "Charges"} v={calc.r.additionalCharges} />}
                {!noTax && <Row k="Taxable value" v={calc.r.taxableTotal} />}
                {!noTax && (interState ? <Row k="IGST" v={calc.r.igstTotal} /> : (<><Row k="CGST" v={calc.r.cgstTotal} /><Row k="SGST" v={calc.r.sgstTotal} /></>))}
                {Number(calc.r.roundOff) !== 0 && <Row k="Round off" v={calc.r.roundOff} />}
                <div className="flex items-baseline justify-between border-t border-line pt-3">
                  <span className="font-semibold">Total</span>
                  <span className="text-2xl font-semibold tabular text-brand-700">{formatINR(calc.r.grandTotal)}</span>
                </div>
                <p className="text-xs text-muted">{amountInWords(calc.r.grandTotal)}</p>
              </>
            ) : calc.ok ? (
              <p className="text-muted">Add items to see the total.</p>
            ) : (
              <p className="text-red-700">{calc.message}</p>
            )}
          </div>
          {error && <p className="mx-5 mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p>}
          <div className="flex flex-col gap-2 border-t border-line p-4">
            {canFinalize && (
              <Button size="lg" disabled={!!busy} onClick={() => save(true)}>
                {busy === "issue" ? "Saving…" : type === "quotation" ? "Save & send" : `Save & issue ${meta.label.toLowerCase()}`}
              </Button>
            )}
            <Button variant="secondary" disabled={!!busy} onClick={() => save(false)}>{busy === "draft" ? "Saving…" : "Save as draft"}</Button>
            <p className="text-center text-xs text-muted">{meta.isTaxDocument ? "Issued documents get a number and cannot be edited later — cancel or issue a credit note instead." : "You can convert this later without retyping."}</p>
          </div>
        </Card>
      </div>

      <CameraScanner open={scanOpen} onClose={() => setScanOpen(false)} onCode={(c) => addByBarcode(c)} />
      <QuickParty
        open={addParty !== null}
        initialName={addParty ?? ""}
        kind={sales ? "customer" : "supplier"}
        defaultState={branchState}
        onClose={() => setAddParty(null)}
        onCreated={(p) => {
          setParty(p);
          setAddParty(null);
        }}
      />
      <Modal
        open={!!override}
        onClose={() => setOverride(null)}
        title="Not enough stock"
        footer={
          <>
            <Button variant="ghost" onClick={() => { const id = override!.id; setOverride(null); router.push(`/documents/${type}/${id}`); }}>Keep as draft</Button>
            <Button
              variant="danger"
              onClick={async () => {
                const id = override!.id;
                try {
                  await api("POST", `documents/${id}/finalize`, { allowNegativeStock: true });
                  toast("success", `${meta.label} issued with stock override`);
                } catch (e) {
                  toast("error", e instanceof ApiError ? e.message : "Failed");
                }
                setOverride(null);
                router.push(`/documents/${type}/${id}`);
              }}
            >
              Issue anyway
            </Button>
          </>
        }
      >
        <p className="text-sm">{override?.message}</p>
        <p className="mt-2 text-sm text-muted">The draft is saved. Issuing anyway records negative stock and is noted in the audit log.</p>
      </Modal>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted">{k}</span>
      <span className="tabular">{formatINR(v)}</span>
    </div>
  );
}

export function QuickParty({ open, initialName, kind, defaultState, onClose, onCreated }: { open: boolean; initialName: string; kind: "customer" | "supplier"; defaultState: string; onClose: () => void; onCreated: (p: EditorParty) => void }) {
  const toast = useToast();
  const [f, setF] = useState({ name: "", phone: "", stateCode: defaultState, gstin: "" });
  const [dups, setDups] = useState<Array<{ id: string; name: string; reason: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [lastOpen, setLastOpen] = useState(false);
  if (open && !lastOpen) {
    setLastOpen(true);
    setF({ name: initialName, phone: /^\+?[\d\s-]{6,}$/.test(initialName) ? initialName : "", stateCode: defaultState, gstin: "" });
    setDups([]);
    setErr(null);
  } else if (!open && lastOpen) setLastOpen(false);
  const g = f.gstin ? validateGSTIN(f.gstin) : null;

  async function create(confirmDuplicate = false) {
    setBusy(true);
    setErr(null);
    try {
      const p = await api<Record<string, unknown>>("POST", "parties", {
        name: f.name, phone: f.phone || null, gstin: f.gstin || null, isCustomer: kind === "customer", isSupplier: kind === "supplier",
        billingAddress: { stateCode: g?.valid ? g.stateCode : f.stateCode }, openingBalance: "0", confirmDuplicate,
      });
      toast("success", `${kind === "customer" ? "Customer" : "Supplier"} added`);
      onCreated({ id: p.id as string, name: p.name as string, stateCode: (p.billingAddress as { stateCode: string | null }).stateCode, gstin: p.gstin as string | null, phone: p.phone as string | null });
    } catch (e) {
      if (e instanceof ApiError && e.code === "POSSIBLE_DUPLICATE") setDups((e.details?.duplicates ?? []) as typeof dups);
      else setErr(e instanceof ApiError ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`New ${kind}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          {dups.length ? <Button variant="secondary" disabled={busy} onClick={() => create(true)}>Create anyway</Button> : null}
          <Button disabled={busy || f.name.trim().length < 1 || (!!f.gstin && !g?.valid)} onClick={() => create(false)}>{busy ? "Saving…" : "Save"}</Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Name" required><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Mobile"><Input type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          <Field label="State">
            <Select value={f.stateCode} onChange={(e) => setF({ ...f, stateCode: e.target.value })}>
              {INDIAN_STATES.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="GSTIN (optional)" error={g && !g.valid ? g.reason : null}>
          <Input value={f.gstin} maxLength={15} onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase() })} />
        </Field>
        {err && <p className="text-sm text-red-700">{err}</p>}
        {dups.length > 0 && (
          <div className="rounded-lg bg-amber-50 p-3 text-sm">
            <p className="font-medium text-amber-900">Possible duplicate</p>
            <ul className="mt-1 space-y-1">
              {dups.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-2">
                  <span>{d.name} <span className="text-xs text-amber-800">({d.reason})</span></span>
                  <button type="button" className="text-sm font-medium text-brand-700" onClick={async () => {
                    const full = await api<Record<string, unknown>>("GET", `parties/${d.id}`);
                    onCreated({ id: d.id, name: d.name, stateCode: (full.billingAddress as { stateCode: string | null }).stateCode, gstin: full.gstin as string | null, phone: full.phone as string | null });
                  }}>Use this</button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}
