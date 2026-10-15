/**
 * Permission keys are "<resource>.<action>". They are stored on roles as a
 * text[] and checked on the server for every API call. Hiding a button in
 * the UI is only a convenience — the server is the source of truth.
 */
export const RESOURCES = {
  dashboard: { label: "Dashboard", actions: ["view"] },
  financials: { label: "Financial figures (profit, cost price, cash)", actions: ["view"] },
  parties: { label: "Customers & suppliers", actions: ["view", "create", "edit", "delete", "export"] },
  products: { label: "Products", actions: ["view", "create", "edit", "delete", "export"] },
  inventory: { label: "Stock movements", actions: ["view", "create", "approve"] },
  quotations: { label: "Quotations", actions: ["view", "create", "edit", "delete"] },
  sales_orders: { label: "Sales orders & challans", actions: ["view", "create", "edit", "delete"] },
  invoices: { label: "Invoices & credit notes", actions: ["view", "create", "edit", "delete", "approve"] },
  purchases: { label: "Purchases", actions: ["view", "create", "edit", "delete"] },
  payments: { label: "Payments", actions: ["view", "create", "delete", "approve"] },
  expenses: { label: "Expenses", actions: ["view", "create", "edit", "delete"] },
  accounts: { label: "Cash & bank accounts", actions: ["view", "create", "edit"] },
  service: { label: "Service tickets & AMC", actions: ["view", "create", "edit", "delete"] },
  reports: { label: "Reports", actions: ["view", "export"] },
  team: { label: "Employees & roles", actions: ["view", "create", "edit", "delete"] },
  settings: { label: "Business settings", actions: ["view", "edit"] },
  billing: { label: "Subscription & billing", actions: ["view", "edit"] },
  audit: { label: "Audit log", actions: ["view"] },
  data: { label: "Import, export & deletion", actions: ["create", "export", "delete"] },
} as const;

export type Resource = keyof typeof RESOURCES;
export type Permission = {
  [R in Resource]: `${R}.${(typeof RESOURCES)[R]["actions"][number]}`;
}[Resource];

export const ALL_PERMISSIONS: Permission[] = (Object.keys(RESOURCES) as Resource[]).flatMap((r) =>
  (RESOURCES[r].actions as readonly string[]).map((a) => `${r}.${a}` as Permission),
);

export function isPermission(p: string): p is Permission {
  return (ALL_PERMISSIONS as string[]).includes(p);
}

const view = (...rs: Resource[]) => rs.map((r) => `${r}.view` as Permission);
const crud = (...rs: Resource[]) =>
  rs.flatMap((r) => (RESOURCES[r].actions as readonly string[]).filter((a) => a !== "approve" && a !== "export").map((a) => `${r}.${a}` as Permission));

export type SystemRole =
  | "owner"
  | "admin"
  | "manager"
  | "accountant"
  | "salesperson"
  | "inventory"
  | "technician";

export const SYSTEM_ROLES: Record<SystemRole, { name: string; description: string; permissions: Permission[] }> = {
  owner: {
    name: "Owner",
    description: "Full control including billing, deletion and approvals.",
    permissions: ALL_PERMISSIONS,
  },
  admin: {
    name: "Administrator",
    description: "Everything except deleting the business and changing the subscription.",
    permissions: ALL_PERMISSIONS.filter((p) => p !== "data.delete" && p !== "billing.edit"),
  },
  manager: {
    name: "Manager",
    description: "Runs daily operations, approves discounts and stock adjustments.",
    permissions: [
      ...view("dashboard", "financials", "audit"),
      ...crud("parties", "products", "quotations", "sales_orders", "invoices", "purchases", "expenses", "service"),
      "inventory.view", "inventory.create", "inventory.approve",
      "invoices.approve", "payments.view", "payments.create", "payments.approve",
      "accounts.view", "reports.view", "reports.export", "parties.export", "products.export",
      "team.view", "settings.view",
    ],
  },
  accountant: {
    name: "Accountant",
    description: "Invoices, payments, expenses, accounts and all reports.",
    permissions: [
      ...view("dashboard", "financials", "parties", "products", "inventory", "quotations", "sales_orders", "service", "audit", "settings"),
      ...crud("invoices", "purchases", "expenses"),
      "payments.view", "payments.create", "payments.delete",
      "accounts.view", "accounts.create", "accounts.edit",
      "reports.view", "reports.export", "parties.export", "data.export",
    ],
  },
  salesperson: {
    name: "Salesperson",
    description: "Customers, quotations, orders and invoices. No cost prices or profit.",
    permissions: [
      "dashboard.view",
      "parties.view", "parties.create", "parties.edit",
      "products.view", "inventory.view",
      "quotations.view", "quotations.create", "quotations.edit",
      "sales_orders.view", "sales_orders.create", "sales_orders.edit",
      "invoices.view", "invoices.create", "invoices.edit",
      "payments.view", "payments.create",
    ],
  },
  inventory: {
    name: "Inventory operator",
    description: "Products, stock inward/outward, transfers and goods receipt.",
    permissions: [
      "dashboard.view",
      "products.view", "products.create", "products.edit", "products.export",
      "inventory.view", "inventory.create",
      "purchases.view", "parties.view", "sales_orders.view",
    ],
  },
  technician: {
    name: "Technician",
    description: "Assigned service tickets, visits and spare parts.",
    permissions: ["service.view", "service.edit", "parties.view", "products.view"],
  },
};

export const SYSTEM_ROLE_KEYS = Object.keys(SYSTEM_ROLES) as SystemRole[];
