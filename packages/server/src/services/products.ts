import { randomUUID } from "node:crypto";
import { productSchema, categorySchema, stockAdjustmentSchema, stockTransferSchema, parseCSVObjects, toCSV, type ProductInput } from "@cba/core";
import type { z } from "zod";
import { assertLimit, resolveBranch, type Tenant } from "../context";
import { AppError, notFound } from "../errors";
import { camelize, likePattern, orderBy, parseList } from "../util";
import { moveStock, receiveSerials, issueSerials, currentAvgCost } from "./stock";
import { consumeApproval, canApprove, requireApproval } from "./approvals";
import type { ImportPreviewRow } from "./parties";

/** Cost prices and margins are hidden from roles without financials.view. */
function scrub(t: Tenant, r: Record<string, unknown>) {
  if (t.can("financials.view")) return r;
  const { cost_price, avg_cost, stock_value, costPrice, avgCost, stockValue, ...rest } = r;
  void cost_price; void avg_cost; void stock_value; void costPrice; void avgCost; void stockValue;
  return rest;
}

function branchFilter(t: Tenant, alias = "sl") {
  return t.branchIds ? `${alias}.branch_id = any('{${t.branchIds.join(",")}}'::uuid[])` : "true";
}

export async function listProducts(t: Tenant, query: unknown) {
  t.require("products.view");
  const q = parseList(query);
  const extra = (query ?? {}) as { categoryId?: string; lowStock?: string; type?: string };
  const where: string[] = [q.archived === "true" ? "p.archived_at is not null" : "p.archived_at is null"];
  const params: unknown[] = [];
  if (q.q) {
    params.push(likePattern(q.q));
    where.push(`(p.name ilike $${params.length} or p.sku ilike $${params.length} or p.barcode = $${params.length + 1} or p.brand ilike $${params.length})`);
    params.push(q.q);
  }
  if (extra.categoryId && /^[0-9a-f-]{36}$/.test(extra.categoryId)) {
    params.push(extra.categoryId);
    where.push(`p.category_id = $${params.length}`);
  }
  if (extra.type === "goods" || extra.type === "service") {
    params.push(extra.type);
    where.push(`p.type = $${params.length}`);
  }
  const having = extra.lowStock === "true" ? "and p.track_inventory and coalesce(s.qty, 0) <= p.reorder_level" : "";
  const order = orderBy(q.sort, { name: "lower(p.name)", stock: "s.qty", price: "p.selling_price", created: "p.created_at" }, "name", q.sort ? q.dir : "asc");
  const base = `from products p
     left join categories c on c.id = p.category_id
     left join (select product_id, sum(quantity) qty, sum(quantity * avg_cost) val from stock_levels sl where ${branchFilter(t)} group by product_id) s on s.product_id = p.id
    where ${where.join(" and ")} ${having}`;
  const { n } = await t.db.one<{ n: number }>(`select count(*)::int n ${base}`, params);
  params.push(q.pageSize, (q.page - 1) * q.pageSize);
  const rows = await t.db.query<Record<string, unknown>>(
    `select p.id, p.name, p.sku, p.barcode, p.type, p.unit, p.brand, p.hsn_code, p.selling_price, p.cost_price, p.mrp, p.tax_rate,
            p.prices_include_tax, p.track_inventory, p.track_serials, p.reorder_level, p.archived_at, p.parent_product_id, p.variant_attributes,
            c.name as category_name, coalesce(s.qty, 0) as stock, coalesce(s.val, 0) as stock_value,
            (p.track_inventory and coalesce(s.qty, 0) <= p.reorder_level) as low_stock
     ${base} order by ${order} limit $${params.length - 1} offset $${params.length}`,
    params,
  );
  return { items: rows.map((r) => camelize(scrub(t, r))), total: n, page: q.page, pageSize: q.pageSize };
}

export async function getProduct(t: Tenant, id: string) {
  t.require("products.view");
  const p = await t.db.maybe<Record<string, unknown>>(
    `select p.*, c.name as category_name, pp.name as parent_name from products p
       left join categories c on c.id = p.category_id left join products pp on pp.id = p.parent_product_id where p.id = $1`,
    [id],
  );
  if (!p) throw notFound("Product");
  const stock = await t.db.query(
    `select b.id as branch_id, b.name as branch_name, coalesce(sl.quantity, 0) as quantity, coalesce(sl.avg_cost, 0) as avg_cost
       from branches b left join stock_levels sl on sl.branch_id = b.id and sl.product_id = $1
      where b.archived_at is null and ${t.branchIds ? `b.id = any('{${t.branchIds.join(",")}}'::uuid[])` : "true"} order by b.is_default desc, b.name`,
    [id],
  );
  const variants = await t.db.query("select id, name, sku, variant_attributes, selling_price from products where parent_product_id = $1 and archived_at is null order by name", [id]);
  const serials = p.track_serials
    ? await t.db.query("select serial_number, status, branch_id, warranty_until, sold_on from product_serials where product_id = $1 order by status, serial_number limit 500", [id])
    : [];
  type Obj = Record<string, unknown>;
  return {
    ...camelize<Obj>(scrub(t, p)),
    stock: camelize<Obj>(stock).map((s) => scrub(t, s)),
    variants: camelize(variants),
    serials: camelize(serials),
  } as Obj & { stock: Obj[]; variants: Obj[]; serials: Obj[] };
}

export async function productMovements(t: Tenant, id: string, limit = 100) {
  t.require("inventory.view");
  const rows = await t.db.query<Record<string, unknown>>(
    `select m.id, m.created_at, m.kind, m.reason, m.quantity, m.unit_cost, m.balance_after, m.note, m.source_type, m.source_id,
            b.name as branch_name, u.full_name as created_by_name, d.number as document_number, d.doc_type
       from stock_movements m join branches b on b.id = m.branch_id left join users u on u.id = m.created_by
       left join documents d on d.id = m.source_id and m.source_type = 'document'
      where m.product_id = $1 and ${branchFilter(t, "m")} order by m.created_at desc limit $2`,
    [id, Math.min(limit, 500)],
  );
  return rows.map((r) => camelize(t.can("financials.view") ? r : { ...r, unit_cost: undefined }));
}

export async function findByBarcode(t: Tenant, code: string) {
  t.require("products.view");
  const r = await t.db.maybe<Record<string, unknown>>(
    `select p.id from products p where p.archived_at is null and (p.barcode = $1 or lower(p.sku) = lower($1)) limit 1`,
    [code.trim()],
  );
  if (r) return getProduct(t, r.id as string);
  const s = await t.db.maybe<{ product_id: string }>("select product_id from product_serials where serial_number = upper($1) limit 1", [code.trim()]);
  if (s) return { ...(await getProduct(t, s.product_id)), matchedSerial: code.trim().toUpperCase() } as Awaited<ReturnType<typeof getProduct>>;
  throw notFound("Product with this barcode");
}

function normalize(t: Tenant, d: ProductInput): ProductInput {
  const x = { ...d };
  if (x.type === "service") {
    x.trackInventory = false;
    x.trackSerials = false;
  }
  // Stock tracking is a plan feature; without it products are price-list only.
  if (!t.hasFeature("inventory")) {
    x.trackInventory = false;
    x.trackSerials = false;
  }
  if (x.trackSerials) x.trackInventory = true;
  return x;
}

export async function createProduct(t: Tenant, input: z.input<typeof productSchema> & { openingSerials?: string[] }) {
  t.require("products.create");
  const d = normalize(t, productSchema.parse(input));
  if (!t.can("financials.view") && Number(d.costPrice) > 0) {
    // Salespeople cannot set cost prices they are not allowed to see.
    d.costPrice = "0";
  }
  await assertLimit(t, "products", "select count(*)::int n from products where archived_at is null");
  if (d.parentProductId) {
    const parent = await t.db.maybe<{ parent_product_id: string | null }>("select parent_product_id from products where id = $1", [d.parentProductId]);
    if (!parent) throw new AppError("VALIDATION", "Parent product not found");
    if (parent.parent_product_id) throw new AppError("VALIDATION", "Variants cannot have their own variants");
  }
  const r = await t.db.one<Record<string, unknown>>(
    `insert into products(business_id, name, type, sku, barcode, category_id, brand, unit, hsn_code, description, cost_price, selling_price, mrp,
       tax_rate, prices_include_tax, track_inventory, track_serials, reorder_level, warranty_months, parent_product_id, variant_attributes, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) returning *`,
    [
      t.businessId, d.name, d.type, d.sku, d.barcode, d.categoryId ?? null, d.brand, d.unit, d.hsnCode, d.description, d.costPrice, d.sellingPrice,
      d.mrp ?? null, d.taxRate, d.pricesIncludeTax, d.trackInventory, d.trackSerials, d.reorderLevel, d.warrantyMonths ?? null,
      d.parentProductId ?? null, d.variantAttributes ? JSON.stringify(d.variantAttributes) : null, t.userId,
    ],
  );
  if (d.trackInventory && d.openingStock && Number(d.openingStock) > 0) {
    t.require("inventory.create");
    const branchId = await resolveBranch(t, d.openingStockBranchId);
    if (d.trackSerials) {
      await receiveSerials(t, { productId: r.id as string, productName: d.name, branchId, serials: input.openingSerials ?? [], quantity: d.openingStock });
    }
    await moveStock(t, { productId: r.id as string, branchId, quantity: d.openingStock, kind: "opening", unitCost: d.costPrice, note: "Opening stock" });
  }
  await t.audit("product.create", "product", r.id as string, `Created ${d.name}`, undefined, d);
  return getProduct(t, r.id as string);
}

export async function updateProduct(t: Tenant, id: string, input: z.input<typeof productSchema>) {
  t.require("products.edit");
  const d = normalize(t, productSchema.parse(input));
  const before = await t.db.maybe<Record<string, unknown>>("select * from products where id = $1 for update", [id]);
  if (!before) throw notFound("Product");
  if (!t.can("financials.view")) d.costPrice = before.cost_price as string;
  if (before.track_inventory && !d.trackInventory) {
    const s = await t.db.one<{ q: string }>("select coalesce(sum(quantity), 0) q from stock_levels where product_id = $1", [id]);
    if (Number(s.q) !== 0) throw new AppError("BUSINESS_RULE", "Stock tracking can only be turned off when stock is zero");
  }
  if (!before.track_serials && d.trackSerials) {
    const s = await t.db.one<{ q: string }>("select coalesce(sum(quantity), 0) q from stock_levels where product_id = $1", [id]);
    if (Number(s.q) !== 0) throw new AppError("BUSINESS_RULE", "Serial tracking can only be turned on when stock is zero");
  }
  if (d.parentProductId === id) throw new AppError("VALIDATION", "A product cannot be its own variant");
  await t.db.exec(
    `update products set name=$2, type=$3, sku=$4, barcode=$5, category_id=$6, brand=$7, unit=$8, hsn_code=$9, description=$10, cost_price=$11,
       selling_price=$12, mrp=$13, tax_rate=$14, prices_include_tax=$15, track_inventory=$16, track_serials=$17, reorder_level=$18,
       warranty_months=$19, parent_product_id=$20, variant_attributes=$21 where id=$1`,
    [
      id, d.name, d.type, d.sku, d.barcode, d.categoryId ?? null, d.brand, d.unit, d.hsnCode, d.description, d.costPrice, d.sellingPrice,
      d.mrp ?? null, d.taxRate, d.pricesIncludeTax, d.trackInventory, d.trackSerials, d.reorderLevel, d.warrantyMonths ?? null,
      d.parentProductId ?? null, d.variantAttributes ? JSON.stringify(d.variantAttributes) : null,
    ],
  );
  await t.audit("product.update", "product", id, `Updated ${d.name}`, scrub(t, before), d);
  return getProduct(t, id);
}

export async function setProductArchived(t: Tenant, id: string, archived: boolean) {
  t.require("products.delete");
  const n = await t.db.exec(`update products set archived_at = ${archived ? "now()" : "null"} where id = $1`, [id]);
  if (!n) throw notFound("Product");
  await t.audit(archived ? "product.archive" : "product.unarchive", "product", id);
}

// ------------------------------------------------------------- categories
export async function listCategories(t: Tenant) {
  t.require("products.view");
  return camelize(await t.db.query("select c.*, (select count(*)::int from products p where p.category_id = c.id and p.archived_at is null) as product_count from categories c order by lower(c.name)"));
}
export async function createCategory(t: Tenant, input: z.input<typeof categorySchema>) {
  t.require("products.create");
  const d = categorySchema.parse(input);
  return camelize(await t.db.one("insert into categories(business_id, name, parent_id) values ($1,$2,$3) returning *", [t.businessId, d.name, d.parentId ?? null]));
}
export async function renameCategory(t: Tenant, id: string, name: string) {
  t.require("products.edit");
  const d = categorySchema.parse({ name });
  const n = await t.db.exec("update categories set name = $2 where id = $1", [id, d.name]);
  if (!n) throw notFound("Category");
}
export async function deleteCategory(t: Tenant, id: string) {
  t.require("products.delete");
  await t.db.exec("update products set category_id = null where category_id = $1", [id]);
  await t.db.exec("update categories set parent_id = null where parent_id = $1", [id]);
  const n = await t.db.exec("delete from categories where id = $1", [id]);
  if (!n) throw notFound("Category");
}

// ------------------------------------------------------- stock operations
export async function adjustStock(t: Tenant, input: z.input<typeof stockAdjustmentSchema> & { allowNegative?: boolean }) {
  t.require("inventory.create");
  t.requireFeature("inventory");
  const d = stockAdjustmentSchema.parse(input);
  const branchId = await resolveBranch(t, d.branchId);
  const p = await t.db.maybe<{ name: string; track_inventory: boolean; track_serials: boolean; cost_price: string }>(
    "select name, track_inventory, track_serials, cost_price from products where id = $1",
    [d.productId],
  );
  if (!p) throw notFound("Product");
  if (!p.track_inventory) throw new AppError("BUSINESS_RULE", `${p.name} does not track stock. Turn on stock tracking first.`);

  const payload = { productId: d.productId, branchId, quantityDelta: d.quantityDelta };
  const threshold = t.settings.stockAdjustmentApprovalQty;
  let approvalId: string | null = null;
  if (threshold !== null && Math.abs(Number(d.quantityDelta)) > threshold && !canApprove(t, "stock_adjustment")) {
    if (!d.approvalId) {
      await requireApproval(t, "stock_adjustment", "product", d.productId, payload, `Stock adjustment of ${d.quantityDelta} for ${p.name}`);
    }
    await consumeApproval(t, d.approvalId!, "stock_adjustment", d.productId, payload);
    approvalId = d.approvalId!;
  }

  // Negative stock override: only for approvers, always audited.
  let allowNegative = false;
  if (input.allowNegative) {
    if (!canApprove(t, "negative_stock")) throw new AppError("FORBIDDEN", "Only an owner or manager can allow negative stock");
    allowNegative = true;
  }

  const qty = Number(d.quantityDelta);
  if (p.track_serials) {
    if (qty > 0) await receiveSerials(t, { productId: d.productId, productName: p.name, branchId, serials: d.serialNumbers ?? [], quantity: qty });
    else await issueSerials(t, { productId: d.productId, productName: p.name, branchId, serials: d.serialNumbers ?? [], quantity: -qty, status: "defective" });
  }
  const unitCost = qty > 0 ? (d.unitCost ?? (await currentAvgCost(t, d.productId, branchId))) : await currentAvgCost(t, d.productId, branchId);
  const m = await moveStock(t, {
    productId: d.productId, branchId, quantity: d.quantityDelta, kind: d.reason === "opening" ? "opening" : "adjustment",
    unitCost, reason: d.reason, note: d.note, allowNegative, approvalId,
  });
  await t.audit("stock.adjust", "product", d.productId, `${p.name}: ${qty > 0 ? "+" : ""}${d.quantityDelta} (${d.reason})${allowNegative ? " [negative stock override]" : ""}`, undefined, { ...d, movementId: m.id });
  return { movementId: m.id, balanceAfter: m.balance_after };
}

export async function transferStock(t: Tenant, input: z.input<typeof stockTransferSchema> & { serialNumbers?: string[] }) {
  t.require("inventory.create");
  t.requireFeature("multi_branch");
  const d = stockTransferSchema.parse(input);
  const from = await resolveBranch(t, d.fromBranchId);
  const to = await resolveBranch(t, d.toBranchId);
  const p = await t.db.maybe<{ name: string; track_inventory: boolean; track_serials: boolean }>("select name, track_inventory, track_serials from products where id = $1", [d.productId]);
  if (!p) throw notFound("Product");
  if (!p.track_inventory) throw new AppError("BUSINESS_RULE", `${p.name} does not track stock`);
  const group = randomUUID();
  const cost = await currentAvgCost(t, d.productId, from);
  if (p.track_serials) {
    const serials = (input.serialNumbers ?? []).map((s) => s.trim().toUpperCase());
    if (serials.length !== Number(d.quantity)) throw new AppError("VALIDATION", `Enter exactly ${d.quantity} serial number(s)`);
    for (const sn of serials) {
      const n = await t.db.exec("update product_serials set branch_id = $3 where product_id = $1 and serial_number = $2 and branch_id = $4 and status = 'in_stock'", [d.productId, sn, to, from]);
      if (!n) throw new AppError("BUSINESS_RULE", `Serial ${sn} is not in stock at the source branch`);
    }
  }
  await moveStock(t, { productId: d.productId, branchId: from, quantity: `-${d.quantity}`, kind: "transfer_out", unitCost: cost, transferGroup: group, note: d.note });
  await moveStock(t, { productId: d.productId, branchId: to, quantity: d.quantity, kind: "transfer_in", unitCost: cost, transferGroup: group, note: d.note });
  await t.audit("stock.transfer", "product", d.productId, `${p.name}: ${d.quantity} moved between branches`, undefined, d);
  return { transferGroup: group };
}

export async function lowStock(t: Tenant, limit = 50) {
  t.require("inventory.view");
  return camelize(
    await t.db.query(
      `select p.id, p.name, p.sku, p.unit, p.reorder_level, coalesce(sum(sl.quantity), 0) as stock
         from products p left join stock_levels sl on sl.product_id = p.id and ${branchFilter(t)}
        where p.archived_at is null and p.track_inventory
        group by p.id having coalesce(sum(sl.quantity), 0) <= p.reorder_level
        order by coalesce(sum(sl.quantity), 0) - p.reorder_level limit $1`,
      [limit],
    ),
  );
}

export async function stockValuation(t: Tenant) {
  t.require("inventory.view");
  t.require("financials.view");
  const rows = await t.db.query(
    `select p.id, p.name, p.sku, p.unit, c.name as category_name, sum(sl.quantity) as quantity,
            case when sum(sl.quantity) > 0 then round(sum(sl.quantity * sl.avg_cost) / sum(sl.quantity), 2) else 0 end as avg_cost,
            round(sum(sl.quantity * sl.avg_cost), 2) as value, round(sum(sl.quantity) * p.selling_price, 2) as retail_value
       from stock_levels sl join products p on p.id = sl.product_id left join categories c on c.id = p.category_id
      where ${branchFilter(t)} group by p.id, c.name having sum(sl.quantity) <> 0 order by value desc`,
  );
  const totals = rows.reduce<{ value: number; retail: number }>((a, r) => ({ value: a.value + Number(r.value), retail: a.retail + Number(r.retail_value) }), { value: 0, retail: 0 });
  return { items: camelize(rows), totalValue: totals.value.toFixed(2), totalRetailValue: totals.retail.toFixed(2) };
}

// ------------------------------------------------------------- import/export
export const PRODUCT_CSV_HEADERS = ["name", "type", "sku", "barcode", "category", "brand", "unit", "hsn_code", "cost_price", "selling_price", "mrp", "gst_rate", "prices_include_tax", "track_inventory", "reorder_level", "opening_stock", "warranty_months"];

function productFromCsv(r: Record<string, string>) {
  const yes = (v?: string) => ["yes", "y", "true", "1"].includes((v ?? "").toLowerCase());
  return {
    name: r.name ?? "",
    type: (r.type || "goods").toLowerCase() === "service" ? "service" : "goods",
    sku: r.sku || null,
    barcode: r.barcode || null,
    brand: r.brand || null,
    unit: r.unit || "pcs",
    hsnCode: r.hsn_code || null,
    costPrice: r.cost_price || "0",
    sellingPrice: r.selling_price || "0",
    mrp: r.mrp || null,
    taxRate: r.gst_rate === undefined || r.gst_rate === "" ? 18 : r.gst_rate,
    pricesIncludeTax: yes(r.prices_include_tax),
    trackInventory: r.track_inventory === undefined || r.track_inventory === "" ? true : yes(r.track_inventory),
    reorderLevel: r.reorder_level || "0",
    openingStock: r.opening_stock || null,
    warrantyMonths: r.warranty_months ? Number(r.warranty_months) : null,
  };
}

export async function previewProductImport(t: Tenant, csv: string) {
  t.require("products.create");
  t.require("data.create");
  const { headers, rows } = parseCSVObjects(csv);
  if (!headers.includes("name")) throw new AppError("VALIDATION", "The CSV must have a 'name' column. Download the template to get started.");
  if (rows.length > 5000) throw new AppError("VALIDATION", "Import at most 5,000 rows at a time");
  const skus = new Set<string>();
  const out: ImportPreviewRow<ProductInput & { category?: string | null }>[] = [];
  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i]!;
    const parsed = productSchema.safeParse(productFromCsv(raw));
    const errors = parsed.success ? [] : parsed.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`);
    const warnings: string[] = [];
    if (parsed.success && parsed.data.sku) {
      const key = parsed.data.sku.toLowerCase();
      if (skus.has(key)) errors.push("sku: repeats in this file");
      skus.add(key);
      const ex = await t.db.maybe("select 1 from products where lower(sku) = $1", [key]);
      if (ex) errors.push("sku: already used by an existing product");
    }
    if (parsed.success && parsed.data.barcode) {
      const ex = await t.db.maybe("select 1 from products where barcode = $1", [parsed.data.barcode]);
      if (ex) errors.push("barcode: already used by an existing product");
    }
    if (parsed.success && parsed.data.openingStock && Number(parsed.data.openingStock) < 0) errors.push("opening_stock: cannot be negative");
    if (parsed.success && !t.hasFeature("inventory") && parsed.data.openingStock) warnings.push("Opening stock ignored: stock tracking is not in your plan");
    out.push({ row: i + 2, data: parsed.success ? { ...parsed.data, category: raw.category || null } : null, errors, warnings });
  }
  return { rows: out, valid: out.filter((r) => !r.errors.length).length, invalid: out.filter((r) => r.errors.length).length };
}

export async function commitProductImport(t: Tenant, csv: string) {
  const preview = await previewProductImport(t, csv);
  if (preview.invalid > 0) throw new AppError("VALIDATION", `${preview.invalid} row(s) have errors. Fix them and preview again.`);
  const limit = t.plan.limits?.products;
  if (limit !== null && limit !== undefined) {
    const { n } = await t.db.one<{ n: number }>("select count(*)::int n from products where archived_at is null");
    if (n + preview.rows.length > limit) throw new AppError("PLAN_LIMIT", `This import would exceed your plan limit of ${limit} products.`);
  }
  const cats = new Map<string, string>();
  for (const r of preview.rows) {
    const d = r.data!;
    let categoryId: string | null = null;
    if (d.category) {
      const key = d.category.toLowerCase();
      categoryId = cats.get(key) ?? null;
      if (!categoryId) {
        const c = await t.db.one<{ id: string }>(
          `insert into categories(business_id, name) values ($1, $2)
           on conflict (business_id, lower(name)) do update set name = categories.name returning id`,
          [t.businessId, d.category],
        );
        categoryId = c.id;
        cats.set(key, categoryId);
      }
    }
    const nd = normalize(t, { ...d, categoryId });
    const p = await t.db.one<{ id: string }>(
      `insert into products(business_id, name, type, sku, barcode, category_id, brand, unit, hsn_code, cost_price, selling_price, mrp, tax_rate,
         prices_include_tax, track_inventory, track_serials, reorder_level, warranty_months, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,false,$16,$17,$18) returning id`,
      [t.businessId, nd.name, nd.type, nd.sku, nd.barcode, categoryId, nd.brand, nd.unit, nd.hsnCode, nd.costPrice, nd.sellingPrice, nd.mrp ?? null, nd.taxRate,
        nd.pricesIncludeTax, nd.trackInventory, nd.reorderLevel, nd.warrantyMonths ?? null, t.userId],
    );
    if (nd.trackInventory && nd.openingStock && Number(nd.openingStock) > 0) {
      await moveStock(t, { productId: p.id, branchId: t.defaultBranchId, quantity: nd.openingStock, kind: "opening", unitCost: nd.costPrice, note: "Opening stock (import)" });
    }
  }
  await t.audit("product.import", "product", null, `Imported ${preview.rows.length} products`);
  return { imported: preview.rows.length };
}

export async function exportProductsCSV(t: Tenant) {
  t.require("products.export");
  const fin = t.can("financials.view");
  const rows = await t.db.query<Record<string, unknown>>(
    `select p.*, c.name as category_name, coalesce((select sum(quantity) from stock_levels sl where sl.product_id = p.id), 0) as stock
       from products p left join categories c on c.id = p.category_id order by lower(p.name)`,
  );
  await t.audit("product.export", "product", null, `Exported ${rows.length} products`);
  const headers = PRODUCT_CSV_HEADERS.filter((h) => fin || h !== "cost_price").map((h) => (h === "opening_stock" ? "current_stock" : h));
  return toCSV(
    headers,
    rows.map((r) =>
      [
        r.name, r.type, r.sku, r.barcode, r.category_name, r.brand, r.unit, r.hsn_code, ...(fin ? [r.cost_price] : []), r.selling_price, r.mrp, r.tax_rate,
        r.prices_include_tax ? "yes" : "no", r.track_inventory ? "yes" : "no", r.reorder_level, r.stock, r.warranty_months,
      ],
    ),
  );
}
