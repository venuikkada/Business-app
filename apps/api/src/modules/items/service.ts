import { TenantDb, withTx } from "../../db/pool.js";
import type { TenantCtx } from "../../http/context.js";
import { badRequest, conflict, notFound } from "../../lib/errors.js";
import { audit } from "../audit/service.js";
import { applyMovement, defaultBranchId } from "../stock/service.js";

export interface ItemInput {
  name: string;
  itemType: "goods" | "service";
  unit: string;
  category?: string | null;
  hsn?: string | null;
  gstRate: number;
  priceIncludesTax: boolean;
  salePrice: number;
  purchasePrice?: number;
  mrp?: number | null;
  sku?: string | null;
  barcode?: string | null;
  lowStockQty?: number | null;
  openingStock?: number;
  branchId?: number;
  isActive?: boolean;
}

function out(ctx: TenantCtx, r: any) {
  const money = ctx.permissions.has("financials.view");
  return {
    id: Number(r.id), variantId: Number(r.variant_id), name: r.name, itemType: r.item_type, unit: r.unit, category: r.category ?? null,
    hsn: r.hsn_sac, gstRate: Number(r.gst_rate), priceIncludesTax: !!r.price_includes_tax, trackStock: !!r.track_stock,
    salePrice: r.sale_price, mrp: r.mrp, purchasePrice: money ? r.purchase_price : null, sku: r.sku, barcode: r.barcode,
    lowStockQty: r.low_stock_qty, qty: r.qty ?? "0", stockValue: money && r.stock_value != null ? r.stock_value : null,
    isLow: !!r.track_stock && r.low_stock_qty != null && Number(r.qty ?? 0) <= Number(r.low_stock_qty), isActive: !!r.is_active,
  };
}

const SELECT = (branchFilter: string) => `
  SELECT i.id, i.name, i.item_type, i.hsn_sac, i.gst_rate, i.price_includes_tax, i.track_stock, i.low_stock_qty, i.is_active,
         u.code AS unit, c.name AS category, v.id AS variant_id, v.sku, v.barcode, v.sale_price, v.mrp, v.purchase_price,
         (SELECT COALESCE(SUM(s.qty), 0) FROM stock_levels s WHERE s.tenant_id = i.tenant_id AND s.variant_id = v.id ${branchFilter}) AS qty,
         (SELECT COALESCE(SUM(s.qty * s.avg_cost), 0) FROM stock_levels s WHERE s.tenant_id = i.tenant_id AND s.variant_id = v.id ${branchFilter}) AS stock_value
    FROM items i
    JOIN item_variants v ON v.tenant_id = i.tenant_id AND v.item_id = i.id AND v.is_default = 1
    JOIN units u ON u.tenant_id = i.tenant_id AND u.id = i.unit_id
    LEFT JOIN item_categories c ON c.tenant_id = i.tenant_id AND c.id = i.category_id
   WHERE i.tenant_id = :tenantId AND i.deleted_at IS NULL`;

function branchSql(ctx: TenantCtx, branchId: number | undefined, p: Record<string, unknown>): string {
  if (branchId) {
    p.branchId = branchId;
    return "AND s.branch_id = :branchId";
  }
  if (ctx.branchIds) {
    p.branchIds = ctx.branchIds.length ? ctx.branchIds : [0];
    return "AND s.branch_id IN (:branchIds)";
  }
  return "";
}

export async function listItems(ctx: TenantCtx, q: { search?: string; branchId?: number; low?: boolean; stockOnly?: boolean; limit: number }) {
  const p: Record<string, unknown> = { limit: q.limit };
  let sql = SELECT(branchSql(ctx, q.branchId, p));
  if (q.search) {
    sql += " AND (i.name LIKE :like OR v.sku LIKE :like OR v.barcode = :exact OR i.hsn_sac = :exact)";
    p.like = `%${q.search.replace(/[%_\\]/g, "\\$&")}%`;
    p.exact = q.search;
  }
  if (q.stockOnly) sql += " AND i.track_stock = 1";
  sql += " ORDER BY i.is_active DESC, i.name LIMIT :limit";
  let rows = (await ctx.tdb.all(sql, p)).map((r) => out(ctx, r));
  if (q.low) rows = rows.filter((r) => r.isLow);
  return rows;
}

export async function getItem(ctx: TenantCtx, id: number) {
  const p: Record<string, unknown> = { id };
  const r = await ctx.tdb.one(SELECT(branchSql(ctx, undefined, p)) + " AND i.id = :id", p);
  if (!r) throw notFound("Item");
  return out(ctx, r);
}

async function unitId(tdb: TenantDb, code: string): Promise<number> {
  const u = await tdb.one("SELECT id FROM units WHERE tenant_id = :tenantId AND code = :code", { code });
  if (!u) throw badRequest("invalid_unit", "Choose a valid unit.");
  return Number(u.id);
}

async function categoryId(tdb: TenantDb, name?: string | null): Promise<number | null> {
  if (!name) return null;
  const c = await tdb.one("SELECT id FROM item_categories WHERE tenant_id = :tenantId AND parent_id IS NULL AND name = :name", { name });
  if (c) return Number(c.id);
  return (await tdb.exec("INSERT INTO item_categories (tenant_id, name) VALUES (:tenantId, :name)", { name })).insertId;
}

export async function createItem(ctx: TenantCtx, input: ItemInput) {
  const goods = input.itemType === "goods";
  const branchId = goods && input.openingStock ? await defaultBranchId(ctx, input.branchId) : null;
  const id = await withTx(async (conn) => {
    const tdb = new TenantDb(conn, ctx.tenantId);
    const r = await tdb.exec(
      `INSERT INTO items (tenant_id, item_type, name, category_id, unit_id, hsn_sac, gst_rate, price_includes_tax, track_stock, low_stock_qty, created_by)
       VALUES (:tenantId, :type, :name, :cat, :unit, :hsn, :gst, :incl, :track, :low, :by)`,
      {
        type: input.itemType, name: input.name, cat: await categoryId(tdb, input.category), unit: await unitId(tdb, input.unit),
        hsn: input.hsn || null, gst: input.gstRate, incl: input.priceIncludesTax ? 1 : 0, track: goods ? 1 : 0,
        low: goods ? (input.lowStockQty ?? null) : null, by: ctx.userId,
      },
    );
    const sku = input.sku || `ITM-${String(r.insertId).padStart(4, "0")}`;
    if (await tdb.one("SELECT id FROM item_variants WHERE tenant_id = :tenantId AND sku = :sku", { sku })) {
      throw conflict("sku_taken", "Another item already uses this SKU / item code.");
    }
    const v = await tdb.exec(
      `INSERT INTO item_variants (tenant_id, item_id, sku, barcode, sale_price, mrp, purchase_price, is_default)
       VALUES (:tenantId, :item, :sku, :barcode, :sale, :mrp, :cost, 1)`,
      { item: r.insertId, sku, barcode: input.barcode || null, sale: input.salePrice, mrp: input.mrp ?? null, cost: input.purchasePrice ?? 0 },
    );
    if (branchId && input.openingStock) {
      await applyMovement(tdb, {
        branchId, variantId: v.insertId, qty: input.openingStock, unitCost: input.purchasePrice ?? 0,
        type: "opening", refType: "item", refId: r.insertId, reason: "Opening stock", userId: ctx.userId,
      });
    }
    await audit(tdb, ctx, {
      action: "create", entityType: "item", entityId: r.insertId, summary: `Added item "${input.name}"`,
      after: { name: input.name, sku, sale_price: input.salePrice, gst_rate: input.gstRate, opening_stock: input.openingStock ?? 0 },
    });
    return r.insertId;
  });
  return getItem(ctx, id);
}

export async function updateItem(ctx: TenantCtx, id: number, input: Partial<ItemInput>) {
  await withTx(async (conn) => {
    const tdb = new TenantDb(conn, ctx.tenantId);
    const before = await tdb.one(
      `SELECT i.name, i.hsn_sac, i.gst_rate, i.price_includes_tax, i.low_stock_qty, i.is_active, i.unit_id, i.category_id,
              v.id AS variant_id, v.sku, v.barcode, v.sale_price, v.mrp, v.purchase_price
         FROM items i JOIN item_variants v ON v.tenant_id = i.tenant_id AND v.item_id = i.id AND v.is_default = 1
        WHERE i.tenant_id = :tenantId AND i.id = :id AND i.deleted_at IS NULL FOR UPDATE`,
      { id },
    );
    if (!before) throw notFound("Item");
    if (input.sku && input.sku !== before.sku && (await tdb.one("SELECT id FROM item_variants WHERE tenant_id = :tenantId AND sku = :sku", { sku: input.sku }))) {
      throw conflict("sku_taken", "Another item already uses this SKU / item code.");
    }
    const pick = <T>(v: T | undefined, old: T) => (v === undefined ? old : v);
    await tdb.exec(
      `UPDATE items SET name = :name, hsn_sac = :hsn, gst_rate = :gst, price_includes_tax = :incl, low_stock_qty = :low, is_active = :active,
              unit_id = :unit, category_id = :cat WHERE tenant_id = :tenantId AND id = :id`,
      {
        id, name: pick(input.name, before.name), hsn: pick(input.hsn, before.hsn_sac) || null, gst: pick(input.gstRate, before.gst_rate),
        incl: input.priceIncludesTax === undefined ? before.price_includes_tax : input.priceIncludesTax ? 1 : 0,
        low: pick(input.lowStockQty, before.low_stock_qty), active: input.isActive === undefined ? before.is_active : input.isActive ? 1 : 0,
        unit: input.unit ? await unitId(tdb, input.unit) : before.unit_id,
        cat: input.category === undefined ? before.category_id : await categoryId(tdb, input.category),
      },
    );
    await tdb.exec(
      "UPDATE item_variants SET sku = :sku, barcode = :barcode, sale_price = :sale, mrp = :mrp, purchase_price = :cost WHERE tenant_id = :tenantId AND id = :vid",
      {
        vid: before.variant_id, sku: input.sku || before.sku, barcode: pick(input.barcode, before.barcode) || null,
        sale: pick(input.salePrice, before.sale_price), mrp: pick(input.mrp, before.mrp), cost: pick(input.purchasePrice, before.purchase_price),
      },
    );
    const after = await tdb.one(
      `SELECT i.name, i.hsn_sac, i.gst_rate, i.price_includes_tax, i.low_stock_qty, i.is_active, v.sku, v.barcode, v.sale_price, v.mrp, v.purchase_price
         FROM items i JOIN item_variants v ON v.tenant_id = i.tenant_id AND v.item_id = i.id AND v.is_default = 1 WHERE i.tenant_id = :tenantId AND i.id = :id`,
      { id },
    );
    const { unit_id: _u, category_id: _c, variant_id: _v, ...b } = before;
    await audit(tdb, ctx, { action: "update", entityType: "item", entityId: id, summary: `Updated item "${after.name}"`, before: b, after });
  });
  return getItem(ctx, id);
}

export async function deleteItem(ctx: TenantCtx, id: number) {
  await withTx(async (conn) => {
    const tdb = new TenantDb(conn, ctx.tenantId);
    const it = await tdb.one("SELECT name FROM items WHERE tenant_id = :tenantId AND id = :id AND deleted_at IS NULL FOR UPDATE", { id });
    if (!it) throw notFound("Item");
    // Soft delete: old bills keep showing the item; the SKU is freed for re-use.
    await tdb.exec("UPDATE items SET deleted_at = CURRENT_TIMESTAMP(3), is_active = 0 WHERE tenant_id = :tenantId AND id = :id", { id });
    await tdb.exec("UPDATE item_variants SET sku = CONCAT(sku, '#del', id), barcode = NULL, is_active = 0 WHERE tenant_id = :tenantId AND item_id = :id", { id });
    await audit(tdb, ctx, { action: "delete", entityType: "item", entityId: id, summary: `Deleted item "${it.name}"`, before: { name: it.name } });
  });
}
