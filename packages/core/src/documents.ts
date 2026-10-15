import type { DocType } from "./schemas";

export const DOC_TYPE_META: Record<DocType, { label: string; plural: string; prefix: string; side: "sales" | "purchase"; affectsStock: -1 | 0 | 1; isTaxDocument: boolean }> = {
  quotation: { label: "Quotation", plural: "Quotations", prefix: "QT", side: "sales", affectsStock: 0, isTaxDocument: false },
  sales_order: { label: "Sales order", plural: "Sales orders", prefix: "SO", side: "sales", affectsStock: 0, isTaxDocument: false },
  delivery_challan: { label: "Delivery challan", plural: "Delivery challans", prefix: "DC", side: "sales", affectsStock: 0, isTaxDocument: false },
  invoice: { label: "Tax invoice", plural: "Invoices", prefix: "INV", side: "sales", affectsStock: -1, isTaxDocument: true },
  credit_note: { label: "Credit note", plural: "Credit notes", prefix: "CN", side: "sales", affectsStock: 1, isTaxDocument: true },
  purchase_order: { label: "Purchase order", plural: "Purchase orders", prefix: "PO", side: "purchase", affectsStock: 0, isTaxDocument: false },
  purchase_bill: { label: "Purchase bill", plural: "Purchase bills", prefix: "PB", side: "purchase", affectsStock: 1, isTaxDocument: true },
  debit_note: { label: "Debit note (purchase return)", plural: "Debit notes", prefix: "DN", side: "purchase", affectsStock: -1, isTaxDocument: true },
};

export const DOC_STATUSES = ["draft", "sent", "accepted", "rejected", "expired", "issued", "partially_paid", "paid", "overdue", "cancelled", "converted", "fulfilled", "partially_received", "received"] as const;
export type DocStatus = (typeof DOC_STATUSES)[number];

export const STATUS_LABEL: Record<DocStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  accepted: "Accepted",
  rejected: "Rejected",
  expired: "Expired",
  issued: "Issued",
  partially_paid: "Partially paid",
  paid: "Paid",
  overdue: "Overdue",
  cancelled: "Cancelled",
  converted: "Converted",
  fulfilled: "Fulfilled",
  partially_received: "Partially received",
  received: "Received",
};

/** Which conversions are allowed: source → targets. */
export const CONVERSIONS: Partial<Record<DocType, DocType[]>> = {
  quotation: ["sales_order", "invoice"],
  sales_order: ["invoice", "delivery_challan"],
  delivery_challan: ["invoice"],
  invoice: ["credit_note"],
  purchase_order: ["purchase_bill"],
  purchase_bill: ["debit_note"],
};

/**
 * Document number such as "INV/26-27/0007". GST rules allow at most 16
 * characters made of letters, digits, "/" and "-", unique within a FY.
 */
export function formatDocumentNumber(prefix: string, fyShort: string, seq: number): string {
  return `${prefix}/${fyShort}/${String(seq).padStart(4, "0")}`;
}

export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  cash: "Cash",
  upi: "UPI",
  bank_transfer: "Bank transfer",
  card: "Card",
  cheque: "Cheque",
  other: "Other",
  credit: "Credit",
};
