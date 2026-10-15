import Decimal from "decimal.js";

/**
 * All money math uses decimal.js with ROUND_HALF_UP so that results match
 * PostgreSQL numeric rounding and what an accountant expects on paper.
 * Amounts are exchanged as strings with 2 decimals ("1234.50") to avoid
 * floating point drift between client, server and database.
 */
export const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type Dec = InstanceType<typeof D>;
export type Numeric = string | number | Dec;

export function dec(v: Numeric | null | undefined): Dec {
  if (v === null || v === undefined || v === "") return new D(0);
  return new D(v as Decimal.Value);
}

/** Round to paise (2 decimals), half-up. */
export function r2(v: Numeric): Dec {
  return dec(v).toDecimalPlaces(2, D.ROUND_HALF_UP);
}

/** Format a decimal as a fixed 2-decimal string ("12.50"). */
export function money(v: Numeric): string {
  return r2(v).toFixed(2);
}

/** Format quantity with up to 3 decimals, trimming trailing zeros. */
export function qty(v: Numeric): string {
  return dec(v).toDecimalPlaces(3, D.ROUND_HALF_UP).toString();
}

const inrFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** "₹1,23,456.70" — Indian digit grouping. */
export function formatINR(v: Numeric): string {
  return inrFormatter.format(Number(money(v)));
}

/** Indian grouping without currency symbol: "1,23,456.70". */
export function formatIndianNumber(v: Numeric, fractionDigits = 2): string {
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(Number(dec(v).toFixed(fractionDigits)));
}

/** Compact Indian notation for dashboards: ₹1.2L, ₹3.4Cr. */
export function formatINRCompact(v: Numeric): string {
  const n = Number(money(v));
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(2).replace(/\.?0+$/, "")}Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(2).replace(/\.?0+$/, "")}L`;
  if (abs >= 1e3) return `${sign}₹${(abs / 1e3).toFixed(1).replace(/\.?0+$/, "")}K`;
  return formatINR(n);
}

/**
 * Split `total` across `weights` proportionally using the largest remainder
 * method so the parts always sum exactly to `total` (in paise).
 */
export function allocateProportionally(total: Numeric, weights: Numeric[]): Dec[] {
  const totalPaise = r2(total).mul(100);
  const ws = weights.map((w) => dec(w));
  const sumW = ws.reduce((a, b) => a.add(b), new D(0));
  if (ws.length === 0) return [];
  if (sumW.isZero()) return ws.map(() => new D(0));
  const raw = ws.map((w) => totalPaise.mul(w).div(sumW));
  const floors = raw.map((x) => x.floor());
  let remaining = totalPaise.sub(floors.reduce((a, b) => a.add(b), new D(0))).toNumber();
  const order = raw
    .map((x, i) => ({ i, frac: x.sub(x.floor()) }))
    .sort((a, b) => b.frac.comparedTo(a.frac) || a.i - b.i);
  const result = floors.slice();
  for (let k = 0; remaining > 0 && k < order.length; k++, remaining--) {
    const idx = order[k]!.i;
    result[idx] = result[idx]!.add(1);
  }
  return result.map((p) => p.div(100));
}
