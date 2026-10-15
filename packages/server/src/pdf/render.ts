import path from "node:path";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import { amountInWords, formatDateIN, formatIndianNumber, formatIndianPhone, stateName, DOC_TYPE_META, PAYMENT_METHOD_LABEL, upiPaymentUri, type DocType } from "@cba/core";

import { existsSync } from "node:fs";

/**
 * Fonts are resolved at runtime because bundlers (Next.js) move this file.
 * Override with CBA_FONT_DIR when deploying somewhere unusual.
 */
function fontDir(): string {
  const candidates = [
    process.env.CBA_FONT_DIR,
    (() => {
      try {
        return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../assets/fonts");
      } catch {
        return undefined;
      }
    })(),
    path.join(process.cwd(), "../../packages/server/assets/fonts"),
    path.join(process.cwd(), "packages/server/assets/fonts"),
  ].filter(Boolean) as string[];
  const hit = candidates.find((d) => existsSync(path.join(d, "NotoSans-Regular.ttf")));
  if (!hit) throw new Error("PDF fonts not found; set CBA_FONT_DIR");
  return hit;
}
let FONT_DIR_CACHE: string | null = null;
const FONT_DIR_GET = () => (FONT_DIR_CACHE ??= fontDir());
const ORANGE = "#EA580C";
const INK = "#1F2937";
const MUTED = "#6B7280";
const LINE = "#E5E7EB";
const TINT = "#FFF7ED";

export interface PdfBusiness {
  name: string;
  legalName?: string | null;
  gstin?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string[];
  stateCode?: string | null;
  logo?: Buffer | null;
  bank?: { name?: string | null; accountName?: string | null; accountNumber?: string | null; ifsc?: string | null } | null;
  upiId?: string | null;
  gstScheme?: string;
  brandingFooter?: boolean;
}

export interface PdfDocumentData {
  docType: DocType;
  number: string | null;
  status: string;
  issueDate: string;
  dueDate?: string | null;
  validUntil?: string | null;
  placeOfSupply: string;
  isInterState: boolean;
  reverseCharge?: boolean;
  party: { name: string; gstin?: string | null; phone?: string | null; billing?: string[]; shipping?: string[] | null };
  referenceNumber?: string | null;
  supplierInvoiceNumber?: string | null;
  items: Array<{ description: string; hsnCode?: string | null; quantity: string; unit: string; unitPrice: string; lineDiscount: string; taxableValue: string; taxRate: string; cgst: string; sgst: string; igst: string; total: string; serialNumbers?: string[] }>;
  totals: { grossTotal: string; discountTotal: string; additionalCharges: string; additionalChargesLabel?: string | null; taxableTotal: string; cgstTotal: string; sgstTotal: string; igstTotal: string; roundOff: string; grandTotal: string; amountSettled: string; balanceDue: string };
  taxBreakup: Array<{ taxRate: string; taxableValue: string; cgst: string; sgst: string; igst: string }>;
  notes?: string | null;
  terms?: string | null;
  cancelled?: boolean;
}

function newDoc() {
  const doc = new PDFDocument({ size: "A4", margins: { top: 36, bottom: 48, left: 36, right: 36 }, bufferPages: true, info: { Producer: "CRAZY BUSINESS APP", Creator: "CRAZY BUSINESS APP" } });
  doc.registerFont("R", path.join(FONT_DIR_GET(), "NotoSans-Regular.ttf"));
  doc.registerFont("B", path.join(FONT_DIR_GET(), "NotoSans-Bold.ttf"));
  doc.font("R").fillColor(INK);
  return doc;
}

function collect(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

const money = (v: string | number) => formatIndianNumber(v);
const rupee = (v: string | number) => `₹${formatIndianNumber(v)}`;

function footer(doc: PDFKit.PDFDocument, branding: boolean) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // Writing inside the bottom margin would otherwise trigger a page break.
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const y = doc.page.height - 34;
    doc.font("R").fontSize(7).fillColor(MUTED);
    doc.text(`Page ${i + 1} of ${range.count}`, 36, y, { width: doc.page.width - 72, align: "right", lineBreak: false });
    if (branding) doc.text("Generated with CRAZY BUSINESS APP — One App. Complete Business Control.", 36, y, { width: 360, lineBreak: false });
    doc.page.margins.bottom = bottom;
  }
}

function header(doc: PDFKit.PDFDocument, b: PdfBusiness, title: string, meta: Array<[string, string]>) {
  const left = 36;
  const width = doc.page.width - 72;
  doc.rect(0, 0, doc.page.width, 6).fill(ORANGE);
  let x = left;
  if (b.logo) {
    try {
      doc.image(b.logo, left, 22, { fit: [64, 64] });
      x = left + 74;
    } catch {
      /* unsupported image — skip */
    }
  }
  doc.fillColor(INK).font("B").fontSize(15).text(b.name, x, 22, { width: 300 });
  doc.font("R").fontSize(8).fillColor(MUTED);
  const lines = [...(b.legalName && b.legalName !== b.name ? [b.legalName] : []), ...(b.address ?? [])];
  if (b.gstin) lines.push(`GSTIN: ${b.gstin}`);
  const contact = [b.phone ? formatIndianPhone(b.phone) : null, b.email].filter(Boolean).join("  •  ");
  if (contact) lines.push(contact);
  doc.text(lines.join("\n"), x, doc.y + 2, { width: 300 });
  const leftBottom = doc.y;

  doc.font("B").fontSize(14).fillColor(ORANGE).text(title.toUpperCase(), left, 22, { width, align: "right" });
  doc.font("R").fontSize(8.5).fillColor(INK);
  let y = 44;
  for (const [k, v] of meta) {
    doc.fillColor(MUTED).text(k, left + width - 230, y, { width: 100, align: "right" });
    doc.fillColor(INK).font("B").text(v, left + width - 125, y, { width: 125, align: "right" });
    doc.font("R");
    y += 12;
  }
  doc.y = Math.max(leftBottom, y, b.logo ? 90 : 0) + 10;
  doc.moveTo(left, doc.y).lineTo(left + width, doc.y).strokeColor(LINE).lineWidth(1).stroke();
  doc.y += 8;
}

function titleFor(type: DocType, b: PdfBusiness) {
  if (type === "invoice") return b.gstScheme && b.gstScheme !== "regular" ? "Bill of Supply" : b.gstin ? "Tax Invoice" : "Invoice";
  return DOC_TYPE_META[type].label;
}

export async function renderDocumentPdf(b: PdfBusiness, d: PdfDocumentData): Promise<Buffer> {
  const doc = newDoc();
  const out = collect(doc);
  const L = 36;
  const W = doc.page.width - 72;
  const meta: Array<[string, string]> = [
    [`${DOC_TYPE_META[d.docType].label} no.`, d.number ?? "DRAFT"],
    ["Date", formatDateIN(d.issueDate)],
  ];
  if (d.dueDate) meta.push(["Due date", formatDateIN(d.dueDate)]);
  if (d.validUntil) meta.push(["Valid until", formatDateIN(d.validUntil)]);
  if (d.docType !== "purchase_order" && d.docType !== "purchase_bill" && d.docType !== "debit_note") meta.push(["Place of supply", `${stateName(d.placeOfSupply)} (${d.placeOfSupply})`]);
  if (d.referenceNumber) meta.push(["Reference", d.referenceNumber]);
  if (d.supplierInvoiceNumber) meta.push(["Supplier bill no.", d.supplierInvoiceNumber]);
  header(doc, b, titleFor(d.docType, b), meta);

  if (d.status === "draft" || d.cancelled) {
    doc.save().rotate(-30, { origin: [doc.page.width / 2, doc.page.height / 2] });
    doc.font("B").fontSize(80).fillColor(d.cancelled ? "#DC2626" : "#9CA3AF").opacity(0.12).text(d.cancelled ? "CANCELLED" : "DRAFT", 0, doc.page.height / 2 - 50, { width: doc.page.width, align: "center" });
    doc.restore().opacity(1);
  }

  // Party boxes
  const side = DOC_TYPE_META[d.docType].side;
  const boxY = doc.y;
  const colW = (W - 12) / 2;
  const partyBox = (label: string, lines: string[], x: number) => {
    doc.font("B").fontSize(7.5).fillColor(ORANGE).text(label.toUpperCase(), x + 8, boxY + 6, { width: colW - 16 });
    doc.font("B").fontSize(10).fillColor(INK).text(lines[0] ?? "", x + 8, doc.y + 1, { width: colW - 16 });
    doc.font("R").fontSize(8).fillColor(INK).text(lines.slice(1).join("\n"), x + 8, doc.y + 1, { width: colW - 16 });
    return doc.y;
  };
  const partyLines = [d.party.name, ...(d.party.billing ?? []), ...(d.party.gstin ? [`GSTIN: ${d.party.gstin}`] : []), ...(d.party.phone ? [`Phone: ${formatIndianPhone(d.party.phone)}`] : [])];
  const y1 = partyBox(side === "sales" ? "Bill to" : "Supplier", partyLines, L);
  const y2 = d.party.shipping?.length ? partyBox("Ship to", [d.party.name, ...d.party.shipping], L + colW + 12) : boxY;
  const boxH = Math.max(y1, y2) - boxY + 8;
  doc.roundedRect(L, boxY, colW, boxH, 4).strokeColor(LINE).stroke();
  if (d.party.shipping?.length) doc.roundedRect(L + colW + 12, boxY, colW, boxH, 4).strokeColor(LINE).stroke();
  doc.y = boxY + boxH + 12;

  // Items table
  const showTax = !(b.gstScheme && b.gstScheme !== "regular" && side === "sales");
  const cols = showTax
    ? [
        { k: "#", w: 18, a: "left" },
        { k: "Item & description", w: 175, a: "left" },
        { k: "HSN/SAC", w: 48, a: "left" },
        { k: "Qty", w: 40, a: "right" },
        { k: "Rate", w: 55, a: "right" },
        { k: "Disc.", w: 42, a: "right" },
        { k: "Taxable", w: 60, a: "right" },
        { k: "GST", w: 30, a: "right" },
        { k: "Amount", w: 55, a: "right" },
      ]
    : [
        { k: "#", w: 18, a: "left" },
        { k: "Item & description", w: 250, a: "left" },
        { k: "HSN/SAC", w: 50, a: "left" },
        { k: "Qty", w: 45, a: "right" },
        { k: "Rate", w: 60, a: "right" },
        { k: "Disc.", w: 45, a: "right" },
        { k: "Amount", w: 55, a: "right" },
      ];
  const drawHead = () => {
    const y = doc.y;
    doc.rect(L, y, W, 18).fill(TINT);
    let x = L;
    doc.font("B").fontSize(7.5).fillColor(INK);
    for (const c of cols) {
      doc.text(c.k, x + 3, y + 5, { width: c.w - 6, align: c.a as "left" | "right" });
      x += c.w;
    }
    doc.y = y + 20;
  };
  drawHead();
  d.items.forEach((it, idx) => {
    const desc = [it.description, ...(it.serialNumbers?.length ? [`S/N: ${it.serialNumbers.join(", ")}`] : [])].join("\n");
    doc.font("R").fontSize(8);
    const h = Math.max(doc.heightOfString(desc, { width: cols[1]!.w - 6 }), 10) + 6;
    if (doc.y + h > doc.page.height - 60) {
      doc.addPage();
      drawHead();
    }
    const y = doc.y;
    const vals = showTax
      ? [String(idx + 1), desc, it.hsnCode ?? "", `${it.quantity} ${it.unit}`, money(it.unitPrice), Number(it.lineDiscount) ? money(it.lineDiscount) : "—", money(it.taxableValue), `${Number(it.taxRate)}%`, money(it.total)]
      : [String(idx + 1), desc, it.hsnCode ?? "", `${it.quantity} ${it.unit}`, money(it.unitPrice), Number(it.lineDiscount) ? money(it.lineDiscount) : "—", money(it.total)];
    let x = L;
    cols.forEach((c, i) => {
      doc.fillColor(i === 1 ? INK : INK).text(vals[i]!, x + 3, y + 3, { width: c.w - 6, align: c.a as "left" | "right" });
      x += c.w;
    });
    doc.y = y + h;
    doc.moveTo(L, doc.y).lineTo(L + W, doc.y).strokeColor(LINE).lineWidth(0.5).stroke();
  });

  // Totals
  doc.y += 8;
  if (doc.y > doc.page.height - 230) doc.addPage();
  const totalsX = L + W - 220;
  const startY = doc.y;
  const row = (k: string, v: string, bold = false, color = INK) => {
    const y = doc.y;
    doc.font(bold ? "B" : "R").fontSize(bold ? 10 : 8.5).fillColor(MUTED).text(k, totalsX, y, { width: 120, lineBreak: false });
    doc.fillColor(color).text(v, totalsX + 120, y, { width: 100, align: "right", lineBreak: false });
    doc.y = y + (bold ? 15 : 12.5);
  };
  if (Number(d.totals.discountTotal)) row("Discount", `− ${rupee(d.totals.discountTotal)}`);
  if (Number(d.totals.additionalCharges)) row(d.totals.additionalChargesLabel || "Other charges", rupee(d.totals.additionalCharges));
  if (showTax) {
    row("Taxable value", rupee(d.totals.taxableTotal));
    if (d.isInterState) row("IGST", rupee(d.totals.igstTotal));
    else {
      row("CGST", rupee(d.totals.cgstTotal));
      row("SGST/UTGST", rupee(d.totals.sgstTotal));
    }
  }
  if (Number(d.totals.roundOff)) row("Round off", `${Number(d.totals.roundOff) > 0 ? "+" : "−"} ${rupee(Math.abs(Number(d.totals.roundOff)))}`);
  doc.y += 3;
  doc.rect(totalsX - 6, doc.y - 2, 232, 20).fill(TINT);
  doc.y += 2;
  row("Total", rupee(d.totals.grandTotal), true, ORANGE);
  doc.y += 4;
  if (Number(d.totals.amountSettled) > 0 && (d.docType === "invoice" || d.docType === "purchase_bill")) {
    row("Paid", rupee(d.totals.amountSettled));
    row("Balance due", rupee(d.totals.balanceDue), true);
  }
  const totalsEnd = doc.y;

  // Left column: amount in words + tax breakup
  doc.font("B").fontSize(8).fillColor(MUTED).text("Amount in words", L, startY, { width: W - 240 });
  doc.font("R").fontSize(8.5).fillColor(INK).text(amountInWords(d.totals.grandTotal), L, doc.y + 1, { width: W - 240 });
  if (showTax && d.taxBreakup.length) {
    doc.y += 8;
    const tY = doc.y;
    const tc = d.isInterState ? [["GST rate", 60], ["Taxable", 90], ["IGST", 80]] : [["GST rate", 50], ["Taxable", 75], ["CGST", 60], ["SGST", 60]];
    let x = L;
    doc.font("B").fontSize(7.5).fillColor(MUTED);
    for (const [k, w] of tc) {
      doc.text(k as string, x, tY, { width: (w as number) - 4, align: "right" });
      x += w as number;
    }
    doc.font("R").fontSize(8).fillColor(INK);
    let ry = tY + 11;
    for (const tb of d.taxBreakup) {
      x = L;
      const vals = d.isInterState ? [`${Number(tb.taxRate)}%`, money(tb.taxableValue), money(tb.igst)] : [`${Number(tb.taxRate)}%`, money(tb.taxableValue), money(tb.cgst), money(tb.sgst)];
      vals.forEach((v, i) => {
        doc.text(v, x, ry, { width: (tc[i]![1] as number) - 4, align: "right" });
        x += tc[i]![1] as number;
      });
      ry += 11;
    }
    doc.y = ry;
  }
  if (d.reverseCharge) doc.font("B").fontSize(8).fillColor(INK).text("Tax payable on reverse charge basis: Yes", L, doc.y + 4);
  doc.y = Math.max(doc.y, totalsEnd) + 14;

  // Bank / UPI
  const payable = side === "sales" && (d.docType === "invoice" || d.docType === "quotation" || d.docType === "sales_order");
  if (payable && (b.bank?.accountNumber || b.upiId)) {
    if (doc.y > doc.page.height - 150) doc.addPage();
    const y = doc.y;
    doc.font("B").fontSize(8).fillColor(ORANGE).text("PAYMENT DETAILS", L, y);
    doc.font("R").fontSize(8).fillColor(INK);
    const lines: string[] = [];
    if (b.bank?.accountNumber) {
      lines.push(`Bank: ${b.bank.name ?? ""}`, `A/c name: ${b.bank.accountName ?? b.name}`, `A/c no.: ${b.bank.accountNumber}`, `IFSC: ${b.bank.ifsc ?? ""}`);
    }
    if (b.upiId) lines.push(`UPI: ${b.upiId}`);
    doc.text(lines.join("\n"), L, doc.y + 2, { width: 260 });
    let bottom = doc.y;
    if (b.upiId && Number(d.totals.balanceDue) > 0 && d.docType === "invoice") {
      const qr = await QRCode.toBuffer(upiPaymentUri({ upiId: b.upiId, payeeName: b.name, amount: d.totals.balanceDue, note: d.number ?? "Invoice" }), { margin: 1, width: 180 });
      doc.image(qr, L + 280, y, { width: 72 });
      doc.font("R").fontSize(7).fillColor(MUTED).text("Scan to pay with any UPI app", L + 360, y + 28, { width: 120 });
      bottom = Math.max(bottom, y + 76);
    }
    doc.y = bottom + 10;
  }

  if (d.notes) {
    doc.font("B").fontSize(8).fillColor(MUTED).text("Notes", L, doc.y);
    doc.font("R").fontSize(8).fillColor(INK).text(d.notes, L, doc.y + 1, { width: W });
    doc.y += 6;
  }
  if (d.terms) {
    if (doc.y > doc.page.height - 120) doc.addPage();
    doc.font("B").fontSize(8).fillColor(MUTED).text("Terms & conditions", L, doc.y);
    doc.font("R").fontSize(7.5).fillColor(INK).text(d.terms, L, doc.y + 1, { width: W - 200 });
  }
  // Signature
  const sigY = Math.min(Math.max(doc.y + 10, doc.page.height - 120), doc.page.height - 90);
  doc.font("B").fontSize(8.5).fillColor(INK).text(`For ${b.name}`, L + W - 200, sigY, { width: 200, align: "right" });
  doc.font("R").fontSize(7.5).fillColor(MUTED).text("Authorised signatory", L + W - 200, sigY + 34, { width: 200, align: "right" });
  doc.font("R").fontSize(7).fillColor(MUTED).text("This is a computer-generated document.", L, sigY + 34, { lineBreak: false });

  footer(doc, b.brandingFooter !== false);
  doc.end();
  return out;
}

export interface PdfReceipt {
  number: string;
  direction: "in" | "out";
  paidOn: string;
  amount: string;
  method: string;
  reference?: string | null;
  partyName: string;
  allocations: Array<{ number: string; amount: string }>;
  unallocated: string;
  status: string;
  notes?: string | null;
}

export async function renderReceiptPdf(b: PdfBusiness, r: PdfReceipt): Promise<Buffer> {
  const doc = newDoc();
  const out = collect(doc);
  const L = 36;
  const W = doc.page.width - 72;
  header(doc, b, r.direction === "in" ? "Payment Receipt" : "Payment Voucher", [
    ["Receipt no.", r.number],
    ["Date", formatDateIN(r.paidOn)],
    ["Mode", PAYMENT_METHOD_LABEL[r.method] ?? r.method],
  ]);
  doc.font("R").fontSize(10).fillColor(INK);
  doc.text(`${r.direction === "in" ? "Received with thanks from" : "Paid to"}`, L, doc.y + 6);
  doc.font("B").fontSize(13).text(r.partyName, L, doc.y + 2);
  doc.font("R").fontSize(10).text(`the sum of ${amountInWords(r.amount)}`, L, doc.y + 6, { width: W });
  doc.y += 12;
  doc.rect(L, doc.y, 200, 30).fill(TINT);
  doc.font("B").fontSize(16).fillColor(ORANGE).text(rupee(r.amount), L + 10, doc.y + 7);
  doc.y += 40;
  if (r.reference) doc.font("R").fontSize(9).fillColor(INK).text(`Reference: ${r.reference}`, L, doc.y);
  if (r.allocations.length) {
    doc.font("B").fontSize(9).fillColor(MUTED).text("Against", L, doc.y + 10);
    doc.font("R").fontSize(9).fillColor(INK);
    for (const a of r.allocations) doc.text(`${a.number}: ${rupee(a.amount)}`, L, doc.y + 2);
  }
  if (Number(r.unallocated) > 0) doc.text(`Advance / on account: ${rupee(r.unallocated)}`, L, doc.y + 4);
  if (r.notes) doc.text(`Notes: ${r.notes}`, L, doc.y + 8, { width: W });
  if (r.status === "void") doc.font("B").fontSize(28).fillColor("#DC2626").text("VOID", L, doc.y + 20);
  doc.font("B").fontSize(9).fillColor(INK).text(`For ${b.name}`, L + W - 200, doc.y + 50, { width: 200, align: "right" });
  doc.font("R").fontSize(8).fillColor(MUTED).text("Authorised signatory", L + W - 200, doc.y + 28, { width: 200, align: "right" });
  footer(doc, b.brandingFooter !== false);
  doc.end();
  return out;
}

export interface PdfTable {
  title: string;
  subtitle?: string;
  columns: Array<{ key: string; label: string; align?: "left" | "right"; width?: number; money?: boolean }>;
  rows: Record<string, unknown>[];
  totals?: Record<string, unknown>;
  notes?: string[];
}

/** Generic report table (landscape when there are many columns). */
export async function renderTablePdf(b: PdfBusiness, t: PdfTable): Promise<Buffer> {
  const landscape = t.columns.length > 6;
  const doc = new PDFDocument({ size: "A4", layout: landscape ? "landscape" : "portrait", margins: { top: 36, bottom: 48, left: 36, right: 36 }, bufferPages: true });
  doc.registerFont("R", path.join(FONT_DIR_GET(), "NotoSans-Regular.ttf"));
  doc.registerFont("B", path.join(FONT_DIR_GET(), "NotoSans-Bold.ttf"));
  const out = collect(doc);
  const L = 36;
  const W = doc.page.width - 72;
  header(doc, { ...b, logo: null }, t.title, t.subtitle ? [["Period", t.subtitle]] : []);
  const fixed = t.columns.reduce((a, c) => a + (c.width ?? 0), 0);
  const flex = t.columns.filter((c) => !c.width).length;
  const widths = t.columns.map((c) => c.width ?? (W - fixed) / Math.max(flex, 1));
  const fmtv = (c: PdfTable["columns"][number], v: unknown) => (v === null || v === undefined ? "" : c.money ? money(v as string) : String(v));
  const head = () => {
    const y = doc.y;
    doc.rect(L, y, W, 18).fill(TINT);
    let x = L;
    doc.font("B").fontSize(7.5).fillColor(INK);
    t.columns.forEach((c, i) => {
      doc.text(c.label, x + 3, y + 5, { width: widths[i]! - 6, align: c.align ?? (c.money ? "right" : "left") });
      x += widths[i]!;
    });
    doc.y = y + 20;
  };
  head();
  const drawRow = (r: Record<string, unknown>, bold = false) => {
    doc.font(bold ? "B" : "R").fontSize(8);
    const h = Math.max(...t.columns.map((c, i) => doc.heightOfString(fmtv(c, r[c.key]), { width: widths[i]! - 6 }))) + 5;
    if (doc.y + h > doc.page.height - 56) {
      doc.addPage();
      head();
    }
    const y = doc.y;
    let x = L;
    t.columns.forEach((c, i) => {
      doc.fillColor(INK).text(fmtv(c, r[c.key]), x + 3, y + 2.5, { width: widths[i]! - 6, align: c.align ?? (c.money ? "right" : "left") });
      x += widths[i]!;
    });
    doc.y = y + h;
    doc.moveTo(L, doc.y).lineTo(L + W, doc.y).strokeColor(LINE).lineWidth(0.5).stroke();
  };
  t.rows.forEach((r) => drawRow(r));
  if (!t.rows.length) doc.font("R").fontSize(9).fillColor(MUTED).text("No records for this period.", L, doc.y + 6);
  if (t.totals) drawRow(t.totals, true);
  if (t.notes?.length) {
    doc.y += 10;
    doc.font("R").fontSize(7.5).fillColor(MUTED);
    for (const n of t.notes) doc.text(`• ${n}`, L, doc.y + 2, { width: W });
  }
  footer(doc, b.brandingFooter !== false);
  doc.end();
  return out;
}
