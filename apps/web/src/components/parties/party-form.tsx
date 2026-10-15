"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { INDIAN_STATES, validateGSTIN } from "@cba/core";
import { api, ApiError, newIdempotencyKey } from "@/lib/api-client";
import { Button, Card, CardHeader, Field, Input, Select, Textarea } from "../ui";
import { Modal, useToast } from "../client";
import { useApiForm } from "../forms/use-api-form";

type Addr = { line1: string; line2: string; city: string; stateCode: string; pincode: string };
export interface PartyFormValue {
  name: string; isCustomer: boolean; isSupplier: boolean; contactPerson: string; phone: string; altPhone: string; email: string; gstin: string; pan: string;
  billingAddress: Addr; shipSame: boolean; shippingAddress: Addr; openingBalance: string; openingSide: "receivable" | "payable"; creditLimit: string;
  paymentTermsDays: string; notes: string; tags: string; whatsappOptIn: boolean;
}



export function PartyForm({ id, initial, canEditOpening }: { id?: string; initial: PartyFormValue; canEditOpening: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [f, setF] = useState(initial);
  const [dups, setDups] = useState<Array<{ id: string; name: string; reason: string }>>([]);
  const { busy, error, fields, run } = useApiForm();
  const g = f.gstin ? validateGSTIN(f.gstin) : null;
  const setA = (which: "billingAddress" | "shippingAddress", k: keyof Addr, v: string) => setF({ ...f, [which]: { ...f[which], [k]: v } });

  async function save(confirmDuplicate = false) {
    const ob = f.openingBalance ? (f.openingSide === "payable" ? `-${Math.abs(Number(f.openingBalance))}` : String(Math.abs(Number(f.openingBalance)))) : "0";
    const body = {
      name: f.name, isCustomer: f.isCustomer, isSupplier: f.isSupplier, contactPerson: f.contactPerson || null, phone: f.phone || null, altPhone: f.altPhone || null,
      email: f.email || null, gstin: f.gstin || null, pan: f.pan || null,
      billingAddress: { ...f.billingAddress, stateCode: f.billingAddress.stateCode || (g?.valid ? g.stateCode : null) },
      shippingAddress: f.shipSame ? null : f.shippingAddress,
      openingBalance: ob, creditLimit: f.creditLimit || null, paymentTermsDays: f.paymentTermsDays ? Number(f.paymentTermsDays) : null,
      notes: f.notes || null, tags: f.tags.split(",").map((x) => x.trim()).filter(Boolean), whatsappOptIn: f.whatsappOptIn, confirmDuplicate,
    };
    try {
      const r = await run(() => (id ? api<{ id: string }>("PUT", `parties/${id}`, body) : api<{ id: string }>("POST", "parties", body, { idempotencyKey: newIdempotencyKey() })));
      toast("success", id ? "Saved" : "Added");
      router.push(`/parties/${r!.id}`);
      router.refresh();
    } catch (e) {
      if (e instanceof ApiError && e.code === "POSSIBLE_DUPLICATE") setDups((e.details?.duplicates ?? []) as typeof dups);
    }
  }

  return (
    <form className="grid gap-5 lg:grid-cols-3" onSubmit={(e) => { e.preventDefault(); save(false); }}>
      <div className="space-y-5 lg:col-span-2">
        <Card>
          <CardHeader title="Details" />
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <Field label="Name" required error={fields.name} className="sm:col-span-2">
              <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required autoFocus={!id} />
            </Field>
            <div className="flex gap-5 text-sm sm:col-span-2">
              <label className="flex items-center gap-2"><input type="checkbox" className="accent-brand-600" checked={f.isCustomer} onChange={(e) => setF({ ...f, isCustomer: e.target.checked })} /> Customer</label>
              <label className="flex items-center gap-2"><input type="checkbox" className="accent-brand-600" checked={f.isSupplier} onChange={(e) => setF({ ...f, isSupplier: e.target.checked })} /> Supplier</label>
            </div>
            <Field label="Mobile" error={fields.phone}><Input type="tel" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="98765 43210" /></Field>
            <Field label="Email" error={fields.email}><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
            <Field label="GSTIN" error={fields.gstin ?? (g && !g.valid ? g.reason : null)} hint={g?.valid ? `Valid format · state ${g.stateCode}` : "Leave blank for unregistered / B2C"}>
              <Input value={f.gstin} maxLength={15} onChange={(e) => {
                const v = e.target.value.toUpperCase();
                const vg = v.length === 15 ? validateGSTIN(v) : null;
                setF({ ...f, gstin: v, pan: vg?.valid && !f.pan ? vg.pan! : f.pan, billingAddress: vg?.valid && !f.billingAddress.stateCode ? { ...f.billingAddress, stateCode: vg.stateCode! } : f.billingAddress });
              }} />
            </Field>
            <Field label="Contact person"><Input value={f.contactPerson} onChange={(e) => setF({ ...f, contactPerson: e.target.value })} /></Field>
            <label className="flex items-start gap-2 text-sm sm:col-span-2">
              <input type="checkbox" className="mt-0.5 accent-brand-600" checked={f.whatsappOptIn} onChange={(e) => setF({ ...f, whatsappOptIn: e.target.checked })} />
              <span>Customer agreed to receive invoices and reminders on WhatsApp <span className="block text-xs text-muted">Record consent before messaging. The app never sends bulk messages.</span></span>
            </label>
          </div>
        </Card>
        <Card>
          <CardHeader title="Billing address" subtitle="The state decides CGST+SGST or IGST" />
          <AddressFields a={f.billingAddress} set={(k, v) => setA("billingAddress", k, v)} errors={fields} prefix="billingAddress" />
          <label className="flex items-center gap-2 border-t border-line px-5 py-3 text-sm">
            <input type="checkbox" className="accent-brand-600" checked={f.shipSame} onChange={(e) => setF({ ...f, shipSame: e.target.checked })} /> Shipping address is the same
          </label>
          {!f.shipSame && <AddressFields a={f.shippingAddress} set={(k, v) => setA("shippingAddress", k, v)} errors={fields} prefix="shippingAddress" />}
        </Card>
      </div>
      <div className="space-y-5">
        <Card>
          <CardHeader title="Accounts" />
          <div className="space-y-4 p-5">
            <Field label="Opening balance" hint={!canEditOpening && id ? "Only roles with financial access can change this" : "Amount pending from before you started using the app"}>
              <div className="flex">
                <input className="block w-full rounded-l-lg border border-line px-3 py-2 text-sm" inputMode="decimal" value={f.openingBalance} disabled={!!id && !canEditOpening} onChange={(e) => setF({ ...f, openingBalance: e.target.value })} placeholder="0" />
                <select className="rounded-r-lg border border-l-0 border-line bg-stone-50 px-2 text-sm" value={f.openingSide} disabled={!!id && !canEditOpening} onChange={(e) => setF({ ...f, openingSide: e.target.value as "receivable" | "payable" })}>
                  <option value="receivable">They owe me</option>
                  <option value="payable">I owe them</option>
                </select>
              </div>
            </Field>
            <Field label="Credit limit (₹)"><Input inputMode="decimal" value={f.creditLimit} onChange={(e) => setF({ ...f, creditLimit: e.target.value })} /></Field>
            <Field label="Payment terms (days)" hint="Blank = business default"><Input inputMode="numeric" value={f.paymentTermsDays} onChange={(e) => setF({ ...f, paymentTermsDays: e.target.value })} /></Field>
            <Field label="Tags" hint="Comma separated, e.g. VIP, Pune"><Input value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} /></Field>
            <Field label="Notes"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
          </div>
        </Card>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p>}
        <Button type="submit" size="lg" className="w-full" disabled={busy || !f.name.trim() || (!f.isCustomer && !f.isSupplier) || (!!g && !g.valid)}>{busy ? "Saving…" : id ? "Save changes" : "Save"}</Button>
      </div>
      <Modal open={dups.length > 0} onClose={() => setDups([])} title="This might be a duplicate" footer={<><Button variant="ghost" onClick={() => setDups([])}>Go back</Button><Button onClick={() => { setDups([]); save(true); }}>Save anyway</Button></>}>
        <ul className="space-y-2 text-sm">
          {dups.map((d) => (
            <li key={d.id} className="flex items-center justify-between rounded-lg border border-line px-3 py-2">
              <span>{d.name} <span className="text-xs text-muted">· {d.reason}</span></span>
              <a href={`/parties/${d.id}`} className="text-brand-700">Open</a>
            </li>
          ))}
        </ul>
      </Modal>
    </form>
  );
}

function AddressFields({ a, set, errors, prefix }: { a: Addr; set: (k: keyof Addr, v: string) => void; errors: Record<string, string>; prefix: string }) {
  return (
    <div className="grid gap-4 p-5 sm:grid-cols-2">
      <Field label="Address line 1" className="sm:col-span-2"><Input value={a.line1} onChange={(e) => set("line1", e.target.value)} /></Field>
      <Field label="Address line 2" className="sm:col-span-2"><Input value={a.line2} onChange={(e) => set("line2", e.target.value)} /></Field>
      <Field label="City"><Input value={a.city} onChange={(e) => set("city", e.target.value)} /></Field>
      <Field label="PIN code" error={errors[`${prefix}.pincode`]}><Input inputMode="numeric" maxLength={6} value={a.pincode} onChange={(e) => set("pincode", e.target.value)} /></Field>
      <Field label="State" className="sm:col-span-2">
        <Select value={a.stateCode} onChange={(e) => set("stateCode", e.target.value)}>
          <option value="">Select state</option>
          {INDIAN_STATES.map((s) => <option key={s.code} value={s.code}>{s.name} ({s.code})</option>)}
        </Select>
      </Field>
    </div>
  );
}
