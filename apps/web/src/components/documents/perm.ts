import type { DocType, Permission } from "@cba/core";

const GROUP: Record<DocType, string> = {
  quotation: "quotations", sales_order: "sales_orders", delivery_challan: "sales_orders", invoice: "invoices", credit_note: "invoices",
  purchase_order: "purchases", purchase_bill: "purchases", debit_note: "purchases",
};
export const docPermFor = (t: DocType, a: "view" | "create" | "edit" | "delete") => `${GROUP[t]}.${a}` as Permission;
