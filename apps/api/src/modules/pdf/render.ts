import { amountInWords, formatDateIN, formatIndianNumber, stateName } from "@cba/core";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";

const here = path.dirname(fileURLToPath(import.meta.url));
// Bundled build: dist/fonts. Source checkout: apps/api/assets/fonts. Noto Sans has the ₹ sign.
const fontDir = [path.join(here, "fonts"), path.resolve(here, "../../../assets/fonts")].find((d) => existsSync(path.join(d, "NotoSans-Regular.ttf")))!;
const REG = path.join(fontDir, "NotoSans-Regular.ttf");
const BOLD = path.join(fontDir, "NotoSans-Bold.ttf");
const INK = "#16192b", MUTED = "#5b6178", LINE = "#d9dce6", BRAND = "#2540af";
const n2 = (v: unknown) => formatIndianNumber(String(v ?? 0), 2);
const qtyFmt = (v: unknown) => String(Number(v));

function start(): { doc: PDFKit.PDFDocument; done: Promise<Buffer> } {
  const doc = new PDFDocument({ size: "A4", margin: 36, font: REG });
  const chunks: Buffer[] = [];
  doc.on("data", (c) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  doc.registerFont("r", REG).registerFont("b", BOLD).font("r").fillColor(INK);
  return { doc, done };
}

export interface Seller { name: string; gstin?: string | null; address?: string | null; phone?: string | null; stateCode: string; logo?: Buffer | null }

function header(doc: PDFKit.PDFDocument, s: Seller, title: string) {
  let x = 36;
  if (s.logo) {
    try {
      doc.image(s.logo, 36, 36, { fit: [52, 52] });
      x = 98;
    } catch { /* unsupported image type: skip the logo */ }
  }
  doc.font("b").fontSize(16).text(s.name, x, 36, { width: 330 });
  doc.font("r").fontSize(8.5).fillColor(MUTED);
  if (s.address) doc.text(s.address, { width: 330 });
  doc.text([s.gstin ? `GSTIN: ${s.gstin}` : null, s.phone ? `Phone: ${s.phone}` : null, `State: ${stateName(s.stateCode)} (${s.stateCode})`].filter(Boolean).join("   "), { width: 330 });
  doc.font("b").fontSize(15).fillColor(BRAND).text(title, 380, 36, { width: 179, align: "right" });
  doc.fillColor(INK);
  const y = Math.max(doc.y, 96) + 6;
  doc.moveTo(36, y).lineTo(559, y).strokeColor(LINE).stroke();
  return y + 10;
}

export function renderSalesPdf(d: any, s: Seller): Promise<Buffer> {
  const { doc, done } = start();
  const isInvoice = d.docType === "invoice";
  const taxed = Number(d.cgst) + Number(d.sgst) + Number(d.igst) > 0;
  let y = header(doc, s, isInvoice ? (taxed ? "TAX INVOICE" : "INVOICE") : "QUOTATION");

  doc.font("r").fontSize(8).fillColor(MUTED).text(isInvoice ? "BILL TO" : "QUOTATION FOR", 36, y);
  doc.font("b").fontSize(11).fillColor(INK).text(d.customer?.name ?? "Cash customer", 36, y + 11, { width: 300 });
  doc.font("r").fontSize(8.5).fillColor(MUTED);
  for (const t of [d.customer?.address, d.customer?.mobile ? `Mobile: ${d.customer.mobile}` : null, d.customer?.gstin ? `GSTIN: ${d.customer.gstin}` : null]) if (t) doc.text(t, { width: 300 });
  const leftEnd = doc.y;
  const meta: [string, string][] = [[isInvoice ? "Invoice no." : "Quotation no.", d.number], ["Date", formatDateIN(d.docDate)]];
  if (d.dueDate) meta.push(["Due date", formatDateIN(d.dueDate)]);
  if (d.validUntil) meta.push(["Valid until", formatDateIN(d.validUntil)]);
  meta.push(["Place of supply", `${stateName(d.placeOfSupply)} (${d.placeOfSupply})`]);
  let my = y;
  for (const [k, v] of meta) {
    doc.font("r").fontSize(8.5).fillColor(MUTED).text(k, 360, my, { width: 90 });
    doc.font("b").fillColor(INK).text(v, 450, my, { width: 109, align: "right" });
    my += 13;
  }
  y = Math.max(leftEnd, my) + 12;

  const cols = [{ t: "#", x: 36, w: 18 }, { t: "Item", x: 54, w: 190 }, { t: "HSN", x: 244, w: 46 }, { t: "Qty", x: 290, w: 50, a: "right" },
    { t: "Rate", x: 340, w: 62, a: "right" }, { t: "GST %", x: 402, w: 38, a: "right" }, { t: "Taxable", x: 440, w: 58, a: "right" }, { t: "Amount", x: 498, w: 61, a: "right" }] as const;
  const head = () => {
    doc.rect(36, y, 523, 18).fill("#eef1fb").fillColor(INK).font("b").fontSize(8);
    for (const c of cols) doc.text(c.t, c.x + 3, y + 5, { width: c.w - 6, align: (c as any).a ?? "left" });
    y += 22;
  };
  head();
  doc.font("r").fontSize(8.5);
  d.lines.forEach((l: any, i: number) => {
    const h = Math.max(14, doc.heightOfString(l.description, { width: 184 }) + 4);
    if (y + h > 720) { doc.addPage(); y = 40; head(); doc.font("r").fontSize(8.5); }
    const cells = [String(i + 1), l.description, l.hsn ?? "", `${qtyFmt(l.qty)} ${l.unit}`, n2(l.rate), qtyFmt(l.gstRate), n2(l.taxableValue), n2(l.total)];
    cols.forEach((c, j) => doc.fillColor(INK).text(cells[j]!, c.x + 3, y, { width: c.w - 6, align: (c as any).a ?? "left" }));
    y += h;
    doc.moveTo(36, y - 2).lineTo(559, y - 2).strokeColor("#eceef4").stroke();
  });
  if (y > 620) { doc.addPage(); y = 40; }
  y += 8;
  const totals: [string, string][] = [["Subtotal", n2(d.subtotal)]];
  if (Number(d.discountTotal) > 0) totals.push(["Discount", `- ${n2(d.discountTotal)}`]);
  if (taxed) totals.push(["Taxable value", n2(d.taxableTotal)]);
  if (Number(d.cgst) > 0) totals.push(["CGST", n2(d.cgst)], ["SGST", n2(d.sgst)]);
  if (Number(d.igst) > 0) totals.push(["IGST", n2(d.igst)]);
  if (Number(d.roundOff) !== 0) totals.push(["Round off", n2(d.roundOff)]);
  const top = y;
  for (const [k, v] of totals) {
    doc.font("r").fontSize(9).fillColor(MUTED).text(k, 370, y, { width: 90 });
    doc.fillColor(INK).text(v, 460, y, { width: 96, align: "right" });
    y += 14;
  }
  doc.rect(366, y, 193, 24).fill(BRAND).fillColor("#ffffff").font("b").fontSize(11).text("Total", 374, y + 6).text(`₹ ${n2(d.grandTotal)}`, 430, y + 6, { width: 122, align: "right" });
  y += 32;
  doc.fillColor(INK);
  if (isInvoice) {
    doc.font("r").fontSize(9).fillColor(MUTED).text("Paid", 370, y, { width: 90 });
    doc.fillColor(INK).text(n2(d.amountPaid), 460, y, { width: 96, align: "right" });
    doc.font("b").text("Balance due", 370, y + 14, { width: 90 }).text(`₹ ${n2(d.balanceDue)}`, 460, y + 14, { width: 96, align: "right" });
  }
  doc.font("r").fontSize(8).fillColor(MUTED).text("AMOUNT IN WORDS", 36, top);
  doc.font("b").fontSize(9).fillColor(INK).text(amountInWords(d.grandTotal), 36, top + 11, { width: 310 });
  if (d.notes) {
    doc.font("r").fontSize(8).fillColor(MUTED).text("NOTES", 36, doc.y + 8);
    doc.fontSize(9).fillColor(INK).text(d.notes, { width: 310 });
  }
  if (d.status === "cancelled") doc.font("b").fontSize(60).fillColor("#e11d48").opacity(0.18).text("CANCELLED", 90, 380).opacity(1);
  doc.font("r").fontSize(8).fillColor(MUTED).text(`For ${s.name}`, 380, 760, { width: 179, align: "right" }).text("Authorised signatory", 380, 790, { width: 179, align: "right" });
  doc.text("This is a computer-generated document.", 36, 790);
  doc.end();
  return done;
}

export function renderPayslipPdf(p: any, s: Seller): Promise<Buffer> {
  const { doc, done } = start();
  let y = header(doc, s, "PAYSLIP");
  const month = new Date(`${p.month}-01T00:00:00Z`).toLocaleString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
  doc.font("b").fontSize(11).text(`Salary slip for ${month}`, 36, y);
  y += 20;
  const info: [string, string][] = [["Employee", p.employee.name], ["Employee code", p.employee.code], ["Designation", p.employee.designation ?? "—"],
    ["Department", p.employee.department ?? "—"], ["PAN", p.employee.pan ?? "—"], ["Paid days", `${Number(p.paidDays)} of ${Number(p.daysInMonth)}`]];
  info.forEach(([k, v], i) => {
    const x = i % 2 ? 300 : 36, yy = y + Math.floor(i / 2) * 15;
    doc.font("r").fontSize(9).fillColor(MUTED).text(k, x, yy, { width: 90 });
    doc.font("b").fillColor(INK).text(v, x + 92, yy, { width: 160 });
  });
  y += 56;
  const b = p.breakdown;
  const earn: [string, string][] = [["Basic", b.basic], ...b.allowances.map((a: any) => [a.name, a.amount] as [string, string])];
  if (Number(b.bonus) > 0) earn.push(["Bonus / incentive", b.bonus]);
  const ded: [string, string][] = b.deductions.map((a: any) => [a.name, a.amount] as [string, string]);
  if (Number(b.otherDeduction) > 0) ded.push(["Advance / other", b.otherDeduction]);
  doc.rect(36, y, 523, 18).fill("#eef1fb").fillColor(INK).font("b").fontSize(9).text("Earnings", 42, y + 5).text("Amount (₹)", 200, y + 5, { width: 90, align: "right" })
    .text("Deductions", 306, y + 5).text("Amount (₹)", 462, y + 5, { width: 90, align: "right" });
  y += 24;
  doc.font("r");
  for (let i = 0; i < Math.max(earn.length, ded.length, 1); i++) {
    if (earn[i]) doc.text(earn[i]![0], 42, y, { width: 150 }).text(n2(earn[i]![1]), 200, y, { width: 90, align: "right" });
    if (ded[i]) doc.text(ded[i]![0], 306, y, { width: 150 }).text(n2(ded[i]![1]), 462, y, { width: 90, align: "right" });
    y += 15;
  }
  doc.moveTo(36, y).lineTo(559, y).strokeColor(LINE).stroke();
  y += 6;
  doc.font("b").text("Gross earnings", 42, y).text(n2(p.gross), 200, y, { width: 90, align: "right" }).text("Total deductions", 306, y).text(n2(Number(p.totalDeductions) + Number(p.advanceRecovery)), 462, y, { width: 90, align: "right" });
  y += 26;
  doc.rect(36, y, 523, 30).fill(BRAND).fillColor("#ffffff").fontSize(12).text("Net pay", 46, y + 8).text(`₹ ${n2(p.netPay)}`, 300, y + 8, { width: 250, align: "right" });
  doc.fillColor(INK).font("r").fontSize(9).text(amountInWords(p.netPay), 36, y + 40);
  doc.fontSize(8).fillColor(MUTED).text("This is a computer-generated payslip and does not need a signature.", 36, 790);
  doc.end();
  return done;
}
