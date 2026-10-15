import { dec, type Numeric } from "./money";

/** GST state / UT codes used for place of supply. */
export const INDIAN_STATES: ReadonlyArray<{ code: string; name: string }> = [
  { code: "01", name: "Jammu and Kashmir" },
  { code: "02", name: "Himachal Pradesh" },
  { code: "03", name: "Punjab" },
  { code: "04", name: "Chandigarh" },
  { code: "05", name: "Uttarakhand" },
  { code: "06", name: "Haryana" },
  { code: "07", name: "Delhi" },
  { code: "08", name: "Rajasthan" },
  { code: "09", name: "Uttar Pradesh" },
  { code: "10", name: "Bihar" },
  { code: "11", name: "Sikkim" },
  { code: "12", name: "Arunachal Pradesh" },
  { code: "13", name: "Nagaland" },
  { code: "14", name: "Manipur" },
  { code: "15", name: "Mizoram" },
  { code: "16", name: "Tripura" },
  { code: "17", name: "Meghalaya" },
  { code: "18", name: "Assam" },
  { code: "19", name: "West Bengal" },
  { code: "20", name: "Jharkhand" },
  { code: "21", name: "Odisha" },
  { code: "22", name: "Chhattisgarh" },
  { code: "23", name: "Madhya Pradesh" },
  { code: "24", name: "Gujarat" },
  { code: "26", name: "Dadra and Nagar Haveli and Daman and Diu" },
  { code: "27", name: "Maharashtra" },
  { code: "29", name: "Karnataka" },
  { code: "30", name: "Goa" },
  { code: "31", name: "Lakshadweep" },
  { code: "32", name: "Kerala" },
  { code: "33", name: "Tamil Nadu" },
  { code: "34", name: "Puducherry" },
  { code: "35", name: "Andaman and Nicobar Islands" },
  { code: "36", name: "Telangana" },
  { code: "37", name: "Andhra Pradesh" },
  { code: "38", name: "Ladakh" },
  { code: "97", name: "Other Territory" },
];

export function stateName(code: string | null | undefined): string {
  return INDIAN_STATES.find((s) => s.code === code)?.name ?? "";
}

const GSTIN_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Computes the GSTIN check character for the first 14 characters. */
export function gstinCheckChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = GSTIN_CHARS.indexOf(first14[i]!);
    if (v < 0) return "?";
    const product = v * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36]!;
}

export interface GstinCheck {
  valid: boolean;
  reason?: string;
  stateCode?: string;
  pan?: string;
}

/**
 * Structural validation of a GSTIN (format, state code and checksum).
 * This does NOT confirm that the GSTIN is registered on the GST portal.
 */
export function validateGSTIN(input: string): GstinCheck {
  const g = input.trim().toUpperCase();
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g)) {
    return { valid: false, reason: "GSTIN must be 15 characters like 29ABCDE1234F1Z5" };
  }
  const stateCode = g.slice(0, 2);
  if (!INDIAN_STATES.some((s) => s.code === stateCode)) return { valid: false, reason: "Unknown state code in GSTIN" };
  if (gstinCheckChar(g.slice(0, 14)) !== g[14]) return { valid: false, reason: "GSTIN checksum does not match" };
  return { valid: true, stateCode, pan: g.slice(2, 12) };
}

export function validatePAN(input: string): boolean {
  return /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(input.trim().toUpperCase());
}

export function validatePincode(input: string): boolean {
  return /^[1-9][0-9]{5}$/.test(input.trim());
}

/**
 * Normalises Indian mobile numbers to E.164 (+91XXXXXXXXXX).
 * Returns null when the number is not a valid Indian mobile number.
 */
export function normalizeIndianPhone(input: string): string | null {
  let d = input.replace(/[^\d+]/g, "");
  if (d.startsWith("+")) {
    if (!d.startsWith("+91")) return null;
    d = d.slice(3);
  } else if (d.startsWith("0091")) d = d.slice(4);
  else if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (!/^[6-9]\d{9}$/.test(d)) return null;
  return `+91${d}`;
}

/** "+91 98765 43210" */
export function formatIndianPhone(e164: string | null | undefined): string {
  if (!e164) return "";
  const m = /^\+91(\d{5})(\d{5})$/.exec(e164);
  return m ? `+91 ${m[1]} ${m[2]}` : e164;
}

export const IST_TIMEZONE = "Asia/Kolkata";

/** Calendar date (YYYY-MM-DD) in India for the given instant. */
export function istDate(at: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: IST_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
  return parts; // en-CA yields YYYY-MM-DD
}

/** Indian date format DD/MM/YYYY from an ISO date or Date. */
export function formatDateIN(v: string | Date | null | undefined): string {
  if (!v) return "";
  const iso = typeof v === "string" ? v.slice(0, 10) : istDate(v);
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "15 Oct 2026" */
export function formatDateLong(v: string | Date | null | undefined): string {
  if (!v) return "";
  const iso = typeof v === "string" ? v.slice(0, 10) : istDate(v);
  const [y, m, d] = iso.split("-");
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}

export function formatDateTimeIN(v: string | Date | null | undefined): string {
  if (!v) return "";
  const d = typeof v === "string" ? new Date(v) : v;
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: IST_TIMEZONE,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(d);
}

/**
 * Indian financial year label for a date, e.g. 2026-10-15 → "2026-27".
 * `startMonth` is 4 (April) for almost every business.
 */
export function financialYear(isoDate: string, startMonth = 4): string {
  const [y, m] = isoDate.split("-").map(Number) as [number, number];
  const startYear = m >= startMonth ? y : y - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

/** Short FY used inside document numbers: "26-27". */
export function financialYearShort(isoDate: string, startMonth = 4): string {
  const fy = financialYear(isoDate, startMonth);
  return `${fy.slice(2, 4)}-${fy.slice(5, 7)}`;
}

export function financialYearRange(isoDate: string, startMonth = 4): { from: string; to: string } {
  const [y, m] = isoDate.split("-").map(Number) as [number, number];
  const startYear = m >= startMonth ? y : y - 1;
  const from = `${startYear}-${String(startMonth).padStart(2, "0")}-01`;
  const endMonth = startMonth === 1 ? 12 : startMonth - 1;
  const endYear = startMonth === 1 ? startYear : startYear + 1;
  const lastDay = new Date(Date.UTC(endYear, endMonth, 0)).getUTCDate();
  return { from, to: `${endYear}-${String(endMonth).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}` };
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${toIso.slice(0, 10)}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

export type DateRangePreset = "today" | "yesterday" | "week" | "month" | "last_month" | "quarter" | "fy" | "last_fy" | "custom";

export function dateRangeForPreset(preset: DateRangePreset, today = istDate(), fyStartMonth = 4): { from: string; to: string } {
  const [y, m] = today.split("-").map(Number) as [number, number];
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const d = addDays(today, -1);
      return { from: d, to: d };
    }
    case "week": {
      // Week starts Monday.
      const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
      return { from: addDays(today, -dow), to: today };
    }
    case "month":
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case "last_month": {
      const lm = m === 1 ? 12 : m - 1;
      const ly = m === 1 ? y - 1 : y;
      const last = new Date(Date.UTC(ly, lm, 0)).getUTCDate();
      const mm = String(lm).padStart(2, "0");
      return { from: `${ly}-${mm}-01`, to: `${ly}-${mm}-${String(last).padStart(2, "0")}` };
    }
    case "quarter": {
      const qStart = Math.floor((m - 1) / 3) * 3 + 1;
      return { from: `${y}-${String(qStart).padStart(2, "0")}-01`, to: today };
    }
    case "fy":
      return { from: financialYearRange(today, fyStartMonth).from, to: today };
    case "last_fy": {
      const cur = financialYearRange(today, fyStartMonth);
      return financialYearRange(addDays(cur.from, -1), fyStartMonth);
    }
    default:
      return { from: `${today.slice(0, 7)}-01`, to: today };
  }
}

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n]!;
  return `${TENS[Math.floor(n / 10)]}${n % 10 ? " " + ONES[n % 10] : ""}`;
}
function threeDigits(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  return [h ? `${ONES[h]} Hundred` : "", r ? twoDigits(r) : ""].filter(Boolean).join(" ");
}

/** Integer to words in the Indian system (lakh, crore). */
export function numberToIndianWords(n: number): string {
  if (n === 0) return "Zero";
  if (n < 0) return `Minus ${numberToIndianWords(-n)}`;
  const parts: string[] = [];
  const crore = Math.floor(n / 1e7);
  n %= 1e7;
  const lakh = Math.floor(n / 1e5);
  n %= 1e5;
  const thousand = Math.floor(n / 1e3);
  n %= 1e3;
  if (crore) parts.push(`${numberToIndianWords(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (n) parts.push(threeDigits(n));
  return parts.join(" ");
}

/** "Rupees One Thousand Two Hundred Fifty and Fifty Paise Only" */
export function amountInWords(amount: Numeric): string {
  const v = dec(amount).abs().toDecimalPlaces(2);
  const rupees = v.floor().toNumber();
  const paise = v.sub(v.floor()).mul(100).toDecimalPlaces(0).toNumber();
  let s = `Rupees ${numberToIndianWords(rupees)}`;
  if (paise > 0) s += ` and ${twoDigits(paise)} Paise`;
  return `${s} Only`;
}
