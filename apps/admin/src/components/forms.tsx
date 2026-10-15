"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FEATURES, LIMITS } from "@cba/core";
import { Button, Card, CardHeader, Field, Input, Select, Textarea } from "@cba/ui";
import { adminApi } from "./client";

type Plan = { code: string; name: string; description: string | null; priceMonthly: number; priceYearly: number; trialDays: number; limits: Record<string, number | null>; features: Record<string, boolean>; isActive: boolean; isPublic: boolean; sortOrder: number };

export function PlanEditor({ plan }: { plan: Plan | null }) {
  const router = useRouter();
  const blank: Plan = { code: "", name: "", description: "", priceMonthly: 0, priceYearly: 0, trialDays: 0, limits: Object.fromEntries(Object.keys(LIMITS).map((k) => [k, 0])), features: Object.fromEntries(Object.keys(FEATURES).map((k) => [k, false])), isActive: true, isPublic: true, sortOrder: 10 };
  const [p, setP] = useState<Plan>(plan ?? blank);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <Card>
      <CardHeader title={plan ? `${plan.name} (${plan.code})` : "New plan"} subtitle="Prices in rupees (stored in paise). Blank limit = unlimited." />
      <div className="grid gap-3 p-5 sm:grid-cols-4">
        <Field label="Code"><Input value={p.code} disabled={!!plan} onChange={(e) => setP({ ...p, code: e.target.value })} /></Field>
        <Field label="Name"><Input value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} /></Field>
        <Field label="Monthly ₹"><Input inputMode="numeric" value={p.priceMonthly / 100} onChange={(e) => setP({ ...p, priceMonthly: Math.round(Number(e.target.value || 0) * 100) })} /></Field>
        <Field label="Yearly ₹"><Input inputMode="numeric" value={p.priceYearly / 100} onChange={(e) => setP({ ...p, priceYearly: Math.round(Number(e.target.value || 0) * 100) })} /></Field>
        <Field label="Trial days"><Input inputMode="numeric" value={p.trialDays} onChange={(e) => setP({ ...p, trialDays: Number(e.target.value || 0) })} /></Field>
        <Field label="Sort order"><Input inputMode="numeric" value={p.sortOrder} onChange={(e) => setP({ ...p, sortOrder: Number(e.target.value || 0) })} /></Field>
        <Field label="Active"><Select value={p.isActive ? "1" : "0"} onChange={(e) => setP({ ...p, isActive: e.target.value === "1" })}><option value="1">Yes</option><option value="0">No</option></Select></Field>
        <Field label="Shown on pricing page"><Select value={p.isPublic ? "1" : "0"} onChange={(e) => setP({ ...p, isPublic: e.target.value === "1" })}><option value="1">Yes</option><option value="0">No</option></Select></Field>
        <Field label="Description" className="sm:col-span-4"><Textarea rows={1} value={p.description ?? ""} onChange={(e) => setP({ ...p, description: e.target.value })} /></Field>
        {Object.entries(LIMITS).map(([k, label]) => (
          <Field key={k} label={label}><Input inputMode="numeric" value={p.limits[k] ?? ""} placeholder="∞" onChange={(e) => setP({ ...p, limits: { ...p.limits, [k]: e.target.value === "" ? null : Number(e.target.value) } })} /></Field>
        ))}
        <div className="grid gap-1 sm:col-span-4 sm:grid-cols-3">
          {Object.entries(FEATURES).map(([k, label]) => (
            <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-brand-600" checked={!!p.features[k]} onChange={(e) => setP({ ...p, features: { ...p.features, [k]: e.target.checked } })} />{label}</label>
          ))}
        </div>
        <div className="flex items-center gap-3 sm:col-span-4">
          <Button onClick={async () => {
            setMsg(null);
            try {
              await adminApi("plans", { ...p, description: p.description || null });
              setMsg("Saved");
              router.refresh();
            } catch (e) {
              setMsg(e instanceof Error ? e.message : "Failed");
            }
          }}>Save plan</Button>
          {msg && <span className="text-sm text-muted">{msg}</span>}
        </div>
      </div>
    </Card>
  );
}

export function SubscriptionOverride({ businessId, plans, current }: { businessId: string; plans: Array<{ code: string; name: string }>; current: { planCode: string; status: string } }) {
  const router = useRouter();
  const [f, setF] = useState({ planCode: current.planCode, status: current.status === "trialing" ? "trialing" : "active", periodEnd: "", reason: "" });
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="grid gap-3 p-5 sm:grid-cols-2">
      <Field label="Plan"><Select value={f.planCode} onChange={(e) => setF({ ...f, planCode: e.target.value })}>{plans.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</Select></Field>
      <Field label="Status"><Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>{["trialing", "active", "past_due", "cancelled", "expired"].map((s) => <option key={s} value={s}>{s}</option>)}</Select></Field>
      <Field label="Valid until" hint="Trial end for trialing, period end otherwise"><Input type="date" value={f.periodEnd} onChange={(e) => setF({ ...f, periodEnd: e.target.value })} /></Field>
      <Field label="Reason (e.g. paid by NEFT, UTR …)"><Input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button size="sm" disabled={f.reason.trim().length < 5} onClick={async () => {
          try {
            await adminApi(`businesses/${businessId}/subscription`, { planCode: f.planCode, status: f.status, periodEnd: f.periodEnd ? new Date(`${f.periodEnd}T23:59:59+05:30`).toISOString() : null, reason: f.reason });
            setMsg("Updated");
            router.refresh();
          } catch (e) {
            setMsg(e instanceof Error ? e.message : "Failed");
          }
        }}>Apply change</Button>
        {msg && <span className="text-sm text-muted">{msg}</span>}
      </div>
    </div>
  );
}

export function ReplyForm({ id }: { id: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [close, setClose] = useState(false);
  return (
    <div className="space-y-3 p-5">
      <Textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Reply to the customer" />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-brand-600" checked={close} onChange={(e) => setClose(e.target.checked)} /> Close ticket</label>
      <Button disabled={!body.trim()} onClick={async () => { await adminApi(`support/${id}/reply`, { body, close }); setBody(""); router.refresh(); }}>Send reply</Button>
    </div>
  );
}

export function SettingRow({ k, value }: { k: string; value: unknown }) {
  const router = useRouter();
  const [v, setV] = useState(String(value));
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-end gap-3 px-5 py-3">
      <Field label={k.replace(/_/g, " ")}><Input inputMode="numeric" value={v} onChange={(e) => setV(e.target.value)} /></Field>
      <Button size="sm" onClick={async () => { try { await adminApi("settings", { key: k, value: Number(v) }); setMsg("Saved"); router.refresh(); } catch (e) { setMsg(e instanceof Error ? e.message : "Failed"); } }}>Save</Button>
      {msg && <span className="text-sm text-muted">{msg}</span>}
    </div>
  );
}
