import JSZip from "jszip";
import { toCSV } from "@cba/core";
import type { Tenant } from "../context";

const TABLES: Array<{ name: string; sql: string; financial?: boolean }> = [
  { name: "customers_suppliers", sql: "select * from parties order by created_at" },
  { name: "interactions", sql: "select * from party_interactions order by created_at" },
  { name: "categories", sql: "select * from categories order by name" },
  { name: "products", sql: "select * from products order by created_at" },
  { name: "stock_levels", sql: "select * from stock_levels" },
  { name: "stock_movements", sql: "select * from stock_movements order by created_at" },
  { name: "serial_numbers", sql: "select * from product_serials order by created_at" },
  { name: "documents", sql: "select * from documents order by issue_date, created_at" },
  { name: "document_items", sql: "select * from document_items order by document_id, position" },
  { name: "payments", sql: "select * from payments order by paid_on, created_at" },
  { name: "allocations", sql: "select * from allocations order by created_at" },
  { name: "accounts", sql: "select * from accounts order by name", financial: true },
  { name: "account_transactions", sql: "select * from account_transactions order by txn_date, created_at", financial: true },
  { name: "expense_categories", sql: "select * from expense_categories order by name" },
  { name: "expenses", sql: "select * from expenses order by expense_date" },
  { name: "service_tickets", sql: "select * from service_tickets order by created_at" },
  { name: "service_ticket_parts", sql: "select * from service_ticket_parts order by created_at" },
  { name: "amc_contracts", sql: "select * from amc_contracts order by start_date" },
  { name: "branches", sql: "select * from branches order by created_at" },
  { name: "audit_log", sql: "select id, user_id, action, entity_type, entity_id, summary, created_at from audit_logs order by created_at" },
];

/**
 * Tenant-scoped full data export (ZIP of CSV files + manifest). Every query
 * runs under RLS so only this business's rows can ever be included.
 */
export async function exportBusinessData(t: Tenant): Promise<{ zip: Buffer; filename: string }> {
  t.require("data.export");
  t.requireFeature("data_export");
  const zip = new JSZip();
  const manifest: Record<string, number> = {};
  for (const tb of TABLES) {
    if (tb.financial && !t.can("financials.view") && !t.can("accounts.view")) continue;
    const rows = await t.db.query<Record<string, unknown>>(tb.sql);
    manifest[tb.name] = rows.length;
    const headers = rows.length ? Object.keys(rows[0]!) : [];
    zip.file(`${tb.name}.csv`, toCSV(headers, rows.map((r) => headers.map((h) => { const v = r[h]; return v !== null && typeof v === "object" ? JSON.stringify(v) : v; }))));
  }
  zip.file(
    "manifest.json",
    JSON.stringify({ app: "CRAZY BUSINESS APP", business: { id: t.businessId, name: t.business.name, gstin: t.business.gstin }, exportedAt: new Date().toISOString(), exportedBy: t.user.email, tables: manifest }, null, 2),
  );
  await t.audit("data.export", "business", t.businessId, "Full data export downloaded");
  const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return { zip: buf, filename: `${t.business.name.replace(/[^\w]+/g, "-").toLowerCase()}-export-${t.today}.zip` };
}
