import { z } from "zod";
import { GST_RATES } from "./gst";
import { validateGSTIN, normalizeIndianPhone, validatePAN, validatePincode, INDIAN_STATES } from "./india";
import { ALL_PERMISSIONS } from "./permissions";

const trimmed = (max: number) => z.string().trim().max(max);
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
export const uuid = z.string().uuid();

/** Money: up to 12 integer digits and 2 decimals, given as string or number. */
export const moneyInput = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .refine((v) => /^-?\d{1,12}(\.\d{1,2})?$/.test(v), "Enter a valid amount (max 2 decimals)");
export const positiveMoney = moneyInput.refine((v) => Number(v) > 0, "Amount must be greater than 0");
export const nonNegativeMoney = moneyInput.refine((v) => Number(v) >= 0, "Amount cannot be negative");
export const quantityInput = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .refine((v) => /^-?\d{1,10}(\.\d{1,3})?$/.test(v), "Enter a valid quantity (max 3 decimals)");
export const taxRateInput = z
  .union([z.string(), z.number()])
  .transform((v) => Number(v))
  .refine((v) => (GST_RATES as readonly number[]).includes(v), "Unsupported GST rate");

export const stateCode = z
  .string()
  .refine((c) => INDIAN_STATES.some((s) => s.code === c), "Select a valid state");

export const gstinInput = optText(15)
  .transform((v) => (v ? v.toUpperCase() : null))
  .refine((v) => v === null || validateGSTIN(v).valid, (v) => ({ message: v ? validateGSTIN(v).reason ?? "Invalid GSTIN" : "Invalid GSTIN" }));
export const panInput = optText(10)
  .transform((v) => (v ? v.toUpperCase() : null))
  .refine((v) => v === null || validatePAN(v), "PAN must look like ABCDE1234F");
export const phoneInput = optText(20)
  .refine((v) => v === null || normalizeIndianPhone(v) !== null, "Enter a valid 10-digit Indian mobile number")
  .transform((v) => (v ? normalizeIndianPhone(v) : null));
export const pincodeInput = optText(6).refine((v) => v === null || validatePincode(v), "PIN code must be 6 digits");
export const emailInput = optText(254)
  .transform((v) => (v ? v.toLowerCase() : null))
  .refine((v) => v === null || z.string().email().safeParse(v).success, "Enter a valid email");

export const passwordInput = z
  .string()
  .min(10, "Use at least 10 characters")
  .max(128)
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), "Use letters and numbers");

// ---------- Auth ----------
export const registerSchema = z.object({
  fullName: trimmed(120).min(2, "Enter your name"),
  email: z.string().trim().toLowerCase().email("Enter a valid email").max(254),
  phone: phoneInput,
  password: passwordInput,
  acceptTerms: z.literal(true, { errorMap: () => ({ message: "Please accept the terms" }) }),
});
export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(128),
  totp: z.string().regex(/^\d{6}$/).optional(),
});
export const forgotPasswordSchema = z.object({ email: z.string().trim().toLowerCase().email().max(254) });
export const resetPasswordSchema = z.object({ token: z.string().min(20).max(200), password: passwordInput });
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(128), newPassword: passwordInput });

// ---------- Address ----------
export const addressSchema = z.object({
  line1: optText(200),
  line2: optText(200),
  city: optText(80),
  stateCode: stateCode.optional().nullable().transform((v) => v ?? null),
  pincode: pincodeInput,
});

// ---------- Business ----------
export const businessSchema = z.object({
  name: trimmed(120).min(2, "Enter the business name"),
  legalName: optText(160),
  businessType: z.enum(["retail", "wholesale", "distributor", "it_dealer", "cctv", "computer_shop", "electronics", "services", "freelancer", "other"]).default("retail"),
  gstin: gstinInput,
  pan: panInput,
  phone: phoneInput,
  email: emailInput,
  address: addressSchema,
  stateCode: stateCode,
});
export type BusinessInput = z.infer<typeof businessSchema>;

export const businessSettingsSchema = z.object({
  invoiceTerms: optText(2000),
  quotationTerms: optText(2000),
  bankName: optText(120),
  bankAccountName: optText(120),
  bankAccountNumber: optText(34).refine((v) => v === null || /^[0-9A-Za-z]{6,34}$/.test(v), "Invalid account number"),
  bankIfsc: optText(11)
    .transform((v) => (v ? v.toUpperCase() : null))
    .refine((v) => v === null || /^[A-Z]{4}0[A-Z0-9]{6}$/.test(v), "IFSC must look like HDFC0001234"),
  upiId: optText(80).refine((v) => v === null || /^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(v), "UPI ID must look like name@bank"),
  /** regular = charges GST; composition/unregistered = issues Bill of Supply without tax. */
  gstScheme: z.enum(["regular", "composition", "unregistered"]).default("regular"),
  numberPrefixes: z.record(z.string(), z.string().regex(/^[A-Z0-9]{1,5}$/, "Prefix: up to 5 capital letters/digits")).default({}),
  pricesIncludeTax: z.boolean().default(false),
  roundOffTotals: z.boolean().default(true),
  allowNegativeStock: z.boolean().default(false),
  defaultPaymentTermsDays: z.coerce.number().int().min(0).max(365).default(15),
  quotationValidityDays: z.coerce.number().int().min(1).max(365).default(15),
  discountApprovalPercent: z.coerce.number().min(0).max(100).nullable().default(null),
  refundApprovalAmount: nonNegativeMoney.nullable().default(null),
  stockAdjustmentApprovalQty: z.coerce.number().min(0).nullable().default(null),
  showBrandingFooter: z.boolean().default(true),
});
export type BusinessSettingsInput = z.infer<typeof businessSettingsSchema>;

// ---------- Parties ----------
export const partySchema = z.object({
  name: trimmed(160).min(1, "Enter a name"),
  isCustomer: z.boolean().default(true),
  isSupplier: z.boolean().default(false),
  contactPerson: optText(120),
  phone: phoneInput,
  altPhone: phoneInput,
  email: emailInput,
  gstin: gstinInput,
  pan: panInput,
  billingAddress: addressSchema,
  shippingAddress: addressSchema.optional().nullable(),
  openingBalance: moneyInput.default("0"),
  creditLimit: nonNegativeMoney.optional().nullable(),
  paymentTermsDays: z.coerce.number().int().min(0).max(365).optional().nullable(),
  notes: optText(2000),
  tags: z.array(trimmed(40)).max(20).default([]),
  whatsappOptIn: z.boolean().default(false),
}).refine((p) => p.isCustomer || p.isSupplier, { message: "Choose customer, supplier or both", path: ["isCustomer"] });
export type PartyInput = z.infer<typeof partySchema>;

export const interactionSchema = z.object({
  kind: z.enum(["call", "visit", "whatsapp", "email", "meeting", "note"]),
  notes: trimmed(2000).min(1),
  followUpOn: isoDate.optional().nullable(),
});

// ---------- Products ----------
export const productSchema = z.object({
  name: trimmed(200).min(1, "Enter a product name"),
  type: z.enum(["goods", "service"]).default("goods"),
  sku: optText(64),
  barcode: optText(64),
  categoryId: uuid.optional().nullable(),
  brand: optText(80),
  unit: trimmed(16).default("pcs"),
  hsnCode: optText(8).refine((v) => v === null || /^\d{4,8}$/.test(v), "HSN/SAC must be 4–8 digits"),
  description: optText(1000),
  costPrice: nonNegativeMoney.default("0"),
  sellingPrice: nonNegativeMoney.default("0"),
  mrp: nonNegativeMoney.optional().nullable(),
  taxRate: taxRateInput.default(18),
  pricesIncludeTax: z.boolean().default(false),
  trackInventory: z.boolean().default(true),
  trackSerials: z.boolean().default(false),
  reorderLevel: quantityInput.default("0"),
  warrantyMonths: z.coerce.number().int().min(0).max(120).optional().nullable(),
  parentProductId: uuid.optional().nullable(),
  variantAttributes: z.record(trimmed(40), trimmed(80)).optional().nullable(),
  openingStock: quantityInput.optional().nullable(),
  openingStockBranchId: uuid.optional().nullable(),
});
export type ProductInput = z.infer<typeof productSchema>;

export const categorySchema = z.object({ name: trimmed(80).min(1), parentId: uuid.optional().nullable() });

export const stockAdjustmentSchema = z.object({
  productId: uuid,
  branchId: uuid.optional().nullable(),
  quantityDelta: quantityInput.refine((v) => Number(v) !== 0, "Quantity cannot be zero"),
  unitCost: nonNegativeMoney.optional().nullable(),
  reason: z.enum(["count_correction", "damage", "theft", "expired", "internal_use", "opening", "other"]),
  note: optText(500),
  serialNumbers: z.array(trimmed(64).min(1)).max(1000).optional(),
  approvalId: uuid.optional().nullable(),
});
export const stockTransferSchema = z.object({
  productId: uuid,
  fromBranchId: uuid,
  toBranchId: uuid,
  quantity: quantityInput.refine((v) => Number(v) > 0, "Quantity must be greater than 0"),
  note: optText(500),
}).refine((t) => t.fromBranchId !== t.toBranchId, { message: "Choose two different branches", path: ["toBranchId"] });

// ---------- Documents ----------
export const SALES_DOC_TYPES = ["quotation", "sales_order", "delivery_challan", "invoice", "credit_note"] as const;
export const PURCHASE_DOC_TYPES = ["purchase_order", "purchase_bill", "debit_note"] as const;
export const DOC_TYPES = [...SALES_DOC_TYPES, ...PURCHASE_DOC_TYPES] as const;
export type DocType = (typeof DOC_TYPES)[number];

export const documentItemSchema = z.object({
  productId: uuid.optional().nullable(),
  description: trimmed(300).min(1, "Enter an item description"),
  hsnCode: optText(8),
  quantity: quantityInput.refine((v) => Number(v) > 0, "Quantity must be greater than 0"),
  unit: trimmed(16).default("pcs"),
  unitPrice: nonNegativeMoney,
  discountType: z.enum(["percent", "amount"]).optional().nullable(),
  discountValue: nonNegativeMoney.optional().nullable(),
  taxRate: taxRateInput,
  serialNumbers: z.array(trimmed(64).min(1)).max(500).optional().default([]),
  sourceItemId: uuid.optional().nullable(),
});
export type DocumentItemInput = z.infer<typeof documentItemSchema>;

export const documentSchema = z.object({
  docType: z.enum(DOC_TYPES),
  partyId: uuid,
  branchId: uuid.optional().nullable(),
  issueDate: isoDate,
  dueDate: isoDate.optional().nullable(),
  validUntil: isoDate.optional().nullable(),
  placeOfSupply: stateCode.optional().nullable(),
  pricesIncludeTax: z.boolean().default(false),
  reverseCharge: z.boolean().default(false),
  documentDiscountType: z.enum(["percent", "amount"]).optional().nullable(),
  documentDiscountValue: nonNegativeMoney.optional().nullable(),
  additionalCharges: nonNegativeMoney.optional().nullable(),
  additionalChargesLabel: optText(60),
  additionalChargesTaxRate: taxRateInput.optional().default(0),
  roundOff: z.boolean().default(true),
  supplierInvoiceNumber: optText(40),
  referenceNumber: optText(60),
  notes: optText(2000),
  terms: optText(4000),
  items: z.array(documentItemSchema).min(1, "Add at least one item").max(300),
  sourceDocumentId: uuid.optional().nullable(),
});
export type DocumentInput = z.infer<typeof documentSchema>;

export const cancelDocumentSchema = z.object({ reason: trimmed(300).min(3, "Enter a reason") });

// ---------- Payments ----------
export const PAYMENT_METHODS = ["cash", "upi", "bank_transfer", "card", "cheque", "other"] as const;
export const paymentSchema = z.object({
  direction: z.enum(["in", "out"]),
  partyId: uuid,
  amount: positiveMoney,
  method: z.enum(PAYMENT_METHODS),
  accountId: uuid.optional().nullable(),
  paidOn: isoDate,
  reference: optText(80),
  notes: optText(500),
  allocations: z
    .array(z.object({ documentId: uuid, amount: positiveMoney }))
    .max(100)
    .default([]),
  approvalId: uuid.optional().nullable(),
});
export type PaymentInput = z.infer<typeof paymentSchema>;

// ---------- Expenses & accounts ----------
export const expenseSchema = z.object({
  categoryId: uuid,
  amount: positiveMoney,
  taxAmount: nonNegativeMoney.optional().default("0"),
  expenseDate: isoDate,
  method: z.enum(PAYMENT_METHODS),
  accountId: uuid.optional().nullable(),
  partyId: uuid.optional().nullable(),
  reference: optText(80),
  notes: optText(1000),
  attachmentId: uuid.optional().nullable(),
});
export const expenseCategorySchema = z.object({ name: trimmed(80).min(1) });

export const accountSchema = z.object({
  name: trimmed(80).min(1),
  type: z.enum(["cash", "bank", "upi", "card", "other"]),
  openingBalance: moneyInput.default("0"),
  accountNumberLast4: optText(4).refine((v) => v === null || /^\d{4}$/.test(v), "Last 4 digits only"),
});
export const accountTransferSchema = z.object({
  fromAccountId: uuid,
  toAccountId: uuid,
  amount: positiveMoney,
  txnDate: isoDate,
  notes: optText(300),
}).refine((t) => t.fromAccountId !== t.toAccountId, { message: "Choose two different accounts", path: ["toAccountId"] });
export const accountEntrySchema = z.object({
  accountId: uuid,
  direction: z.enum(["in", "out"]),
  amount: positiveMoney,
  txnDate: isoDate,
  category: trimmed(60).min(1),
  notes: optText(300),
});

// ---------- Service ----------
export const serviceTicketSchema = z.object({
  partyId: uuid,
  productId: uuid.optional().nullable(),
  equipment: optText(200),
  serialNumber: optText(64),
  issue: trimmed(2000).min(3, "Describe the issue"),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  assignedTo: uuid.optional().nullable(),
  scheduledAt: z.string().datetime({ offset: true }).optional().nullable(),
  serviceCharge: nonNegativeMoney.optional().default("0"),
  amcContractId: uuid.optional().nullable(),
  underWarranty: z.boolean().default(false),
});
export const serviceTicketUpdateSchema = z.object({
  status: z.enum(["open", "assigned", "in_progress", "on_hold", "completed", "cancelled"]).optional(),
  assignedTo: uuid.optional().nullable(),
  scheduledAt: z.string().datetime({ offset: true }).optional().nullable(),
  resolution: optText(2000),
  serviceCharge: nonNegativeMoney.optional(),
  note: optText(2000),
});
export const servicePartSchema = z.object({ productId: uuid, quantity: quantityInput.refine((v) => Number(v) > 0), unitPrice: nonNegativeMoney });
export const amcSchema = z.object({
  partyId: uuid,
  title: trimmed(160).min(2),
  startDate: isoDate,
  endDate: isoDate,
  amount: nonNegativeMoney,
  visitsIncluded: z.coerce.number().int().min(0).max(365).default(4),
  coveredItems: optText(2000),
  reminderDaysBefore: z.coerce.number().int().min(1).max(180).default(30),
  notes: optText(2000),
}).refine((a) => a.endDate > a.startDate, { message: "End date must be after start date", path: ["endDate"] });

// ---------- Team ----------
export const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  roleId: uuid,
  branchIds: z.array(uuid).max(50).optional().nullable(),
});
export const roleSchema = z.object({
  name: trimmed(60).min(2),
  description: optText(200),
  permissions: z.array(z.enum(ALL_PERMISSIONS as [string, ...string[]])).max(200),
});
export const branchSchema = z.object({
  name: trimmed(80).min(1),
  code: trimmed(10).regex(/^[A-Z0-9]{1,10}$/, "Use up to 10 capital letters/digits").optional().nullable(),
  gstin: gstinInput,
  phone: phoneInput,
  address: addressSchema,
  stateCode: stateCode,
});

// ---------- Pagination ----------
export const listQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  sort: z.string().max(40).optional(),
  dir: z.enum(["asc", "desc"]).default("desc"),
  status: z.string().max(40).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  archived: z.enum(["true", "false"]).optional(),
});
