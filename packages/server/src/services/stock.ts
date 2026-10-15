import type { Tenant } from "../context";
import { AppError } from "../errors";

export type MovementKind =
  | "opening" | "purchase" | "sale" | "sale_return" | "purchase_return" | "adjustment"
  | "transfer_in" | "transfer_out" | "service_consumption" | "reversal";

export interface MoveInput {
  productId: string;
  branchId: string;
  quantity: string | number; // signed
  kind: MovementKind;
  unitCost?: string | number | null;
  reason?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  sourceLineId?: string | null;
  transferGroup?: string | null;
  note?: string | null;
  allowNegative?: boolean;
  approvalId?: string | null;
}

/**
 * Writes one stock movement. The database trigger updates stock levels,
 * blocks negative stock unless explicitly overridden, and the unique index on
 * (source_line_id, kind) guarantees a document line moves stock only once.
 */
export async function moveStock(t: Tenant, m: MoveInput) {
  return t.db.one<{ id: string; balance_after: string }>(
    `insert into stock_movements(business_id, branch_id, product_id, quantity, unit_cost, kind, reason, source_type, source_id,
       source_line_id, transfer_group, note, allow_negative, approval_id, created_by)
     values ($1,$2,$3,$4,coalesce($5::numeric,0),$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning id, balance_after`,
    [
      t.businessId, m.branchId, m.productId, String(m.quantity), m.unitCost ?? null, m.kind, m.reason ?? null, m.sourceType ?? null,
      m.sourceId ?? null, m.sourceLineId ?? null, m.transferGroup ?? null, m.note ?? null, !!m.allowNegative, m.approvalId ?? null, t.userId,
    ],
  );
}

export async function currentAvgCost(t: Tenant, productId: string, branchId: string): Promise<string> {
  const r = await t.db.maybe<{ avg_cost: string }>("select avg_cost from stock_levels where product_id = $1 and branch_id = $2", [productId, branchId]);
  if (r && Number(r.avg_cost) > 0) return r.avg_cost;
  const p = await t.db.one<{ cost_price: string }>("select cost_price from products where id = $1", [productId]);
  return p.cost_price;
}

function assertSerialCount(serials: string[], quantity: string | number, productName: string) {
  const q = Number(quantity);
  if (!Number.isInteger(q)) throw new AppError("VALIDATION", `${productName} tracks serial numbers, so quantity must be a whole number`);
  const unique = new Set(serials.map((s) => s.trim().toUpperCase()));
  if (unique.size !== serials.length) throw new AppError("VALIDATION", `${productName}: serial numbers must be unique`);
  if (serials.length !== q) throw new AppError("VALIDATION", `${productName}: enter exactly ${q} serial number(s) (got ${serials.length})`);
}

/** Registers incoming serial numbers (purchase / opening / customer return). */
export async function receiveSerials(t: Tenant, p: { productId: string; productName: string; branchId: string; serials: string[]; quantity: string | number; purchaseDocumentId?: string | null; isReturn?: boolean }) {
  assertSerialCount(p.serials, p.quantity, p.productName);
  for (const raw of p.serials) {
    const sn = raw.trim().toUpperCase();
    const ex = await t.db.maybe<{ id: string; status: string }>(
      "select id, status from product_serials where product_id = $1 and serial_number = $2 for update",
      [p.productId, sn],
    );
    if (ex) {
      if (ex.status === "in_stock") throw new AppError("CONFLICT", `${p.productName}: serial ${sn} is already in stock`);
      if (!p.isReturn && ex.status === "sold") throw new AppError("CONFLICT", `${p.productName}: serial ${sn} was sold earlier; use a sales return (credit note)`);
      await t.db.exec(
        "update product_serials set status = 'in_stock', branch_id = $2, purchase_document_id = coalesce($3, purchase_document_id) where id = $1",
        [ex.id, p.branchId, p.purchaseDocumentId ?? null],
      );
    } else {
      if (p.isReturn) throw new AppError("VALIDATION", `${p.productName}: serial ${sn} was never sold by this business`);
      await t.db.exec(
        `insert into product_serials(business_id, product_id, serial_number, status, branch_id, purchase_document_id)
         values ($1,$2,$3,'in_stock',$4,$5)`,
        [t.businessId, p.productId, sn, p.branchId, p.purchaseDocumentId ?? null],
      );
    }
  }
}

/** Marks serial numbers as sold (or returned to the supplier). */
export async function issueSerials(t: Tenant, p: { productId: string; productName: string; branchId: string; serials: string[]; quantity: string | number; status: "sold" | "returned_to_supplier" | "defective"; saleDocumentId?: string | null; partyId?: string | null; soldOn?: string | null; warrantyMonths?: number | null }) {
  assertSerialCount(p.serials, p.quantity, p.productName);
  for (const raw of p.serials) {
    const sn = raw.trim().toUpperCase();
    const n = await t.db.exec(
      `update product_serials set status = $4, sale_document_id = coalesce($5, sale_document_id), party_id = coalesce($6, party_id),
         sold_on = coalesce($7, sold_on),
         warranty_until = case when $4 = 'sold' and $8::int is not null and $8::int > 0 then ($7::date + make_interval(months => $8::int))::date else warranty_until end
       where product_id = $1 and serial_number = $2 and status = 'in_stock' and branch_id = $3`,
      [p.productId, sn, p.branchId, p.status, p.saleDocumentId ?? null, p.partyId ?? null, p.soldOn ?? null, p.warrantyMonths ?? null],
    );
    if (!n) throw new AppError("BUSINESS_RULE", `${p.productName}: serial ${sn} is not in stock at this branch`);
  }
}
