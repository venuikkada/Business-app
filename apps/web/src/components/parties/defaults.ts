import type { PartyFormValue } from "./party-form";

const blankAddr = (st = "") => ({ line1: "", line2: "", city: "", stateCode: st, pincode: "" });
export const blankParty = (kind: "customer" | "supplier", st: string): PartyFormValue => ({
  name: "", isCustomer: kind === "customer", isSupplier: kind === "supplier", contactPerson: "", phone: "", altPhone: "", email: "", gstin: "", pan: "",
  billingAddress: blankAddr(st), shipSame: true, shippingAddress: blankAddr(st), openingBalance: "", openingSide: kind === "supplier" ? "payable" : "receivable",
  creditLimit: "", paymentTermsDays: "", notes: "", tags: "", whatsappOptIn: false,
});
