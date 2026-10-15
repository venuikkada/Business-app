import { D, dec, r2, money, allocateProportionally, type Dec, type Numeric } from "./money";

/** GST slabs accepted by the engine. Businesses can only pick from these. */
export const GST_RATES = [0, 0.1, 0.25, 1.5, 3, 5, 6, 7.5, 12, 18, 28, 40] as const;
export const COMMON_GST_RATES = [0, 5, 12, 18, 28] as const;

export type DiscountType = "percent" | "amount";

export interface CalcLineInput {
  quantity: Numeric;
  unitPrice: Numeric;
  discountType?: DiscountType | null;
  discountValue?: Numeric | null;
  taxRate: Numeric;
}

export interface CalcDocumentInput {
  lines: CalcLineInput[];
  /** true when unit prices already include GST (typical retail MRP billing). */
  pricesIncludeTax: boolean;
  /** true → IGST, false → CGST + SGST. */
  isInterState: boolean;
  documentDiscountType?: DiscountType | null;
  documentDiscountValue?: Numeric | null;
  /** Delivery / freight / packing charges, always entered exclusive of tax. */
  additionalCharges?: Numeric | null;
  additionalChargesTaxRate?: Numeric | null;
  /** Round the grand total to the nearest rupee and record the round-off. */
  roundOff: boolean;
}

export interface CalcLineResult {
  gross: string;
  lineDiscount: string;
  documentDiscountShare: string;
  taxableValue: string;
  taxRate: string;
  cgst: string;
  sgst: string;
  igst: string;
  taxAmount: string;
  total: string;
}

export interface TaxBreakup {
  taxRate: string;
  taxableValue: string;
  cgst: string;
  sgst: string;
  igst: string;
  taxAmount: string;
}

export interface CalcDocumentResult {
  lines: CalcLineResult[];
  /** Sum of line gross amounts (qty × price). */
  grossTotal: string;
  lineDiscountTotal: string;
  documentDiscount: string;
  /** Total discount = line + document discounts. */
  discountTotal: string;
  additionalCharges: string;
  additionalChargesTax: string;
  taxableTotal: string;
  cgstTotal: string;
  sgstTotal: string;
  igstTotal: string;
  taxTotal: string;
  totalBeforeRounding: string;
  roundOff: string;
  grandTotal: string;
  taxBreakup: TaxBreakup[];
}

export class CalculationError extends Error {
  constructor(message: string, public readonly field?: string) {
    super(message);
    this.name = "CalculationError";
  }
}

function assertRate(rate: Dec, field: string) {
  const ok = GST_RATES.some((r) => dec(r).eq(rate));
  if (!ok) throw new CalculationError(`Unsupported GST rate ${rate.toString()}%`, field);
}

interface TaxParts {
  taxable: Dec;
  cgst: Dec;
  sgst: Dec;
  igst: Dec;
}

/**
 * Tax for one taxable amount. CGST and SGST are each computed on half the
 * rate and rounded separately so that they are always equal on the invoice.
 */
function taxOn(amount: Dec, rate: Dec, inclusive: boolean, interState: boolean): TaxParts {
  const taxable = inclusive ? r2(amount.mul(100).div(rate.add(100))) : r2(amount);
  if (interState) {
    return { taxable, cgst: new D(0), sgst: new D(0), igst: r2(taxable.mul(rate).div(100)) };
  }
  const half = r2(taxable.mul(rate).div(200));
  return { taxable, cgst: half, sgst: half, igst: new D(0) };
}

/**
 * The single authoritative GST calculator. The server recomputes every
 * document with this function on save; clients use it only for previews.
 */
export function calculateDocument(input: CalcDocumentInput): CalcDocumentResult {
  const inclusive = !!input.pricesIncludeTax;
  const inter = !!input.isInterState;

  const prepared = input.lines.map((l, i) => {
    const q = dec(l.quantity);
    const price = dec(l.unitPrice);
    const rate = dec(l.taxRate);
    if (!q.isFinite() || q.lte(0)) throw new CalculationError(`Line ${i + 1}: quantity must be greater than 0`, `lines.${i}.quantity`);
    if (q.decimalPlaces() > 3) throw new CalculationError(`Line ${i + 1}: quantity allows at most 3 decimals`, `lines.${i}.quantity`);
    if (!price.isFinite() || price.lt(0)) throw new CalculationError(`Line ${i + 1}: price cannot be negative`, `lines.${i}.unitPrice`);
    if (price.decimalPlaces() > 2) throw new CalculationError(`Line ${i + 1}: price allows at most 2 decimals`, `lines.${i}.unitPrice`);
    assertRate(rate, `lines.${i}.taxRate`);

    const gross = r2(q.mul(price));
    let lineDiscount = new D(0);
    const dv = dec(l.discountValue);
    if (dv.lt(0)) throw new CalculationError(`Line ${i + 1}: discount cannot be negative`, `lines.${i}.discountValue`);
    if (l.discountType === "percent") {
      if (dv.gt(100)) throw new CalculationError(`Line ${i + 1}: discount cannot exceed 100%`, `lines.${i}.discountValue`);
      lineDiscount = r2(gross.mul(dv).div(100));
    } else if (l.discountType === "amount") {
      if (r2(dv).gt(gross)) throw new CalculationError(`Line ${i + 1}: discount cannot exceed line amount`, `lines.${i}.discountValue`);
      lineDiscount = r2(dv);
    }
    return { gross, lineDiscount, net: gross.sub(lineDiscount), rate };
  });

  const netSum = prepared.reduce((a, p) => a.add(p.net), new D(0));

  // Document-level (pre-tax) discount, pro-rated across lines.
  let documentDiscount = new D(0);
  const ddv = dec(input.documentDiscountValue);
  if (ddv.lt(0)) throw new CalculationError("Document discount cannot be negative", "documentDiscountValue");
  if (input.documentDiscountType === "percent") {
    if (ddv.gt(100)) throw new CalculationError("Document discount cannot exceed 100%", "documentDiscountValue");
    documentDiscount = r2(netSum.mul(ddv).div(100));
  } else if (input.documentDiscountType === "amount") {
    documentDiscount = r2(ddv);
    if (documentDiscount.gt(netSum)) throw new CalculationError("Document discount cannot exceed the subtotal", "documentDiscountValue");
  }
  const shares = allocateProportionally(documentDiscount, prepared.map((p) => p.net));

  const lines: CalcLineResult[] = prepared.map((p, i) => {
    const after = p.net.sub(shares[i] ?? 0);
    const t = taxOn(after, p.rate, inclusive, inter);
    const tax = t.cgst.add(t.sgst).add(t.igst);
    return {
      gross: money(p.gross),
      lineDiscount: money(p.lineDiscount),
      documentDiscountShare: money(shares[i] ?? 0),
      taxableValue: money(t.taxable),
      taxRate: p.rate.toString(),
      cgst: money(t.cgst),
      sgst: money(t.sgst),
      igst: money(t.igst),
      taxAmount: money(tax),
      total: money(t.taxable.add(tax)),
    };
  });

  // Additional charges are exclusive of tax.
  const charges = r2(dec(input.additionalCharges));
  if (charges.lt(0)) throw new CalculationError("Additional charges cannot be negative", "additionalCharges");
  const chargesRate = dec(input.additionalChargesTaxRate);
  assertRate(chargesRate, "additionalChargesTaxRate");
  const ct = taxOn(charges, chargesRate, false, inter);
  const chargesTax = ct.cgst.add(ct.sgst).add(ct.igst);

  const sum = (k: keyof CalcLineResult) => lines.reduce((a, l) => a.add(l[k]), new D(0));
  const cgstTotal = sum("cgst").add(ct.cgst);
  const sgstTotal = sum("sgst").add(ct.sgst);
  const igstTotal = sum("igst").add(ct.igst);
  const taxTotal = cgstTotal.add(sgstTotal).add(igstTotal);
  const taxableTotal = sum("taxableValue").add(charges);
  const totalBeforeRounding = taxableTotal.add(taxTotal);
  const grandTotal = input.roundOff ? totalBeforeRounding.toDecimalPlaces(0, D.ROUND_HALF_UP) : totalBeforeRounding;
  const roundOff = grandTotal.sub(totalBeforeRounding);

  // Rate-wise breakup (needed on GST invoices and for GST summaries).
  const breakup = new Map<string, { taxable: Dec; cgst: Dec; sgst: Dec; igst: Dec }>();
  const add = (rate: string, taxable: Numeric, c: Numeric, s: Numeric, ig: Numeric) => {
    const cur = breakup.get(rate) ?? { taxable: new D(0), cgst: new D(0), sgst: new D(0), igst: new D(0) };
    cur.taxable = cur.taxable.add(taxable);
    cur.cgst = cur.cgst.add(c);
    cur.sgst = cur.sgst.add(s);
    cur.igst = cur.igst.add(ig);
    breakup.set(rate, cur);
  };
  lines.forEach((l) => add(l.taxRate, l.taxableValue, l.cgst, l.sgst, l.igst));
  if (charges.gt(0)) add(chargesRate.toString(), charges, ct.cgst, ct.sgst, ct.igst);
  const taxBreakup = [...breakup.entries()]
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([rate, v]) => ({
      taxRate: rate,
      taxableValue: money(v.taxable),
      cgst: money(v.cgst),
      sgst: money(v.sgst),
      igst: money(v.igst),
      taxAmount: money(v.cgst.add(v.sgst).add(v.igst)),
    }));

  const lineDiscountTotal = sum("lineDiscount");
  return {
    lines,
    grossTotal: money(sum("gross")),
    lineDiscountTotal: money(lineDiscountTotal),
    documentDiscount: money(documentDiscount),
    discountTotal: money(lineDiscountTotal.add(documentDiscount)),
    additionalCharges: money(charges),
    additionalChargesTax: money(chargesTax),
    taxableTotal: money(taxableTotal),
    cgstTotal: money(cgstTotal),
    sgstTotal: money(sgstTotal),
    igstTotal: money(igstTotal),
    taxTotal: money(taxTotal),
    totalBeforeRounding: money(totalBeforeRounding),
    roundOff: money(roundOff),
    grandTotal: money(grandTotal),
    taxBreakup,
  };
}

/**
 * Discount percentage of a document relative to its gross value. Used for
 * owner-approval thresholds on high discounts.
 */
export function effectiveDiscountPercent(result: CalcDocumentResult): string {
  const gross = dec(result.grossTotal);
  if (gross.isZero()) return "0";
  return dec(result.discountTotal).mul(100).div(gross).toDecimalPlaces(2).toString();
}
