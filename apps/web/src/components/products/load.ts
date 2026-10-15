import "server-only";
import { products, team, type Tenant } from "@cba/server";

export async function productFormContext(t: Tenant, excludeId?: string) {
  const parents = await t.db.query<{ id: string; name: string }>("select id, name from products where parent_product_id is null and archived_at is null and type = 'goods' and id is distinct from $1 order by lower(name) limit 500", [excludeId ?? null]);
  return {
    categories: (await products.listCategories(t)) as Array<{ id: string; name: string }>,
    canSeeCost: t.can("financials.view"),
    hasInventory: t.hasFeature("inventory"),
    parents,
  };
}

export async function branchesFor(t: Tenant) {
  const all = (await team.listBranches(t)) as Array<{ id: string; name: string; archivedAt: string | null }>;
  return all.filter((b) => !b.archivedAt && (!t.branchIds || t.branchIds.includes(b.id))).map((b) => ({ id: b.id, name: b.name }));
}
