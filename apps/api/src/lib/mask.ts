/** +919876543210 -> +91******3210 (for logs and security events) */
export function maskMobile(m: string | null | undefined): string {
  if (!m) return "";
  return m.length > 7 ? m.slice(0, 3) + "*".repeat(m.length - 7) + m.slice(-4) : "****";
}

export function maskEmail(e: string | null | undefined): string {
  if (!e) return "";
  const [u, d] = e.split("@");
  if (!u || !d) return "****";
  return `${u[0]}***@${d}`;
}
