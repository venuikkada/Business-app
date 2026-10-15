"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { COMMON_GST_RATES, GST_RATES } from "@cba/core";
import { api, newIdempotencyKey } from "@/lib/api-client";
import { Button, Card, CardHeader, Field, Input, Select, Textarea } from "../ui";
import { useToast } from "../client";
import { useApiForm } from "../forms/use-api-form";

export interface ProductFormValue {
  name: string; type: "goods" | "service"; sku: string; barcode: string; categoryId: string; brand: string; unit: string; hsnCode: string; description: string;
  costPrice: string; sellingPrice: string; mrp: string; taxRate: number; pricesIncludeTax: boolean; trackInventory: boolean; trackSerials: boolean;
  reorderLevel: string; warrantyMonths: string; openingStock: string; openingSerials: string; parentProductId: string; variantAttributes: string;
}


const UNITS = ["pcs", "nos", "box", "kg", "g", "ltr", "ml", "m", "ft", "roll", "set", "pair", "pack", "hour", "job", "month"];

export function ProductForm({ id, initial, categories, canSeeCost, hasInventory, parents }: { id?: string; initial: ProductFormValue; categories: Array<{ id: string; name: string }>; canSeeCost: boolean; hasInventory: boolean; parents: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const toast = useToast();
  const [f, setF] = useState(initial);
  const [cats, setCats] = useState(categories);
  const { busy, error, fields, run } = useApiForm();
  const set = <K extends keyof ProductFormValue>(k: K, v: ProductFormValue[K]) => setF((x) => ({ ...x, [k]: v }));
  const margin = Number(f.sellingPrice) && Number(f.costPrice) ? (((Number(f.sellingPrice) - Number(f.costPrice)) / Number(f.sellingPrice)) * 100).toFixed(1) : null;

  async function save() {
    const attrs = f.variantAttributes
      ? Object.fromEntries(f.variantAttributes.split(",").map((kv) => kv.split(":").map((x) => x.trim())).filter((kv) => kv.length === 2 && kv[0] && kv[1]) as Array<[string, string]>)
      : null;
    const body = {
      name: f.name, type: f.type, sku: f.sku || null, barcode: f.barcode || null, categoryId: f.categoryId || null, brand: f.brand || null, unit: f.unit || "pcs",
      hsnCode: f.hsnCode || null, description: f.description || null, costPrice: f.costPrice || "0", sellingPrice: f.sellingPrice || "0", mrp: f.mrp || null,
      taxRate: f.taxRate, pricesIncludeTax: f.pricesIncludeTax, trackInventory: f.type === "goods" && f.trackInventory, trackSerials: f.type === "goods" && f.trackSerials,
      reorderLevel: f.reorderLevel || "0", warrantyMonths: f.warrantyMonths ? Number(f.warrantyMonths) : null, parentProductId: f.parentProductId || null, variantAttributes: attrs,
      ...(id ? {} : { openingStock: f.openingStock || null, openingSerials: f.openingSerials.split(/[\s,;]+/).filter(Boolean) }),
    };
    try {
      const r = await run(() => (id ? api<{ id: string }>("PUT", `products/${id}`, body) : api<{ id: string }>("POST", "products", body, { idempotencyKey: newIdempotencyKey() })));
      toast("success", id ? "Saved" : "Product added");
      router.push(`/products/${r!.id}`);
      router.refresh();
    } catch {
      /* shown in form */
    }
  }

  return (
    <form className="grid gap-5 lg:grid-cols-3" onSubmit={(e) => { e.preventDefault(); save(); }}>
      <div className="space-y-5 lg:col-span-2">
        <Card>
          <CardHeader title="Product" />
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <Field label="Name" required error={fields.name} className="sm:col-span-2"><Input value={f.name} onChange={(e) => set("name", e.target.value)} required autoFocus={!id} /></Field>
            <div className="flex gap-5 text-sm sm:col-span-2">
              <label className="flex items-center gap-2"><input type="radio" className="accent-brand-600" checked={f.type === "goods"} onChange={() => set("type", "goods")} /> Goods</label>
              <label className="flex items-center gap-2"><input type="radio" className="accent-brand-600" checked={f.type === "service"} onChange={() => setF({ ...f, type: "service", trackInventory: false, trackSerials: false, unit: f.unit === "pcs" ? "job" : f.unit })} /> Service</label>
            </div>
            <Field label="SKU / item code" error={fields.sku}><Input value={f.sku} onChange={(e) => set("sku", e.target.value)} /></Field>
            <Field label="Barcode" error={fields.barcode} hint="Scan with a USB scanner into this box"><Input value={f.barcode} onChange={(e) => set("barcode", e.target.value)} /></Field>
            <Field label="Category">
              <div className="flex gap-2">
                <Select value={f.categoryId} onChange={(e) => set("categoryId", e.target.value)}>
                  <option value="">—</option>
                  {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
                <Button type="button" variant="secondary" onClick={async () => {
                  const name = prompt("New category name");
                  if (!name?.trim()) return;
                  try {
                    const c = await api<{ id: string; name: string }>("POST", "categories", { name: name.trim() });
                    setCats([...cats, c]);
                    set("categoryId", c.id);
                  } catch (e) {
                    toast("error", e instanceof Error ? e.message : "Failed");
                  }
                }}>+</Button>
              </div>
            </Field>
            <Field label="Brand"><Input value={f.brand} onChange={(e) => set("brand", e.target.value)} /></Field>
            <Field label={f.type === "service" ? "SAC code" : "HSN code"} error={fields.hsnCode} hint="4–8 digits; required on B2B tax invoices"><Input inputMode="numeric" value={f.hsnCode} onChange={(e) => set("hsnCode", e.target.value)} /></Field>
            <Field label="Unit">
              <Select value={f.unit} onChange={(e) => set("unit", e.target.value)}>
                {[...new Set([...UNITS, f.unit])].map((u) => <option key={u} value={u}>{u}</option>)}
              </Select>
            </Field>
            <Field label="Description" className="sm:col-span-2"><Textarea rows={2} value={f.description} onChange={(e) => set("description", e.target.value)} /></Field>
          </div>
        </Card>
        <Card>
          <CardHeader title="Pricing & tax" />
          <div className="grid gap-4 p-5 sm:grid-cols-3">
            <Field label="Selling price (₹)" error={fields.sellingPrice}><Input inputMode="decimal" value={f.sellingPrice} onChange={(e) => set("sellingPrice", e.target.value)} /></Field>
            {canSeeCost && <Field label="Purchase / cost price (₹)" hint={margin ? `Margin ${margin}%` : undefined}><Input inputMode="decimal" value={f.costPrice} onChange={(e) => set("costPrice", e.target.value)} /></Field>}
            <Field label="MRP (₹)"><Input inputMode="decimal" value={f.mrp} onChange={(e) => set("mrp", e.target.value)} /></Field>
            <Field label="GST rate">
              <Select value={f.taxRate} onChange={(e) => set("taxRate", Number(e.target.value))}>
                {[...new Set<number>([...COMMON_GST_RATES, ...GST_RATES])].map((r) => <option key={r} value={r}>{r}%</option>)}
              </Select>
            </Field>
            <label className="flex items-end gap-2 pb-2 text-sm sm:col-span-2">
              <input type="checkbox" className="accent-brand-600" checked={f.pricesIncludeTax} onChange={(e) => set("pricesIncludeTax", e.target.checked)} /> Selling price includes GST
            </label>
          </div>
        </Card>
        {parents.length > 0 && (
          <Card>
            <CardHeader title="Variant (optional)" subtitle="Make this a size/colour/model variant of another product" />
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <Field label="Variant of">
                <Select value={f.parentProductId} onChange={(e) => set("parentProductId", e.target.value)}>
                  <option value="">— Not a variant —</option>
                  {parents.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
              </Field>
              <Field label="Attributes" hint="e.g. Colour: Black, Size: 1TB"><Input value={f.variantAttributes} onChange={(e) => set("variantAttributes", e.target.value)} /></Field>
            </div>
          </Card>
        )}
      </div>
      <div className="space-y-5">
        {f.type === "goods" && (
          <Card>
            <CardHeader title="Stock" subtitle={hasInventory ? undefined : "Stock tracking is available on Starter and above"} />
            <div className="space-y-4 p-5">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-brand-600" disabled={!hasInventory} checked={f.trackInventory} onChange={(e) => setF({ ...f, trackInventory: e.target.checked, trackSerials: e.target.checked && f.trackSerials })} /> Track stock</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-brand-600" disabled={!hasInventory || !!id} checked={f.trackSerials} onChange={(e) => setF({ ...f, trackSerials: e.target.checked, trackInventory: e.target.checked || f.trackInventory })} /> Track serial numbers {id && <span className="text-xs text-muted">(change only at zero stock)</span>}</label>
              <Field label="Warranty (months)" hint="Warranty end date is set per serial number when sold"><Input inputMode="numeric" value={f.warrantyMonths} onChange={(e) => set("warrantyMonths", e.target.value)} /></Field>
              {f.trackInventory && <Field label="Low-stock alert at"><Input inputMode="decimal" value={f.reorderLevel} onChange={(e) => set("reorderLevel", e.target.value)} /></Field>}
              {f.trackInventory && !id && <Field label="Opening stock"><Input inputMode="decimal" value={f.openingStock} onChange={(e) => set("openingStock", e.target.value)} /></Field>}
              {f.trackSerials && !id && Number(f.openingStock) > 0 && (
                <Field label="Opening serial numbers" hint={`Enter ${Number(f.openingStock)} serials, comma separated`}><Textarea rows={2} value={f.openingSerials} onChange={(e) => set("openingSerials", e.target.value)} /></Field>
              )}
            </div>
          </Card>
        )}
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p>}
        <Button type="submit" size="lg" className="w-full" disabled={busy || !f.name.trim()}>{busy ? "Saving…" : id ? "Save changes" : "Save product"}</Button>
      </div>
    </form>
  );
}
