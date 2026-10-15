import { describe, expect, it } from "vitest";
import {
  validateGSTIN, gstinCheckChar, normalizeIndianPhone, financialYear, financialYearShort, financialYearRange,
  amountInWords, numberToIndianWords, formatINR, formatDateIN, dateRangeForPreset, istDate, allocateProportionally,
  formatDocumentNumber, parseCSV, parseCSVObjects, toCSV, whatsappLink, ALL_PERMISSIONS, SYSTEM_ROLES,
} from "../src";

describe("GSTIN", () => {
  it("accepts a structurally valid GSTIN with correct checksum", () => {
    const base = "29ABCDE1234F1Z";
    const g = base + gstinCheckChar(base);
    expect(validateGSTIN(g)).toMatchObject({ valid: true, stateCode: "29", pan: "ABCDE1234F" });
    expect(validateGSTIN(g.toLowerCase()).valid).toBe(true);
  });
  it("rejects wrong checksum, bad format and unknown state", () => {
    const base = "29ABCDE1234F1Z";
    const good = gstinCheckChar(base);
    const bad = good === "A" ? "B" : "A";
    expect(validateGSTIN(base + bad).valid).toBe(false);
    expect(validateGSTIN("29ABCDE1234F1Y5").valid).toBe(false);
    expect(validateGSTIN("99ABCDE1234F1Z" + gstinCheckChar("99ABCDE1234F1Z")).valid).toBe(false);
  });
  it("matches a known published-format example checksum", () => {
    // 27AAPFU0939F1ZV is the example used in GST documentation.
    expect(gstinCheckChar("27AAPFU0939F1Z")).toBe("V");
  });
});

describe("Indian phone numbers", () => {
  it.each([
    ["9876543210", "+919876543210"],
    ["+91 98765 43210", "+919876543210"],
    ["09876543210", "+919876543210"],
    ["919876543210", "+919876543210"],
    ["0091-98765-43210", "+919876543210"],
  ])("%s → %s", (i, o) => expect(normalizeIndianPhone(i)).toBe(o));
  it.each(["12345", "5876543210", "+1 415 555 0100", "98765432100"])("rejects %s", (i) => expect(normalizeIndianPhone(i)).toBeNull());
});

describe("financial year", () => {
  it("April starts the year", () => {
    expect(financialYear("2026-04-01")).toBe("2026-27");
    expect(financialYear("2026-03-31")).toBe("2025-26");
    expect(financialYearShort("2026-10-15")).toBe("26-27");
    expect(financialYearRange("2026-10-15")).toEqual({ from: "2026-04-01", to: "2027-03-31" });
    expect(financialYearRange("2028-02-10")).toEqual({ from: "2027-04-01", to: "2028-03-31" });
  });
  it("date presets", () => {
    expect(dateRangeForPreset("month", "2026-10-15")).toEqual({ from: "2026-10-01", to: "2026-10-15" });
    expect(dateRangeForPreset("last_month", "2026-01-10")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(dateRangeForPreset("week", "2026-10-15")).toEqual({ from: "2026-10-12", to: "2026-10-15" });
    expect(dateRangeForPreset("last_fy", "2026-10-15")).toEqual({ from: "2025-04-01", to: "2026-03-31" });
  });
  it("IST date differs from UTC near midnight", () => {
    expect(istDate(new Date("2026-10-14T19:00:00Z"))).toBe("2026-10-15");
    expect(istDate(new Date("2026-10-14T18:00:00Z"))).toBe("2026-10-14");
  });
});

describe("formatting", () => {
  it("INR with lakh grouping", () => {
    expect(formatINR("123456.7")).toBe("₹1,23,456.70");
    expect(formatDateIN("2026-10-05")).toBe("05/10/2026");
  });
  it("amount in words", () => {
    expect(numberToIndianWords(12345678)).toBe("One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight");
    expect(amountInWords("1180.50")).toBe("Rupees One Thousand One Hundred Eighty and Fifty Paise Only");
    expect(amountInWords("100000")).toBe("Rupees One Lakh Only");
  });
  it("document numbers fit the 16 character GST limit", () => {
    const n = formatDocumentNumber("INV", "26-27", 12345);
    expect(n).toBe("INV/26-27/12345");
    expect(n.length).toBeLessThanOrEqual(16);
  });
});

describe("allocation", () => {
  it("always sums exactly", () => {
    const parts = allocateProportionally("100.00", [1, 1, 1]);
    expect(parts.map((p) => p.toFixed(2))).toEqual(["33.34", "33.33", "33.33"]);
  });
});

describe("CSV", () => {
  it("round-trips quotes, commas and newlines", () => {
    const csv = toCSV(["name", "note"], [["A, B", 'He said "hi"'], ["Line\nbreak", ""]]);
    expect(parseCSV(csv)).toEqual([["name", "note"], ["A, B", 'He said "hi"'], ["Line\nbreak", ""]]);
  });
  it("neutralises spreadsheet formula injection", () => {
    expect(toCSV(["x"], [["=HYPERLINK(1)"], ["-5"]])).toBe("x\r\n'=HYPERLINK(1)\r\n-5\r\n");
  });
  it("normalises headers", () => {
    expect(parseCSVObjects("Name,GSTIN Number\nAcme,\n").rows).toEqual([{ name: "Acme", gstin_number: "" }]);
  });
});

describe("misc", () => {
  it("whatsapp links encode text", () => {
    expect(whatsappLink("+919876543210", "Hi & bye")).toBe("https://wa.me/919876543210?text=Hi%20%26%20bye");
  });
  it("owner has every permission, technician very few", () => {
    expect(SYSTEM_ROLES.owner.permissions.length).toBe(ALL_PERMISSIONS.length);
    expect(SYSTEM_ROLES.technician.permissions).not.toContain("financials.view");
    expect(SYSTEM_ROLES.salesperson.permissions).not.toContain("financials.view");
    for (const r of Object.values(SYSTEM_ROLES)) for (const p of r.permissions) expect(ALL_PERMISSIONS).toContain(p);
  });
});
