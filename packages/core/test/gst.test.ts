import { describe, expect, it } from "vitest";
import vectors from "../../../test-vectors/gst.json";
import { calculateDocument, CalculationError, type CalcDocumentInput, D } from "../src";

describe("GST engine — shared vectors", () => {
  for (const c of vectors.cases) {
    it(c.name, () => {
      const r = calculateDocument(c.input as unknown as CalcDocumentInput);
      const { lines, taxBreakup, ...totals } = c.expect as Record<string, unknown> & { lines?: Record<string, string>[]; taxBreakup?: Record<string, string>[] };
      for (const [k, v] of Object.entries(totals)) expect(r[k as keyof typeof r], k).toBe(v);
      lines?.forEach((l, i) => {
        for (const [k, v] of Object.entries(l)) expect(r.lines[i]![k as keyof (typeof r.lines)[0]], `line ${i} ${k}`).toBe(v);
      });
      if (taxBreakup) expect(r.taxBreakup).toEqual(taxBreakup);
    });
  }
  for (const c of vectors.errors) {
    it(`rejects: ${c.name}`, () => {
      expect(() => calculateDocument(c.input as unknown as CalcDocumentInput)).toThrow(CalculationError);
    });
  }
});

describe("GST engine — invariants over random documents", () => {
  // Deterministic PRNG so failures are reproducible.
  let seed = 42;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const rates = [0, 5, 12, 18, 28];
  for (let n = 0; n < 300; n++) {
    const lines = Array.from({ length: 1 + Math.floor(rand() * 6) }, () => ({
      quantity: (1 + Math.floor(rand() * 2000) / 100).toFixed(2),
      unitPrice: (rand() * 5000).toFixed(2),
      discountType: rand() < 0.3 ? ("percent" as const) : null,
      discountValue: (rand() * 20).toFixed(2),
      taxRate: rates[Math.floor(rand() * rates.length)]!,
    }));
    const input: CalcDocumentInput = {
      lines,
      pricesIncludeTax: rand() < 0.4,
      isInterState: rand() < 0.3,
      roundOff: rand() < 0.7,
      documentDiscountType: rand() < 0.3 ? "percent" : null,
      documentDiscountValue: (rand() * 10).toFixed(2),
      additionalCharges: rand() < 0.3 ? (rand() * 500).toFixed(2) : null,
      additionalChargesTaxRate: 18,
    };
    it(`random document #${n} is internally consistent`, () => {
      const r = calculateDocument(input);
      const sum = (xs: string[]) => xs.reduce((a, x) => a.add(x), new D(0)).toFixed(2);
      expect(sum(r.lines.map((l) => l.documentDiscountShare))).toBe(r.documentDiscount);
      expect(sum([r.taxableTotal, r.taxTotal])).toBe(r.totalBeforeRounding);
      expect(sum([r.totalBeforeRounding, r.roundOff])).toBe(r.grandTotal);
      expect(sum([r.cgstTotal, r.sgstTotal, r.igstTotal])).toBe(r.taxTotal);
      expect(sum(r.taxBreakup.map((b) => b.taxableValue))).toBe(r.taxableTotal);
      if (input.isInterState) expect(r.cgstTotal).toBe("0.00");
      else {
        expect(r.igstTotal).toBe("0.00");
        expect(r.cgstTotal).toBe(r.sgstTotal);
      }
      expect(Math.abs(Number(r.roundOff))).toBeLessThanOrEqual(0.5);
      for (const l of r.lines) expect(Number(l.taxableValue)).toBeGreaterThanOrEqual(0);
    });
  }
});
