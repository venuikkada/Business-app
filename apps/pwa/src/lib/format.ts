import { formatDateIN, formatINR, formatIndianNumber, formatIndianPhone } from "@cba/core";

/** +919876543210 -> +91 98765 43210 */
export const phone = (v: string | null | undefined) => formatIndianPhone(v);

/** ₹1,23,456.00 — lakh/crore grouping */
export const inr = (v: string | number) => formatINR(v);
export const num = (v: string | number, d = 0) => formatIndianNumber(v, d);
/** dd/mm/yyyy in IST */
export const date = (v: string | Date | null | undefined) =>
  typeof v === "string" && v.length > 10 ? formatDateIN(new Date(v)) : formatDateIN(v);

export function dateTime(v: string | Date | null | undefined): string {
  if (!v) return "";
  const d = new Date(v);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true,
  }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${g("day")}/${g("month")}/${g("year")} ${g("hour")}:${g("minute")} ${g("dayPeriod").toUpperCase()}`;
}

export function deviceName(ua: string | null): string {
  if (!ua) return "Unknown device";
  const os = /Android/i.test(ua) ? "Android" : /iPhone|iPad/i.test(ua) ? "iPhone/iPad" : /Windows/i.test(ua) ? "Windows" : /Mac OS/i.test(ua) ? "Mac" : /Linux/i.test(ua) ? "Linux" : "Device";
  const br = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return `${br} on ${os}`;
}
