/**
 * Feature flags and usage limits that subscription plans can grant.
 * The authoritative values live in the `plans` table and are editable by the
 * platform owner from the super-admin panel; these are only seed defaults.
 */
export const FEATURES = {
  pdf: "PDF invoices & quotations",
  inventory: "Stock tracking, adjustments & valuation",
  expenses: "Expenses & cashbook",
  reminders: "Payment & follow-up reminders",
  purchases: "Purchases, goods receipt & supplier payments",
  service: "Service tickets & AMC contracts",
  employees: "Employee logins & roles",
  advanced_reports: "Advanced reports (profitability, aging, GST summary)",
  multi_branch: "Multiple branches & stock transfers",
  custom_roles: "Custom roles & permissions",
  data_export: "Full business data export",
  priority_support: "Priority support",
} as const;
export type Feature = keyof typeof FEATURES;

export const LIMITS = {
  invoices_per_month: "Invoices per month",
  quotations_per_month: "Quotations per month",
  products: "Products",
  parties: "Customers & suppliers",
  users: "Users (including owner)",
  branches: "Branches",
} as const;
export type LimitKey = keyof typeof LIMITS;

/** `null` means unlimited. */
export type PlanLimits = Record<LimitKey, number | null>;
export type PlanFeatures = Record<Feature, boolean>;

export interface PlanSeed {
  code: string;
  name: string;
  description: string;
  /** Amounts in paise. */
  priceMonthly: number;
  priceYearly: number;
  trialDays: number;
  limits: PlanLimits;
  features: PlanFeatures;
  sortOrder: number;
}

const none: PlanFeatures = {
  pdf: false, inventory: false, expenses: false, reminders: false, purchases: false, service: false,
  employees: false, advanced_reports: false, multi_branch: false, custom_roles: false, data_export: true, priority_support: false,
};

/**
 * Prices are hypotheses to be tested with real customers — not validated
 * market prices. Change them in the super-admin panel.
 */
export const DEFAULT_PLANS: PlanSeed[] = [
  {
    code: "free",
    name: "Free",
    description: "For trying out billing in a single shop.",
    priceMonthly: 0,
    priceYearly: 0,
    trialDays: 0,
    sortOrder: 0,
    limits: { invoices_per_month: 30, quotations_per_month: 30, products: 100, parties: 200, users: 1, branches: 1 },
    features: { ...none, pdf: true },
  },
  {
    code: "starter",
    name: "Starter",
    description: "Inventory, expenses, PDFs and reminders for a growing shop.",
    priceMonthly: 29900,
    priceYearly: 299000,
    trialDays: 14,
    sortOrder: 1,
    limits: { invoices_per_month: 500, quotations_per_month: 500, products: 2000, parties: 5000, users: 1, branches: 1 },
    features: { ...none, pdf: true, inventory: true, expenses: true, reminders: true },
  },
  {
    code: "pro",
    name: "Pro",
    description: "Purchases, service management, staff logins and advanced reports.",
    priceMonthly: 69900,
    priceYearly: 699000,
    trialDays: 14,
    sortOrder: 2,
    limits: { invoices_per_month: 3000, quotations_per_month: 3000, products: 20000, parties: 50000, users: 5, branches: 1 },
    features: { ...none, pdf: true, inventory: true, expenses: true, reminders: true, purchases: true, service: true, employees: true, advanced_reports: true },
  },
  {
    code: "business",
    name: "Business",
    description: "Multiple branches and users, custom permissions, priority support.",
    priceMonthly: 149900,
    priceYearly: 1499000,
    trialDays: 14,
    sortOrder: 3,
    limits: { invoices_per_month: null, quotations_per_month: null, products: null, parties: null, users: 25, branches: 10 },
    features: {
      pdf: true, inventory: true, expenses: true, reminders: true, purchases: true, service: true, employees: true,
      advanced_reports: true, multi_branch: true, custom_roles: true, data_export: true, priority_support: true,
    },
  },
];

/** The plan new businesses start a trial on. */
export const TRIAL_PLAN_CODE = "pro";
