import Link from "next/link";
import { cn } from "./ui";

const PRESETS = [
  ["today", "Today"], ["week", "This week"], ["month", "This month"], ["last_month", "Last month"], ["fy", "This FY"], ["last_fy", "Last FY"],
] as const;

/** Date range filter via query params (?preset=… or ?from=…&to=…). Works without JavaScript. */
export function DateFilter({ base, preset, from, to, extra = {} }: { base: string; preset?: string; from?: string; to?: string; extra?: Record<string, string | undefined> }) {
  const current = from && to ? "custom" : preset ?? "month";
  const keep = Object.entries(extra).filter(([, v]) => v).map(([k, v]) => `&${k}=${encodeURIComponent(v!)}`).join("");
  return (
    <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex gap-1 overflow-x-auto rounded-xl border border-line bg-white p-1">
        {PRESETS.map(([k, l]) => (
          <Link key={k} href={`${base}?preset=${k}${keep}`} className={cn("whitespace-nowrap rounded-lg px-3 py-1.5 text-sm", current === k ? "bg-brand-600 font-medium text-white" : "text-stone-600 hover:bg-stone-100")}>
            {l}
          </Link>
        ))}
      </div>
      <form method="get" action={base} className="flex w-full flex-wrap items-center gap-2 text-sm sm:w-auto sm:flex-nowrap">
        {Object.entries(extra).filter(([, v]) => v).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <input type="date" name="from" defaultValue={from} className="h-9 min-w-0 flex-1 rounded-lg border border-line px-2 sm:flex-none" aria-label="From date" required />
        <span className="text-muted">to</span>
        <input type="date" name="to" defaultValue={to} className="h-9 min-w-0 flex-1 rounded-lg border border-line px-2 sm:flex-none" aria-label="To date" required />
        <button className="h-9 rounded-lg border border-line bg-white px-3 hover:bg-stone-50">Go</button>
      </form>
    </div>
  );
}
