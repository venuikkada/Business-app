import type { Permission } from "@cba/core";

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  perm?: Permission;
  match?: string;
}
export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  { label: "", items: [{ href: "/dashboard", label: "Dashboard", icon: "LayoutDashboard", perm: "dashboard.view" }] },
  {
    label: "Sales",
    items: [
      { href: "/documents/invoice", label: "Invoices", icon: "ReceiptIndianRupee", perm: "invoices.view" },
      { href: "/documents/quotation", label: "Quotations", icon: "FileText", perm: "quotations.view" },
      { href: "/documents/sales_order", label: "Sales orders", icon: "ClipboardList", perm: "sales_orders.view" },
      { href: "/documents/delivery_challan", label: "Delivery challans", icon: "Truck", perm: "sales_orders.view" },
      { href: "/documents/credit_note", label: "Credit notes", icon: "Undo2", perm: "invoices.view" },
      { href: "/payments?direction=in", label: "Payments received", icon: "HandCoins", perm: "payments.view", match: "/payments" },
    ],
  },
  {
    label: "Purchases",
    items: [
      { href: "/documents/purchase_bill", label: "Purchase bills", icon: "ShoppingCart", perm: "purchases.view" },
      { href: "/documents/purchase_order", label: "Purchase orders", icon: "PackagePlus", perm: "purchases.view" },
      { href: "/documents/debit_note", label: "Debit notes", icon: "PackageMinus", perm: "purchases.view" },
    ],
  },
  {
    label: "Business",
    items: [
      { href: "/parties", label: "Customers & suppliers", icon: "Users", perm: "parties.view" },
      { href: "/products", label: "Products", icon: "Package", perm: "products.view" },
      { href: "/inventory", label: "Stock", icon: "Warehouse", perm: "inventory.view" },
      { href: "/service", label: "Service tickets", icon: "Wrench", perm: "service.view" },
      { href: "/amc", label: "AMC contracts", icon: "CalendarClock", perm: "service.view" },
    ],
  },
  {
    label: "Money",
    items: [
      { href: "/outstanding", label: "Outstanding dues", icon: "AlarmClock", perm: "payments.view" },
      { href: "/expenses", label: "Expenses", icon: "Wallet", perm: "expenses.view" },
      { href: "/cashbook", label: "Cash & bank", icon: "Landmark", perm: "accounts.view" },
      { href: "/reports", label: "Reports", icon: "ChartColumn", perm: "reports.view" },
    ],
  },
  {
    label: "Admin",
    items: [
      { href: "/approvals", label: "Approvals", icon: "BadgeCheck" },
      { href: "/team", label: "Team & roles", icon: "UserCog", perm: "team.view" },
      { href: "/settings", label: "Settings", icon: "Settings" },
    ],
  },
];

export const QUICK_CREATE: Array<{ href: string; label: string; perm: Permission }> = [
  { href: "/documents/new?type=invoice", label: "Invoice", perm: "invoices.create" },
  { href: "/documents/new?type=quotation", label: "Quotation", perm: "quotations.create" },
  { href: "/payments/new?direction=in", label: "Payment received", perm: "payments.create" },
  { href: "/documents/new?type=purchase_bill", label: "Purchase bill", perm: "purchases.create" },
  { href: "/expenses/new", label: "Expense", perm: "expenses.create" },
  { href: "/parties/new", label: "Customer", perm: "parties.create" },
  { href: "/products/new", label: "Product", perm: "products.create" },
  { href: "/service/new", label: "Service ticket", perm: "service.create" },
];
