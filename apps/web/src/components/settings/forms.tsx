"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { INDIAN_STATES, validateGSTIN, DOC_TYPE_META, type BusinessSettingsInput } from "@cba/core";
import { api, ApiError } from "@/lib/api-client";
import { Button, Card, CardHeader, Field, Input, Select, Textarea } from "../ui";
import { useToast } from "../client";
import { useApiForm } from "../forms/use-api-form";

export interface ProfileValue {
  name: string; legalName: string; businessType: string; gstin: string; pan: string; phone: string; email: string;
  line1: string; line2: string; city: string; pincode: string; stateCode: string;
}

export function BusinessProfileForm({ initial, logoUrl }: { initial: ProfileValue; logoUrl: string | null }) {
  const router = useRouter();
  const toast = useToast();
  const [f, setF] = useState(initial);
  const { busy, error, fields, run } = useApiForm();
  const g = f.gstin ? validateGSTIN(f.gstin) : null;
  const set = (k: keyof ProfileValue) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader title="Business profile" subtitle="Printed on invoices and quotations" />
        <form
          className="grid gap-4 p-5 sm:grid-cols-2"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await run(() => api("PUT", "business", { name: f.name, legalName: f.legalName || null, businessType: f.businessType, gstin: f.gstin || null, pan: f.pan || null, phone: f.phone || null, email: f.email || null, stateCode: f.stateCode, address: { line1: f.line1 || null, line2: f.line2 || null, city: f.city || null, stateCode: f.stateCode, pincode: f.pincode || null } }));
              toast("success", "Profile saved");
              router.refresh();
            } catch { /* shown */ }
          }}
        >
          <Field label="Business name" required error={fields.name}><Input value={f.name} onChange={set("name")} /></Field>
          <Field label="Legal name (if different)"><Input value={f.legalName} onChange={set("legalName")} /></Field>
          <Field label="GSTIN" error={fields.gstin ?? (g && !g.valid ? g.reason : null)}><Input value={f.gstin} maxLength={15} onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase() })} /></Field>
          <Field label="PAN" error={fields.pan}><Input value={f.pan} maxLength={10} onChange={(e) => setF({ ...f, pan: e.target.value.toUpperCase() })} /></Field>
          <Field label="Phone" error={fields.phone}><Input value={f.phone} onChange={set("phone")} /></Field>
          <Field label="Email" error={fields.email}><Input type="email" value={f.email} onChange={set("email")} /></Field>
          <Field label="Address line 1" className="sm:col-span-2"><Input value={f.line1} onChange={set("line1")} /></Field>
          <Field label="Address line 2" className="sm:col-span-2"><Input value={f.line2} onChange={set("line2")} /></Field>
          <Field label="City"><Input value={f.city} onChange={set("city")} /></Field>
          <Field label="PIN code" error={fields["address.pincode"]}><Input value={f.pincode} onChange={set("pincode")} /></Field>
          <Field label="State" className="sm:col-span-2"><Select value={f.stateCode} onChange={set("stateCode")}>{INDIAN_STATES.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}</Select></Field>
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 sm:col-span-2">{error}</p>}
          <div className="sm:col-span-2"><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save profile"}</Button></div>
        </form>
      </Card>
      <Card className="h-fit">
        <CardHeader title="Logo" subtitle="PNG/JPG/WEBP up to 5 MB" />
        <div className="space-y-3 p-5">
          {logoUrl ? <img src={logoUrl} alt="Business logo" className="h-24 w-24 rounded-lg border border-line object-contain" /> : <div className="grid h-24 w-24 place-items-center rounded-lg border border-dashed border-line text-xs text-muted">No logo</div>}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="block text-sm"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const fd = new FormData();
              fd.append("file", file);
              fd.append("purpose", "logo");
              try {
                await api("POST", "files", fd);
                toast("success", "Logo updated");
                router.refresh();
              } catch (err) {
                toast("error", err instanceof ApiError ? err.message : "Upload failed");
              }
            }}
          />
          {logoUrl && <Button size="sm" variant="ghost" onClick={async () => { await api("DELETE", "business/logo"); router.refresh(); }}>Remove logo</Button>}
        </div>
      </Card>
    </div>
  );
}

const PREFIX_TYPES = ["invoice", "quotation", "sales_order", "delivery_challan", "credit_note", "purchase_order", "purchase_bill", "debit_note"] as const;

export function PreferencesForm({ initial }: { initial: BusinessSettingsInput }) {
  const router = useRouter();
  const toast = useToast();
  const [s, setS] = useState(initial);
  const { busy, error, fields, run } = useApiForm();
  const set = <K extends keyof BusinessSettingsInput>(k: K, v: BusinessSettingsInput[K]) => setS({ ...s, [k]: v });
  const num = (v: string) => (v === "" ? null : Number(v));
  return (
    <form
      className="space-y-5"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await run(() => api("PUT", "business/settings", s));
          toast("success", "Settings saved");
          router.refresh();
        } catch { /* shown */ }
      }}
    >
      <Card>
        <CardHeader title="GST & pricing" />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="GST registration" hint="Composition and unregistered businesses issue a Bill of Supply without GST">
            <Select value={s.gstScheme} onChange={(e) => set("gstScheme", e.target.value as BusinessSettingsInput["gstScheme"])}>
              <option value="regular">Registered — regular</option>
              <option value="composition">Composition scheme</option>
              <option value="unregistered">Not registered</option>
            </Select>
          </Field>
          <div className="space-y-2 pt-6 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" className="accent-brand-600" checked={s.pricesIncludeTax} onChange={(e) => set("pricesIncludeTax", e.target.checked)} /> Prices include GST by default</label>
            <label className="flex items-center gap-2"><input type="checkbox" className="accent-brand-600" checked={s.roundOffTotals} onChange={(e) => set("roundOffTotals", e.target.checked)} /> Round off totals to the nearest rupee</label>
          </div>
          <Field label="Default payment terms (days)"><Input inputMode="numeric" value={s.defaultPaymentTermsDays} onChange={(e) => set("defaultPaymentTermsDays", Number(e.target.value || 0))} /></Field>
          <Field label="Quotation validity (days)"><Input inputMode="numeric" value={s.quotationValidityDays} onChange={(e) => set("quotationValidityDays", Number(e.target.value || 15))} /></Field>
        </div>
      </Card>
      <Card>
        <CardHeader title="Bank & UPI" subtitle="Printed on invoices; UPI adds a scan-to-pay QR code" />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="Bank name"><Input value={s.bankName ?? ""} onChange={(e) => set("bankName", e.target.value || null)} /></Field>
          <Field label="Account holder name"><Input value={s.bankAccountName ?? ""} onChange={(e) => set("bankAccountName", e.target.value || null)} /></Field>
          <Field label="Account number" error={fields.bankAccountNumber}><Input value={s.bankAccountNumber ?? ""} onChange={(e) => set("bankAccountNumber", e.target.value || null)} /></Field>
          <Field label="IFSC" error={fields.bankIfsc}><Input value={s.bankIfsc ?? ""} onChange={(e) => set("bankIfsc", e.target.value.toUpperCase() || null)} /></Field>
          <Field label="UPI ID" error={fields.upiId}><Input value={s.upiId ?? ""} onChange={(e) => set("upiId", e.target.value || null)} placeholder="shop@okhdfcbank" /></Field>
        </div>
      </Card>
      <Card>
        <CardHeader title="Default terms" />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="Invoice terms"><Textarea rows={4} value={s.invoiceTerms ?? ""} onChange={(e) => set("invoiceTerms", e.target.value || null)} /></Field>
          <Field label="Quotation terms"><Textarea rows={4} value={s.quotationTerms ?? ""} onChange={(e) => set("quotationTerms", e.target.value || null)} /></Field>
        </div>
      </Card>
      <Card>
        <CardHeader title="Document numbering" subtitle="Prefix per document type, e.g. INV → INV/26-27/0001. Numbers restart every financial year." />
        <div className="grid gap-3 p-5 sm:grid-cols-4">
          {PREFIX_TYPES.map((t) => (
            <Field key={t} label={DOC_TYPE_META[t].label} error={fields[`numberPrefixes.${t}`]}>
              <Input value={s.numberPrefixes?.[t] ?? DOC_TYPE_META[t].prefix} maxLength={5} onChange={(e) => set("numberPrefixes", { ...s.numberPrefixes, [t]: e.target.value.toUpperCase() })} />
            </Field>
          ))}
        </div>
      </Card>
      <Card>
        <CardHeader title="Controls & approvals" subtitle="Staff need owner/manager approval above these limits. Leave blank to switch off." />
        <div className="grid gap-4 p-5 sm:grid-cols-3">
          <Field label="Discount above (%)"><Input inputMode="decimal" value={s.discountApprovalPercent ?? ""} onChange={(e) => set("discountApprovalPercent", num(e.target.value))} /></Field>
          <Field label="Refund above (₹)"><Input inputMode="decimal" value={s.refundApprovalAmount ?? ""} onChange={(e) => set("refundApprovalAmount", e.target.value || null)} /></Field>
          <Field label="Stock adjustment above (qty)"><Input inputMode="decimal" value={s.stockAdjustmentApprovalQty ?? ""} onChange={(e) => set("stockAdjustmentApprovalQty", num(e.target.value))} /></Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-3"><input type="checkbox" className="accent-brand-600" checked={s.allowNegativeStock} onChange={(e) => set("allowNegativeStock", e.target.checked)} /> Allow selling items that are out of stock (not recommended)</label>
          <label className="flex items-center gap-2 text-sm sm:col-span-3"><input type="checkbox" className="accent-brand-600" checked={s.showBrandingFooter} onChange={(e) => set("showBrandingFooter", e.target.checked)} /> Show &quot;Generated with CRAZY BUSINESS APP&quot; on PDFs (always on for the Free plan)</label>
        </div>
      </Card>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <Button type="submit" size="lg" disabled={busy}>{busy ? "Saving…" : "Save settings"}</Button>
    </form>
  );
}
