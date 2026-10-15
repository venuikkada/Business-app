"use client";

import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatINR, formatINRCompact } from "@cba/core";

export function TrendChart({ data }: { data: Array<{ period: string; sales: string; purchases: string; collected: string }> }) {
  const rows = data.map((d) => ({ period: d.period.length === 10 ? d.period.slice(8, 10) + "/" + d.period.slice(5, 7) : d.period, Sales: Number(d.sales), Purchases: Number(d.purchases), Collected: Number(d.collected) }));
  if (!rows.length) return <div className="grid h-64 place-items-center text-sm text-muted">No sales in this period yet.</div>;
  return (
    <div className="h-72 w-full" role="img" aria-label="Sales, purchases and collections over time">
      <ResponsiveContainer>
        <AreaChart data={rows} margin={{ top: 10, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="gSales" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ea580c" stopOpacity={0.25} />
              <stop offset="100%" stopColor="#ea580c" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#f1f1f0" vertical={false} />
          <XAxis dataKey="period" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#6b7280" }} minTickGap={16} />
          <YAxis tickFormatter={(v) => formatINRCompact(v)} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#6b7280" }} width={56} />
          <Tooltip formatter={(v: number) => formatINR(v)} contentStyle={{ borderRadius: 10, borderColor: "#e5e7eb", fontSize: 12 }} />
          <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
          <Area type="linear" dataKey="Sales" stroke="#ea580c" strokeWidth={2} fill="url(#gSales)" />
          <Area type="linear" dataKey="Collected" stroke="#059669" strokeWidth={2} fill="transparent" />
          <Area type="linear" dataKey="Purchases" stroke="#78716c" strokeWidth={1.5} strokeDasharray="4 3" fill="transparent" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function BarsChart({ data, keys, labelKey }: { data: Array<Record<string, unknown>>; keys: Array<{ key: string; label: string; color: string }>; labelKey: string }) {
  const rows = data.map((d) => ({ ...Object.fromEntries(keys.map((k) => [k.label, Number(d[k.key] ?? 0)])), label: String(d[labelKey] ?? "") }));
  if (!rows.length) return null;
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer>
        <BarChart data={rows} margin={{ top: 10, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="#f1f1f0" vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#6b7280" }} />
          <YAxis tickFormatter={(v) => formatINRCompact(v)} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#6b7280" }} width={56} />
          <Tooltip formatter={(v: number) => formatINR(v)} contentStyle={{ borderRadius: 10, fontSize: 12 }} />
          <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
          {keys.map((k) => <Bar key={k.key} dataKey={k.label} fill={k.color} radius={[4, 4, 0, 0]} maxBarSize={36} />)}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
