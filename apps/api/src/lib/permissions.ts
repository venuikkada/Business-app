/**
 * Permission catalogue. Keys are "<module>.<action>". The server checks them on
 * every API call; the app only uses them to hide buttons.
 *
 * Sector modules (restaurant, hotel ...) add their own groups in later steps; a
 * group with `sector` set is only offered when that module is switched on.
 */
export interface PermissionGroup {
  key: string;
  label: string;
  sector?: string;
  actions: Record<string, string>;
}

export const PERMISSION_GROUPS: PermissionGroup[] = [
  { key: "dashboard", label: "Dashboard", actions: { view: "See dashboard" } },
  { key: "financials", label: "Money figures", actions: { view: "See cost price, profit and cash totals" } },
  { key: "items", label: "Items", actions: { view: "View", create: "Add", edit: "Edit", delete: "Delete", export: "Export" } },
  { key: "stock", label: "Stock", actions: { view: "View stock", adjust: "Stock in/out & adjust", transfer: "Branch transfers", approve: "Approve adjustments" } },
  { key: "parties", label: "Customers & suppliers", actions: { view: "View", create: "Add", edit: "Edit", delete: "Delete", export: "Export" } },
  { key: "sales", label: "Sales (quotes, orders, invoices)", actions: { view: "View", create: "Create", edit: "Edit drafts", cancel: "Cancel / credit note", discount: "Give extra discount" } },
  { key: "purchases", label: "Purchases", actions: { view: "View", create: "Create", edit: "Edit drafts", cancel: "Cancel" } },
  { key: "payments", label: "Payments", actions: { view: "View", create: "Record", void: "Void" } },
  { key: "expenses", label: "Expenses", actions: { view: "View all", create: "Add / claim", edit: "Edit", delete: "Delete", approve: "Approve staff claims" } },
  { key: "accounts", label: "Cash, bank & UPI", actions: { view: "View day book", manage: "Add / edit accounts" } },
  { key: "employees", label: "Employees", actions: { view: "View", create: "Add", edit: "Edit", delete: "Remove" } },
  { key: "attendance", label: "Attendance & leave", actions: { view: "View", mark: "Mark attendance", approve: "Approve leave" } },
  { key: "payroll", label: "Payroll", actions: { view: "View salaries & payslips", run: "Run payroll" } },
  { key: "reports", label: "Reports", actions: { view: "View", export: "Export Excel / PDF" } },
  { key: "team", label: "Team (app users)", actions: { view: "View", invite: "Invite", edit: "Change role / branches", remove: "Remove" } },
  { key: "roles", label: "Roles", actions: { view: "View", manage: "Create / edit custom roles" } },
  { key: "settings", label: "Business settings", actions: { view: "View", edit: "Edit business, branches, numbering" } },
  { key: "audit", label: "Audit log", actions: { view: "View", export: "Export" } },
  { key: "data", label: "Data", actions: { import: "Bulk import", export: "Full export / backup" } },
  { key: "billing", label: "Subscription", actions: { view: "View plan", manage: "Change plan" } },
];

export const ALL_PERMISSIONS: string[] = PERMISSION_GROUPS.flatMap((g) => Object.keys(g.actions).map((a) => `${g.key}.${a}`));
const KNOWN = new Set(ALL_PERMISSIONS);
export const isPermission = (p: string) => KNOWN.has(p);

/** Only an owner can hold these; they can never be put in a custom role. */
export const OWNER_ONLY = new Set(["billing.manage"]);

export type SystemRoleKey = "owner" | "admin" | "manager" | "cashier" | "accountant";

const all = (g: string) => ALL_PERMISSIONS.filter((p) => p.startsWith(`${g}.`));
const pick = (...ps: string[]) => ps;

export const SYSTEM_ROLES: Record<SystemRoleKey, { name: string; description: string; permissions: () => string[] }> = {
  owner: {
    name: "Owner",
    description: "Full control of the business, including subscription.",
    permissions: () => [...ALL_PERMISSIONS],
  },
  admin: {
    name: "Admin",
    description: "Everything except changing the subscription.",
    permissions: () => ALL_PERMISSIONS.filter((p) => !OWNER_ONLY.has(p)),
  },
  manager: {
    name: "Manager",
    description: "Runs the shop day to day: sales, stock, purchases, staff attendance, approvals.",
    permissions: () => [
      ...all("dashboard"), ...all("financials"), ...all("items"), ...all("stock"), ...all("parties"),
      ...all("sales"), ...all("purchases"), ...pick("payments.view", "payments.create"),
      ...all("expenses"), "accounts.view", "employees.view", ...all("attendance"),
      ...all("reports"), "team.view", "roles.view", "settings.view", "audit.view",
    ],
  },
  cashier: {
    name: "Cashier / Staff",
    description: "Billing at the counter, customers, payments and own expense claims. No cost or profit.",
    permissions: () => pick(
      "dashboard.view", "items.view", "stock.view", "parties.view", "parties.create",
      "sales.view", "sales.create", "payments.view", "payments.create", "expenses.create",
    ),
  },
  accountant: {
    name: "Accountant",
    description: "Invoices, purchases, payments, expenses, payroll and all reports.",
    permissions: () => [
      "dashboard.view", ...all("financials"), "items.view", "stock.view", ...all("parties"),
      ...pick("sales.view", "sales.create", "sales.edit", "sales.cancel"), ...all("purchases"),
      ...all("payments"), ...all("expenses"), ...all("accounts"), "employees.view", "attendance.view",
      ...all("payroll"), ...all("reports"), "settings.view", "audit.view", "data.export",
    ],
  },
};

export const SYSTEM_ROLE_KEYS = Object.keys(SYSTEM_ROLES) as SystemRoleKey[];
export const isSystemRoleKey = (k: string): k is SystemRoleKey => k in SYSTEM_ROLES;

/** System roles always use the current code definition, so new modules reach them automatically. */
export function effectivePermissions(roleKey: string, stored: string[]): string[] {
  if (isSystemRoleKey(roleKey)) return SYSTEM_ROLES[roleKey].permissions();
  return stored.filter(isPermission);
}
