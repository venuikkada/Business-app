import { INDIAN_STATES, validateGSTIN, validatePAN, validatePincode } from "@cba/core";
import { z } from "zod";
import { SECTOR_KEYS } from "../../lib/sectors.js";

const stateCodes = INDIAN_STATES.map((s) => s.code);
export const stateCode = z.string().refine((v) => stateCodes.includes(v), "Choose a valid state");
const opt = (s: z.ZodString) => s.optional().nullable().transform((v) => (v === "" || v == null ? null : v));

export const gstin = z
  .string()
  .trim()
  .toUpperCase()
  .superRefine((v, ctx) => {
    const r = validateGSTIN(v);
    if (!r.valid) ctx.addIssue({ code: "custom", message: r.reason ?? "Invalid GSTIN" });
  });

const pincode = z.string().trim().refine(validatePincode, "Pincode must be 6 digits");
const prefix = z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{1,6}$/, "Use up to 6 letters/numbers");

export const branchInput = z.object({
  name: z.string().trim().min(2).max(120),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,10}$/, "Code: up to 10 letters/numbers").optional(),
  stateCode,
  gstin: gstin.optional().nullable().or(z.literal("").transform(() => null)),
  addressLine1: opt(z.string().trim().max(200)),
  addressLine2: opt(z.string().trim().max(200)),
  city: opt(z.string().trim().max(80)),
  pincode: pincode.optional().nullable().or(z.literal("").transform(() => null)),
  phone: opt(z.string().trim().max(15)),
  invoicePrefix: prefix.optional(),
});

export const createTenantInput = z
  .object({
    name: z.string().trim().min(2).max(150),
    legalName: opt(z.string().trim().max(200)),
    gstin: gstin.optional().nullable().or(z.literal("").transform(() => null)),
    pan: z.string().trim().toUpperCase().refine(validatePAN, "Invalid PAN").optional().nullable().or(z.literal("").transform(() => null)),
    sector: z.enum(SECTOR_KEYS),
    stateCode,
    addressLine1: opt(z.string().trim().max(200)),
    addressLine2: opt(z.string().trim().max(200)),
    city: opt(z.string().trim().max(80)),
    pincode: pincode.optional().nullable().or(z.literal("").transform(() => null)),
    phone: opt(z.string().trim().max(15)),
    email: z.string().trim().toLowerCase().email().optional().nullable().or(z.literal("").transform(() => null)),
    fyStartMonth: z.number().int().min(1).max(12).default(4),
    defaultLanguage: z.enum(["en", "hi", "te", "hinglish"]).default("en"),
    invoicePrefix: prefix.default("INV"),
    branches: z.array(branchInput).min(1).max(20),
  })
  .superRefine((v, ctx) => {
    if (v.gstin && v.gstin.slice(0, 2) !== v.stateCode)
      ctx.addIssue({ code: "custom", path: ["gstin"], message: "GSTIN state code does not match the selected state" });
    if (v.gstin && v.pan && v.gstin.slice(2, 12) !== v.pan)
      ctx.addIssue({ code: "custom", path: ["pan"], message: "PAN does not match the GSTIN" });
    v.branches.forEach((b, i) => {
      if (b.gstin && b.gstin.slice(0, 2) !== b.stateCode)
        ctx.addIssue({ code: "custom", path: ["branches", i, "gstin"], message: "Branch GSTIN state code does not match its state" });
    });
  });

export const updateTenantInput = z
  .object({
    name: z.string().trim().min(2).max(150),
    legalName: opt(z.string().trim().max(200)),
    gstin: gstin.nullable().or(z.literal("").transform(() => null)),
    pan: z.string().trim().toUpperCase().refine(validatePAN, "Invalid PAN").nullable().or(z.literal("").transform(() => null)),
    stateCode,
    addressLine1: opt(z.string().trim().max(200)),
    addressLine2: opt(z.string().trim().max(200)),
    city: opt(z.string().trim().max(80)),
    pincode: pincode.nullable().or(z.literal("").transform(() => null)),
    phone: opt(z.string().trim().max(15)),
    email: z.string().trim().toLowerCase().email().nullable().or(z.literal("").transform(() => null)),
    defaultLanguage: z.enum(["en", "hi", "te", "hinglish"]),
    aggregateTurnoverBand: z.enum(["below_5cr", "5cr_to_20cr", "above_20cr"]).nullable(),
  })
  .partial()
  .superRefine((v, ctx) => {
    if (v.gstin && v.stateCode && v.gstin.slice(0, 2) !== v.stateCode)
      ctx.addIssue({ code: "custom", path: ["gstin"], message: "GSTIN state code does not match the selected state" });
  });

export const updateSeriesInput = z.object({
  prefix,
  nextNumber: z.number().int().min(1).max(9_999_999).optional(),
  padding: z.number().int().min(1).max(7).optional(),
});
