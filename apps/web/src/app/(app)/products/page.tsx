import Link from "next/link";
import { products } from "@cba/server";
import { tenantOrError } from "@/lib/session";
import { qs } from "@/lib/fmt";
import { Badge, Card, EmptyState, ErrorPanel, LinkButton, Money, PageHeader, Pagination, SearchForm, Select, Table, Tabs, Td, Th } from "@/components/ui";

export const metadata = { title: "Products" };

export default async function ProductsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const res = await tenantOrError(async (t) => ({
    list: await products.listProducts(t, { q: sp.q, page: sp.page, categoryId: sp.categoryId, lowStock: sp.lowStock, archived: sp.archived, type: sp.type, sort: sp.sort, dir: sp.dir }),
    categories: (await products.listCategories(t)) as Array<{ id: string; name: string }>,
    can: { create: t.can("products.create") && !t.isSupport, export: t.can("products.export"), fin: t.can("financials.view") },
  }));
  if (!res.ok) return <ErrorPanel code={res.code} message={res.message} />;
  const { list, categories, can } = res.data;
  const keep = { q: sp.q, categoryId: sp.categoryId };
  return (
    <>
      <PageHeader
        title="Products & services"
        subtitle={`${list.total} items`}
        actions={
          <>
            {can.export && <a href="/api/v1/products/export" className="text-sm font-medium text-brand-700 hover:underline">Export CSV</a>}
            {can.create && <LinkButton href="/products/import" variant="secondary">Import</LinkButton>}
            {can.create && <LinkButton href="/products/new">Add product</LinkButton>}
          </>
        }
      />
      <Tabs
        active={sp.archived === "true" ? "archived" : sp.lowStock === "true" ? "low" : sp.type ?? ""}
        tabs={[
          { key: "", label: "All", href: `/products${qs(keep)}` },
          { key: "goods", label: "Goods", href: `/products${qs({ ...keep, type: "goods" })}` },
          { key: "service", label: "Services", href: `/products${qs({ ...keep, type: "service" })}` },
          { key: "low", label: "Low stock", href: `/products${qs({ ...keep, lowStock: "true" })}` },
          { key: "archived", label: "Archived", href: `/products${qs({ ...keep, archived: "true" })}` },
        ]}
      />
      <Card>
        <SearchForm action="/products" q={sp.q} placeholder="Name, SKU, barcode or brand">
          <Select name="categoryId" defaultValue={sp.categoryId ?? ""} className="sm:w-48" aria-label="Category">
            <option value="">All categories</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </SearchForm>
        {list.items.length === 0 ? (
          <EmptyState icon={<span>📦</span>} title={sp.q ? "No matches" : "No products yet"} body={sp.q ? undefined : "Add products with prices and GST rates, or import your price list from Excel."} action={can.create && !sp.q ? <LinkButton href="/products/new">Add product</LinkButton> : undefined} />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Product</Th>
                  <Th>SKU</Th>
                  <Th align="right">Price</Th>
                  {can.fin && <Th align="right">Cost</Th>}
                  <Th align="right">GST</Th>
                  <Th align="right">Stock</Th>
                </tr>
              </thead>
              <tbody>
                {list.items.map((p) => (
                  <tr key={p.id as string} className="hover:bg-stone-50">
                    <Td>
                      <Link href={`/products/${p.id}`} className="font-medium hover:text-brand-700">{p.name as string}</Link>
                      <div className="mt-0.5 flex gap-1 text-xs text-muted">
                        {p.categoryName ? <span>{p.categoryName as string}</span> : null}
                        {p.type === "service" ? <Badge color="violet">Service</Badge> : null}
                        {p.trackSerials ? <Badge color="blue">Serials</Badge> : null}
                      </div>
                    </Td>
                    <Td className="font-mono text-xs">{(p.sku as string) ?? ""}</Td>
                    <Td align="right"><Money value={p.sellingPrice as string} /></Td>
                    {can.fin && <Td align="right"><Money value={p.costPrice as string} className="text-muted" /></Td>}
                    <Td align="right">{Number(p.taxRate)}%</Td>
                    <Td align="right">
                      {p.trackInventory ? (
                        <span className={p.lowStock ? (Number(p.stock) <= 0 ? "font-semibold text-red-700" : "font-semibold text-amber-700") : ""}>{Number(p.stock)} {p.unit as string}</span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={list.page} pageSize={list.pageSize} total={list.total} hrefFor={(p) => `/products${qs({ ...keep, lowStock: sp.lowStock, archived: sp.archived, type: sp.type, page: p })}`} />
          </>
        )}
      </Card>
    </>
  );
}
