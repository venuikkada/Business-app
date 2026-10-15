"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { INDIAN_STATES, validateGSTIN } from "@cba/core";
import { api, ApiError } from "@/lib/api-client";
import { Button, Card, Field, Input, Select, cn } from "@/components/ui";

const TYPES = [
  ["retail", "Retail shop"], ["wholesale", "Wholesaler"], ["distributor", "Distributor"], ["it_dealer", "IT products dealer"], ["cctv", "CCTV & security"],
  ["computer_shop", "Computer shop"], ["electronics", "Electronics store"], ["services", "Service company"], ["freelancer", "Freelancer"], ["other", "Other"],
] as const;

export function BusinessOnboarding() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({
    name: "", businessType: "retail", stateCode: "", city: "", line1: "", pincode: "", phone: "", email: "",
    registered: "regular" as "regular" | "composition" | "unregistered", gstin: "", pricesIncludeTax: false, upiId: "",
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const gst = f.gstin ? validateGSTIN(f.gstin) : null;
  const gstMismatch = gst?.valid && f.stateCode && gst.stateCode !== f.stateCode;

  async function create() {
    setBusy(true);
    setError(null);
    try {
      await api("POST", "businesses", {
        name: f.name, businessType: f.businessType, stateCode: f.stateCode, gstin: f.registered === "unregistered" ? null : f.gstin || null,
        phone: f.phone || null, email: f.email || null, address: { line1: f.line1 || null, city: f.city || null, stateCode: f.stateCode, pincode: f.pincode || null },
        settings: { gstScheme: f.registered, pricesIncludeTax: f.pricesIncludeTax, upiId: f.upiId || null },
      });
      router.push("/dashboard?welcome=1");
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Network problem");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5 sm:p-7">
      <ol className="mb-6 flex items-center gap-2 text-xs font-medium">
        {["Business", "GST", "Billing"].map((s, i) => (
          <li key={s} className={cn("flex items-center gap-2", step >= i + 1 ? "text-brand-700" : "text-muted")}>
            <span className={cn("grid h-6 w-6 place-items-center rounded-full", step >= i + 1 ? "bg-brand-600 text-white" : "bg-stone-100")}>{i + 1}</span>
            {s}
            {i < 2 && <span className="mx-1 h-px w-6 bg-line" />}
          </li>
        ))}
      </ol>

      {step === 1 && (
        <div className="space-y-4">
          <Field label="Business name" required>
            <Input value={f.name} onChange={set("name")} placeholder="e.g. Sharma CCTV & Computers" autoFocus />
          </Field>
          <Field label="What kind of business?">
            <Select value={f.businessType} onChange={set("businessType")}>
              {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="State" required hint="Decides CGST+SGST vs IGST">
              <Select value={f.stateCode} onChange={set("stateCode")}>
                <option value="">Select state</option>
                {INDIAN_STATES.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
              </Select>
            </Field>
            <Field label="City"><Input value={f.city} onChange={set("city")} /></Field>
          </div>
          <Field label="Address"><Input value={f.line1} onChange={set("line1")} placeholder="Shop no., street" /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="PIN code"><Input value={f.pincode} onChange={set("pincode")} inputMode="numeric" maxLength={6} /></Field>
            <Field label="Business phone"><Input value={f.phone} onChange={set("phone")} type="tel" inputMode="tel" /></Field>
          </div>
          <div className="flex justify-end">
            <Button disabled={f.name.trim().length < 2 || !f.stateCode} onClick={() => setStep(2)}>Continue</Button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-medium">GST registration</legend>
            {([
              ["regular", "Registered (regular)", "Charge GST and issue tax invoices"],
              ["composition", "Composition scheme", "Issue a Bill of Supply; no GST charged on sales"],
              ["unregistered", "Not registered", "Issue a Bill of Supply without GST"],
            ] as const).map(([v, l, h]) => (
              <label key={v} className={cn("flex cursor-pointer items-start gap-3 rounded-lg border p-3", f.registered === v ? "border-brand-500 bg-brand-50" : "border-line")}>
                <input type="radio" name="reg" checked={f.registered === v} onChange={() => setF({ ...f, registered: v })} className="mt-1 accent-brand-600" />
                <span>
                  <span className="block text-sm font-medium">{l}</span>
                  <span className="block text-xs text-muted">{h}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {f.registered !== "unregistered" && (
            <Field label="GSTIN" error={gst && !gst.valid ? gst.reason : gstMismatch ? "GSTIN state code does not match the selected state" : null} hint="We check the format and checksum. This is not a GST portal verification.">
              <Input value={f.gstin} onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase() })} maxLength={15} placeholder="27ABCDE1234F1Z5" />
            </Field>
          )}
          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStep(1)}>Back</Button>
            <Button disabled={!!(f.gstin && (!gst?.valid || gstMismatch))} onClick={() => setStep(3)}>Continue</Button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <label className="flex items-start gap-3 rounded-lg border border-line p-3">
            <input type="checkbox" checked={f.pricesIncludeTax} onChange={(e) => setF({ ...f, pricesIncludeTax: e.target.checked })} className="mt-1 accent-brand-600" />
            <span>
              <span className="block text-sm font-medium">My prices include GST</span>
              <span className="block text-xs text-muted">Typical for retail MRP billing. You can change this per bill.</span>
            </span>
          </label>
          <Field label="UPI ID for payments" hint="Printed on invoices with a scan-to-pay QR code (optional)">
            <Input value={f.upiId} onChange={set("upiId")} placeholder="yourshop@okbank" />
          </Field>
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStep(2)}>Back</Button>
            <Button disabled={busy} onClick={create}>{busy ? "Setting up…" : "Create my business"}</Button>
          </div>
          <p className="text-xs text-muted">You start with a 14-day Pro trial. Afterwards you can stay on the Free plan or upgrade.</p>
        </div>
      )}
    </Card>
  );
}
