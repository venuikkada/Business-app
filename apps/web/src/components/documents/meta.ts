import { DOC_TYPES, DOC_TYPE_META, type DocType } from "@cba/core";

export function asDocType(v: string): DocType | null {
  return (DOC_TYPES as readonly string[]).includes(v) ? (v as DocType) : null;
}

export const STATUS_TABS: Record<DocType, Array<[string, string]>> = {
  invoice: [["", "All"], ["draft", "Drafts"], ["unpaid", "Unpaid"], ["overdue", "Overdue"], ["paid", "Paid"], ["cancelled", "Cancelled"]],
  quotation: [["", "All"], ["draft", "Drafts"], ["sent", "Sent"], ["accepted", "Accepted"], ["converted", "Converted"], ["expired", "Expired"], ["rejected", "Rejected"]],
  sales_order: [["", "All"], ["draft", "Drafts"], ["issued", "Open"], ["fulfilled", "Fulfilled"], ["cancelled", "Cancelled"]],
  delivery_challan: [["", "All"], ["draft", "Drafts"], ["issued", "Issued"], ["converted", "Invoiced"], ["cancelled", "Cancelled"]],
  credit_note: [["", "All"], ["draft", "Drafts"], ["issued", "Issued"], ["cancelled", "Cancelled"]],
  purchase_order: [["", "All"], ["draft", "Drafts"], ["issued", "Open"], ["partially_received", "Partly received"], ["received", "Received"], ["cancelled", "Cancelled"]],
  purchase_bill: [["", "All"], ["draft", "Drafts"], ["unpaid", "Unpaid"], ["overdue", "Overdue"], ["paid", "Paid"], ["cancelled", "Cancelled"]],
  debit_note: [["", "All"], ["draft", "Drafts"], ["issued", "Issued"], ["cancelled", "Cancelled"]],
};

export const EMPTY_TEXT: Record<DocType, string> = {
  invoice: "Create a GST-ready invoice in under a minute and share it on WhatsApp.",
  quotation: "Send professional quotations and convert accepted ones into invoices without retyping.",
  sales_order: "Track confirmed orders until they are delivered and invoiced.",
  delivery_challan: "Send goods with a challan and invoice them later.",
  credit_note: "Issue credit notes for returns. Stock and the customer's balance update automatically.",
  purchase_order: "Order from suppliers and track what has arrived.",
  purchase_bill: "Record supplier bills. Stock is added when the bill is saved.",
  debit_note: "Return goods to a supplier.",
};

export function partyWord(t: DocType) {
  return DOC_TYPE_META[t].side === "sales" ? "Customer" : "Supplier";
}
