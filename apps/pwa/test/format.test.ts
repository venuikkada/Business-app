import { describe, expect, it } from "vitest";
import { date, dateTime, inr, phone } from "../src/lib/format";

describe("Indian formats", () => {
  it("₹ with lakh/crore grouping", () => {
    expect(inr(1234567.5)).toBe("₹12,34,567.50");
    expect(inr("125000000")).toBe("₹12,50,00,000.00");
  });
  it("dd/mm/yyyy in IST (a UTC evening is the next day in India)", () => {
    expect(date("2026-11-12")).toBe("12/11/2026");
    expect(date("2026-11-12T20:00:00.000Z")).toBe("13/11/2026");
    expect(dateTime("2026-11-12T20:00:00.000Z")).toBe("13/11/2026 01:30 AM");
  });
  it("mobile numbers", () => {
    expect(phone("+919876543210")).toBe("+91 98765 43210");
  });
});
