import Link from "next/link";
import { appTx, camelize } from "@cba/server";
import { FEATURES, formatINR, type Feature } from "@cba/core";
import { buttonClass, cn } from "@/components/ui";

export const metadata = { title: "Pricing" };
export const dynamic = "force-dynamic";

export default async function Pricing() {
  const plans = camelize<{ code: string; name: string; description: string; priceMonthly: number; priceYearly: number; limits: Record<string, number | null>; features: Record<string, boolean> }>(
    await appTx({}, (db) => db.query("select code, name, description, price_monthly, price_yearly, limits, features from plans where is_active and is_public order by sort_order")),
  );
  return (
    <main className="mx-auto max-w-6xl px-4 py-16">
      <h1 className="text-center text-4xl font-semibold tracking-tight">Simple pricing for growing businesses</h1>
      <p className="mt-3 text-center text-stone-600">Start free. Upgrade when you need inventory, staff logins or more branches. Prices exclude GST.</p>
      <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
        {plans.map((p) => (
          <div key={p.code} className={cn("flex flex-col rounded-2xl border p-6", p.code === "pro" ? "border-brand-500 ring-4 ring-brand-100" : "border-line")}>
            <h2 className="text-lg font-semibold">{p.name}</h2>
            <p className="mt-1 min-h-10 text-sm text-muted">{p.description}</p>
            <div className="mt-4 text-3xl font-semibold">{p.priceMonthly ? formatINR(p.priceMonthly / 100).replace(".00", "") : "₹0"}<span className="text-sm font-normal text-muted">/month</span></div>
            {p.priceYearly > 0 && <p className="text-xs text-muted">or {formatINR(p.priceYearly / 100).replace(".00", "")}/year</p>}
            <ul className="mt-5 flex-1 space-y-2 text-sm">
              <li>{p.limits.invoices_per_month === null ? "Unlimited invoices" : `${p.limits.invoices_per_month} invoices / month`}</li>
              <li>{p.limits.users === 1 ? "1 user" : `${p.limits.users} users`}{p.limits.branches && p.limits.branches > 1 ? ` · ${p.limits.branches} branches` : ""}</li>
              {(Object.keys(FEATURES) as Feature[]).filter((f) => p.features[f]).map((f) => <li key={f}>✓ {FEATURES[f]}</li>)}
            </ul>
            <Link href="/register" className={`${buttonClass(p.code === "pro" ? "primary" : "secondary")} mt-6 w-full`}>{p.priceMonthly ? "Start 14-day trial" : "Start free"}</Link>
          </div>
        ))}
      </div>
    </main>
  );
}
