export type ErrorCode =
  | "VALIDATION"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "BUSINESS_RULE"
  | "NEGATIVE_STOCK"
  | "APPROVAL_REQUIRED"
  | "PLAN_LIMIT"
  | "FEATURE_NOT_IN_PLAN"
  | "RATE_LIMITED"
  | "POSSIBLE_DUPLICATE"
  | "MFA_REQUIRED"
  | "NOT_CONFIGURED"
  | "INTERNAL";

const STATUS: Record<ErrorCode, number> = {
  VALIDATION: 422,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  BUSINESS_RULE: 422,
  NEGATIVE_STOCK: 409,
  APPROVAL_REQUIRED: 409,
  PLAN_LIMIT: 402,
  FEATURE_NOT_IN_PLAN: 402,
  RATE_LIMITED: 429,
  POSSIBLE_DUPLICATE: 409,
  MFA_REQUIRED: 401,
  NOT_CONFIGURED: 503,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
    this.status = STATUS[code];
  }
}

export const notFound = (what = "Record") => new AppError("NOT_FOUND", `${what} not found`);
export const forbidden = (msg = "You do not have permission to do this") => new AppError("FORBIDDEN", msg);
export const rule = (msg: string, details?: Record<string, unknown>) => new AppError("BUSINESS_RULE", msg, details);

interface PgError {
  code?: string;
  message: string;
  hint?: string;
  constraint?: string;
  detail?: string;
}

const CONSTRAINT_MESSAGES: Record<string, string> = {
  products_sku_uniq: "Another product already uses this SKU",
  products_barcode_uniq: "Another product already uses this barcode",
  categories_name_uniq: "A category with this name already exists",
  branches_name_uniq: "A branch with this name already exists",
  roles_name_uniq: "A role with this name already exists",
  accounts_name_uniq: "An account with this name already exists",
  expense_categories_name: "This expense category already exists",
  users_email_key: "An account with this email already exists",
  invitations_pending_uniq: "An invitation is already pending for this email",
  memberships_business_id_user_id_key: "This person is already a member",
  product_serials_business_id_product_id_serial_number_key: "This serial number already exists for the product",
  stock_movements_once: "Stock for this document line was already updated",
  documents_amount_settled_check: "Amount exceeds the outstanding balance",
};

/** Converts PostgreSQL errors raised by constraints/triggers into AppErrors. */
export function fromPgError(e: unknown): unknown {
  const pg = e as PgError;
  if (!pg || typeof pg !== "object" || typeof pg.code !== "string") return e;
  switch (pg.code) {
    case "P0002":
      return new AppError("NEGATIVE_STOCK", pg.message);
    case "P0001":
      return new AppError("BUSINESS_RULE", pg.message);
    case "23505":
      return new AppError("CONFLICT", CONSTRAINT_MESSAGES[pg.constraint ?? ""] ?? "This record already exists", { constraint: pg.constraint });
    case "23514": {
      const c = pg.constraint ?? "";
      if (c.includes("amount_settled") || c === "documents_check2") return new AppError("BUSINESS_RULE", "Amount exceeds the outstanding balance", { constraint: c });
      return new AppError("VALIDATION", CONSTRAINT_MESSAGES[c] ?? "A value is outside the allowed range", { constraint: c });
    }
    case "23503":
      return new AppError("VALIDATION", "A referenced record does not exist in this business", { constraint: pg.constraint });
    case "42501":
      return new AppError("FORBIDDEN", "Access denied");
    case "28000":
      return new AppError("UNAUTHENTICATED", pg.message);
    case "22P02":
      return new AppError("VALIDATION", "Invalid identifier or value");
    case "40001":
    case "40P01":
      return new AppError("CONFLICT", "The record was changed by someone else. Please retry.");
    default:
      return e;
  }
}
