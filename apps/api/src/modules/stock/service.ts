import { dec } from "@cba/core";
import { TenantDb, withTx } from "../../db/pool.js";
import { canUseBranch, type TenantCtx } from "../../http/context.js";
import { badRequest, forbidden, notFound } from "../../lib/errors.js";
import { istDate } from "../../lib/dates.js";
import { audit } from "../audit/service.js";

export interface Movement {
  branchId: number;
  variantId: number;
  /** positive = stock in, negative = stock out */
  qty: string | number;
  unitCost?: string | number | null;
  type: string;
  refType?: string | null;
  refId?: number | null;
  reason?: string | null;
  date?: string;
  userId?: number | null;
}

/**
 * The only place stock changes. Locks the stock row, updates the quantity and the
 * weighted-average cost (on stock-in), and writes a ledger row. Must run inside the
 * caller's transaction so the bill and its stock move together.
 */
export async function applyMovement(tdb: TenantDb, m: Movement): Promise<{ qtyAfter: string }> {
  const qty = dec(m.qty);
  if (qty.isZero()) return { qtyAfter: "0" };
  await tdb.exec(
    "INSERT IGNORE INTO stock_levels (tenant_id, branch_id, variant_id, qty, avg_cost) VALUES (:tenantId, :b, :v, 0, 0)",
    { b: m.branchId, v: m.variantId },
  );
  const cur = await tdb.one(
    "SELECT qty, avg_cost FROM stock_levels WHERE tenant_id = :tenantId AND branch_id = :b AND variant_id = :v FOR UPDATE",
    { b: m.branchId, v: m.variantId },
  );
  const oldQty = dec(cur.qty);
  const newQty = oldQty.plus(qty);
  let avg = dec(cur.avg_cost);
  const cost = m.unitCost != null ? dec(m.unitCost) : avg;
  if (qty.gt(0) && m.unitCost != null) {
    // weighted average; if stock was zero or negative, the new cost simply becomes the average
    avg = oldQty.gt(0) ? oldQty.mul(avg).plus(qty.mul(cost)).div(newQty) : cost;
  }
  await tdb.exec(
    "UPDATE stock_levels SET qty = :q, avg_cost = :a WHERE tenant_id = :tenantId AND branch_id = :b AND variant_id = :v",
    { b: m.branchId, v: m.variantId, q: newQty.toFixed(3), a: avg.toFixed(4) },
  );
  await tdb.exec(
    `INSERT INTO stock_movements (tenant_id, branch_id, variant_id, qty, unit_cost, movement_type, ref_type, ref_id, reason, movement_date, created_by)
     VALUES (:tenantId, :b, :v, :qty, :cost, :type, :refType, :refId, :reason, :date, :by)`,
    {
      b: m.branchId, v: m.variantId, qty: qty.toFixed(3), cost: cost.toFixed(4), type: m.type, refType: m.refType ?? null,
      refId: m.refId ?? null, reason: m.reason ?? null, date: m.date ?? istDate(), by: m.userId ?? null,
    },
  );
  return { qtyAfter: newQty.toFixed(3) };
}

export function assertBranch(ctx: TenantCtx, branchId: number) {
  if (!canUseBranch(ctx, branchId)) throw forbidden("branch_not_allowed", "You do not have access to this branch.");
}

export async function defaultBranchId(ctx: TenantCtx, wanted?: number | null): Promise<number> {
  if (wanted) {
    const b = await ctx.tdb.one("SELECT id FROM branches WHERE tenant_id = :tenantId AND id = :id AND is_active = 1", { id: wanted });
    if (!b) throw badRequest("invalid_branch", "Choose a valid branch.");
    assertBranch(ctx, wanted);
    return wanted;
  }
  const rows = await ctx.tdb.all("SELECT id FROM branches WHERE tenant_id = :tenantId AND is_active = 1 ORDER BY is_default DESC, id");
  const pick = rows.map((r) => Number(r.id)).find((id) => canUseBranch(ctx, id));
  if (!pick) throw forbidden("branch_not_allowed", "You do not have access to any branch.");
  return pick;
}

/** Manual stock entry: "in" (received), "out" (removed) or "set" (physical count). A reason is always recorded. */
export async function manualEntry(
  ctx: TenantCtx,
  input: { branchId?: number; variantId: number; mode: "in" | "out" | "set"; qty: number; unitCost?: number | null; reason: string; note?: string | null },
) {
  const branchId = await defaultBranchId(ctx, input.branchId);
  return withTx(async (conn) => {
    const tdb = new TenantDb(conn, ctx.tenantId);
    const v = await tdb.one(
      `SELECT v.id, v.purchase_price, i.name, i.track_stock FROM item_variants v JOIN items i ON i.id = v.item_id AND i.tenant_id = v.tenant_id
        WHERE v.tenant_id = :tenantId AND v.id = :id AND i.deleted_at IS NULL`,
      { id: input.variantId },
    );
    if (!v) throw notFound("Item");
    if (!v.track_stock) throw badRequest("not_stock_item", "Stock is not tracked for this item (it is a service).");
    let change = dec(input.qty);
    if (input.mode === "out") change = change.neg();
    if (input.mode === "set") {
      const cur = await tdb.one("SELECT qty FROM stock_levels WHERE tenant_id = :tenantId AND branch_id = :b AND variant_id = :v", { b: branchId, v: v.id });
      change = dec(input.qty).minus(dec(cur?.qty ?? 0));
    }
    if (change.isZero()) throw badRequest("no_change", "Stock is already at this quantity.");
    const reason = [input.reason, input.note].filter(Boolean).join(" — ").slice(0, 200);
    const out = await applyMovement(tdb, {
      branchId, variantId: v.id, qty: change.toFixed(3),
      unitCost: change.gt(0) ? (input.unitCost ?? v.purchase_price) : null,
      type: input.mode === "in" ? "purchase" : "adjustment", refType: "manual", reason, userId: ctx.userId,
    });
    await audit(tdb, ctx, {
      action: "create", entityType: "stock_movement", entityId: v.id, branchId,
      summary: `Stock ${change.gt(0) ? "+" : ""}${change.toFixed(3).replace(/\.?0+$/, "")} for "${v.name}" (${reason})`,
      after: { qty_change: change.toFixed(3), qty_after: out.qtyAfter, reason },
    });
    return { qtyAfter: out.qtyAfter };
  });
}

export async function listMovements(ctx: TenantCtx, variantId: number, limit = 50) {
  const rows = await ctx.tdb.all(
    `SELECT m.id, m.qty, m.unit_cost, m.movement_type, m.ref_type, m.ref_id, m.reason, m.movement_date, m.created_at, b.name AS branch, u.name AS user_name
       FROM stock_movements m JOIN branches b ON b.id = m.branch_id AND b.tenant_id = m.tenant_id LEFT JOIN users u ON u.id = m.created_by
      WHERE m.tenant_id = :tenantId AND m.variant_id = :v ORDER BY m.id DESC LIMIT :limit`,
    { v: variantId, limit },
  );
  return rows.map((r) => ({
    id: Number(r.id), qty: r.qty, type: r.movement_type, refType: r.ref_type, refId: r.ref_id ? Number(r.ref_id) : null,
    reason: r.reason, date: r.movement_date, branch: r.branch, userName: r.user_name, createdAt: r.created_at,
  }));
}
