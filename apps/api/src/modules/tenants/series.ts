import type { TenantDb } from "../../db/pool.js";
import { fyLabel, fyShortLabel } from "../../lib/dates.js";
import { DOC_PREFIXES, DOC_TYPES } from "../../lib/sectors.js";
import { badRequest } from "../../lib/errors.js";

/** Creates number series for every document type for one branch and FY (idempotent). */
export async function ensureSeries(tdb: TenantDb, branchId: number, fy: string, prefixes: Record<string, string> = {}) {
  for (const t of DOC_TYPES) {
    await tdb.exec(
      `INSERT IGNORE INTO document_series (tenant_id, branch_id, doc_type, fy, prefix)
       VALUES (:tenantId, :branchId, :docType, :fy, :prefix)`,
      { branchId, docType: t, fy, prefix: prefixes[t] ?? DOC_PREFIXES[t] },
    );
  }
}

export function formatDocNumber(prefix: string, isoDate: string, n: number, padding: number, fyStartMonth = 4): string {
  const s = `${prefix}/${fyShortLabel(isoDate, fyStartMonth)}/${String(n).padStart(padding, "0")}`;
  if (s.length > 16) throw badRequest("number_too_long", "Document number would be longer than 16 characters. Use a shorter prefix.");
  return s;
}

/**
 * Next gap-free number. MUST be called inside the transaction that saves the
 * document: the row lock (FOR UPDATE) makes two cashiers get different numbers,
 * and a rollback gives the number back.
 */
export async function nextDocNumber(tdb: TenantDb, branchId: number, docType: string, isoDate: string, fyStartMonth = 4): Promise<{ number: string; fy: string }> {
  const fy = fyLabel(isoDate, fyStartMonth);
  let row = await tdb.one(
    `SELECT id, prefix, next_number, padding FROM document_series
      WHERE tenant_id = :tenantId AND branch_id = :branchId AND doc_type = :docType AND fy = :fy FOR UPDATE`,
    { branchId, docType, fy },
  );
  if (!row) {
    // New financial year: copy last year's prefix and start again at 1.
    const prev = await tdb.one(
      `SELECT prefix FROM document_series WHERE tenant_id = :tenantId AND branch_id = :branchId AND doc_type = :docType
        ORDER BY fy DESC LIMIT 1`,
      { branchId, docType },
    );
    await tdb.exec(
      `INSERT IGNORE INTO document_series (tenant_id, branch_id, doc_type, fy, prefix) VALUES (:tenantId, :branchId, :docType, :fy, :prefix)`,
      { branchId, docType, fy, prefix: prev?.prefix ?? DOC_PREFIXES[docType] ?? "DOC" },
    );
    row = await tdb.one(
      `SELECT id, prefix, next_number, padding FROM document_series
        WHERE tenant_id = :tenantId AND branch_id = :branchId AND doc_type = :docType AND fy = :fy FOR UPDATE`,
      { branchId, docType, fy },
    );
  }
  const number = formatDocNumber(row.prefix, isoDate, Number(row.next_number), Number(row.padding), fyStartMonth);
  await tdb.exec("UPDATE document_series SET next_number = next_number + 1 WHERE tenant_id = :tenantId AND id = :id", { id: row.id });
  return { number, fy };
}
