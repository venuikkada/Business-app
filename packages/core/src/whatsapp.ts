import { formatINR } from "./money";
import { formatDateIN } from "./india";

/**
 * Builds a wa.me deep link with a prefilled message. This opens WhatsApp on
 * the user's own device; nothing is sent automatically, so the business
 * owner stays in control and only messages customers they deal with.
 */
export function whatsappLink(phoneE164: string | null | undefined, message: string): string {
  const digits = (phoneE164 ?? "").replace(/\D/g, "");
  const text = encodeURIComponent(message);
  return digits ? `https://wa.me/${digits}?text=${text}` : `https://wa.me/?text=${text}`;
}

export function invoiceShareMessage(p: { businessName: string; customerName: string; docLabel: string; number: string; total: string; dueDate?: string | null; link?: string | null }): string {
  const lines = [
    `Dear ${p.customerName},`,
    ``,
    `Thank you for your business. Please find your ${p.docLabel.toLowerCase()} ${p.number} for ${formatINR(p.total)}.`,
  ];
  if (p.dueDate) lines.push(`Due date: ${formatDateIN(p.dueDate)}.`);
  if (p.link) lines.push(``, `View / download: ${p.link}`);
  lines.push(``, `Regards,`, p.businessName);
  return lines.join("\n");
}

export function paymentReminderMessage(p: { businessName: string; customerName: string; outstanding: string; oldestInvoice?: string | null; daysOverdue?: number | null; upiId?: string | null }): string {
  const lines = [`Dear ${p.customerName},`, ``, `This is a friendly reminder that ${formatINR(p.outstanding)} is pending with ${p.businessName}.`];
  if (p.oldestInvoice) lines.push(`Oldest unpaid invoice: ${p.oldestInvoice}${p.daysOverdue && p.daysOverdue > 0 ? ` (${p.daysOverdue} days overdue)` : ""}.`);
  if (p.upiId) lines.push(`You can pay by UPI to ${p.upiId}.`);
  lines.push(``, `Please ignore if already paid. Thank you!`, p.businessName);
  return lines.join("\n");
}

export function receiptMessage(p: { businessName: string; customerName: string; amount: string; number: string; date: string }): string {
  return [`Dear ${p.customerName},`, ``, `We have received ${formatINR(p.amount)} on ${formatDateIN(p.date)} (receipt ${p.number}). Thank you!`, ``, p.businessName].join("\n");
}

/** UPI deep link for "pay now" QR codes on invoices. */
export function upiPaymentUri(p: { upiId: string; payeeName: string; amount: string; note: string }): string {
  const q = new URLSearchParams({ pa: p.upiId, pn: p.payeeName, am: p.amount, cu: "INR", tn: p.note.slice(0, 50) });
  return `upi://pay?${q.toString()}`;
}
