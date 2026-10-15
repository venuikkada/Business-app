export { formatINR, formatINRCompact, formatDateIN, formatDateLong, formatDateTimeIN, formatIndianPhone, stateName, STATUS_LABEL, DOC_TYPE_META, PAYMENT_METHOD_LABEL } from "@cba/core";

export function qs(params: Record<string, string | number | undefined | null>) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : "";
}
