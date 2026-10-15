"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FEATURES, formatINR, type Feature } from "@cba/core";
import { api, ApiError } from "@/lib/api-client";
import { Badge, Button, Card, cn } from "../ui";
import { useToast } from "../client";

type Plan = { code: string; name: string; description: string; priceMonthly: number; priceYearly: number; trialDays: number; limits: Record<string, number | null>; features: Record<string, boolean> };

declare global {
  interface Window {
    Razorpay?: new (o: Record<string, unknown>) => { open(): void; on(e: string, cb: (r: unknown) => void): void };
  }
}

function loadRazorpay(): Promise<boolean> {
  if (window.Razorpay) return Promise.resolve(true);
  return new Promise((res) => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => res(true);
    s.onerror = () => res(false);
    document.body.appendChild(s);
  });
}

export function PlanPicker({ plans, currentCode, status, gatewayConfigured, canEdit }: { plans: Plan[]; currentCode: string; status: string; gatewayConfigured: boolean; canEdit: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [interval, setInterval] = useState<"month" | "year">("month");
  const [busy, setBusy] = useState<string | null>(null);

  async function buy(code: string) {
    setBusy(code);
    try {
      const co = await api<{ orderId: string; amount: number; keyId: string; planName: string; businessName: string; email: string; phone: string | null }>("POST", "billing/checkout", { planCode: code, interval });
      if (!(await loadRazorpay()) || !window.Razorpay) throw new Error("Could not load the payment window. Check your connection.");
      const rz = new window.Razorpay({
        key: co.keyId,
        order_id: co.orderId,
        amount: co.amount,
        currency: "INR",
        name: "CRAZY BUSINESS APP",
        description: `${co.planName} plan (${interval === "year" ? "yearly" : "monthly"}) — ${co.businessName}`,
        prefill: { email: co.email, contact: co.phone ?? undefined },
        theme: { color: "#ea580c" },
        handler: async (r: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
          try {
            // The server verifies the signature AND re-checks the payment with Razorpay before activating.
            await api("POST", "billing/verify", { orderId: r.razorpay_order_id, paymentId: r.razorpay_payment_id, signature: r.razorpay_signature });
            toast("success", "Payment confirmed. Your plan is active.");
          } catch (e) {
            toast("info", e instanceof ApiError ? e.message : "We will confirm your payment shortly.");
          }
          router.refresh();
        },
        modal: { ondismiss: () => setBusy(null) },
      });
      rz.on("payment.failed", () => toast("error", "Payment failed. No money was taken, or it will be refunded by your bank."));
      rz.open();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Failed");
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="mb-4 inline-flex rounded-xl border border-line bg-white p-1 text-sm">
        {(["month", "year"] as const).map((i) => (
          <button key={i} onClick={() => setInterval(i)} className={cn("rounded-lg px-4 py-1.5", interval === i ? "bg-brand-600 text-white" : "text-stone-600")}>
            {i === "month" ? "Monthly" : "Yearly (2 months free)"}
          </button>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {plans.map((p) => {
          const price = interval === "year" ? p.priceYearly : p.priceMonthly;
          const current = p.code === currentCode && (status === "active" || status === "trialing");
          return (
            <Card key={p.code} className={cn("flex flex-col p-5", p.code === "pro" && "border-brand-400 ring-2 ring-brand-100")}>
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">{p.name}</h3>
                {p.code === "pro" && <Badge color="orange">Most popular</Badge>}
                {current && <Badge color="green">{status === "trialing" ? "Trial" : "Current"}</Badge>}
              </div>
              <p className="mt-1 min-h-10 text-sm text-muted">{p.description}</p>
              <div className="mt-3 text-3xl font-semibold">{price ? formatINR(price / 100).replace(".00", "") : "₹0"}<span className="text-sm font-normal text-muted">/{interval === "year" ? "year" : "month"}</span></div>
              <p className="text-xs text-muted">{price ? "+ 18% GST" : "Free forever"}</p>
              <ul className="mt-4 flex-1 space-y-1.5 text-sm">
                <li>{p.limits.invoices_per_month === null ? "Unlimited invoices" : `${p.limits.invoices_per_month} invoices / month`}</li>
                <li>{p.limits.users === 1 ? "1 user" : `Up to ${p.limits.users} users`}{p.limits.branches && p.limits.branches > 1 ? `, ${p.limits.branches} branches` : ""}</li>
                {(Object.keys(FEATURES) as Feature[]).filter((f) => p.features[f]).map((f) => <li key={f} className="text-stone-700">✓ {FEATURES[f]}</li>)}
              </ul>
              {canEdit && price > 0 && (!current || status === "trialing") && (
                <Button className="mt-5 w-full" variant={p.code === "pro" ? "primary" : "secondary"} disabled={!!busy || !gatewayConfigured} onClick={() => buy(p.code)}>
                  {busy === p.code ? "Opening…" : status === "trialing" && current ? "Subscribe now" : `Choose ${p.name}`}
                </Button>
              )}
            </Card>
          );
        })}
      </div>
      {!gatewayConfigured && <p className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">Online payment is not configured on this installation yet. Contact support to upgrade by bank transfer — your plan will be activated manually.</p>}
    </div>
  );
}
