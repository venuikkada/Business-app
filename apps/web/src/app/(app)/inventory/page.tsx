import Link from "next/link";
import { products } from "@cba/server";
import { formatDateTimeIN } from "@cba/core";
import { tenantOrError } from "@/lib/session";
import { TransferForm } from "@/components/products/stock-forms";
import { branchesFor } from "@/components/products/load";
import { Badge, Card, CardHeader, EmptyState, ErrorPanel, LinkButton, Money, PageHeader, Table, Tabs, Td, Th } from "@/components/ui";

export const metadata = { title: "Stock" };

export default async function InventoryPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const tab = (await searchParams).tab ?? "low";
  const res = await tenantOrError(async (t) => {
    t.require("inventory.view");
    return {
      low: tab === "low" ? ((await products.lowStock(t, 200)) as Array<Record<string, string>>) : [],
      valuation: tab === "valuation" && t.can("financials.view") ? await products.stockValuation(t) : null,
      moves: tab === "movements" ? await t.db.query<Record<string, string>>(
        `select m.created_at, m.kind, m.quantity, m.reason, m.note, p.id as product_id, p.name, b.name as branch, u.full_name as by_name
           from stock_movements m join products p on p.id = m.product_id join branches b on b.id = m.branch_id left join users u on u.id = m.created_by
          order by m.created_at desc limit 200`,
      ) : [],
      branches: await branchesFor(t),
      transferProducts: tab === "transfer" ? await t.db.query<{ id: string; name: string }>("select id, name from products where track_inventory and archived_at is null order by lower(name) limit 2000") : [],
      can: { fin: t.can("financials.view"), multi: t.hasFeature("multi_branch"), create: t.can("inventory.create") && !t.isSupport },
    };
  });
  if (!res.ok) return <ErrorPanel code={res.code} message={res.message} />;
  const { low, valuation, moves, branches, transferProducts, can } = res.data;
  return (
    <>
      <PageHeader title="Stock" subtitle="Low stock, valuation, movements and branch transfers" actions={<LinkButton href="/documents/new?type=purchase_order" variant="secondary">Reorder (purchase order)</LinkButton>} />
      <Tabs
        active={tab}
        tabs={[
          { key: "low", label: "Low stock", href: "/inventory?tab=low" },
          ...(can.fin ? [{ key: "valuation", label: "Valuation", href: "/inventory?tab=valuation" }] : []),
          { key: "movements", label: "All movements", href: "/inventory?tab=movements" },
          ...(can.multi && can.create ? [{ key: "transfer", label: "Transfer between branches", href: "/inventory?tab=transfer" }] : []),
        ]}
      />
      {tab === "low" && (
        <Card>
          {low.length ? (
            <Table>
              <thead><tr><Th>Product</Th><Th>SKU</Th><Th align="right">In stock</Th><Th align="right">Alert level</Th></tr></thead>
              <tbody>
                {low.map((p) => (
                  <tr key={p.id}>
                    <Td><Link className="font-medium hover:text-brand-700" href={`/products/${p.id}`}>{p.name}</Link></Td>
                    <Td className="font-mono text-xs">{p.sku}</Td>
                    <Td align="right" className={Number(p.stock) <= 0 ? "font-semibold text-red-700" : "font-semibold text-amber-700"}>{Number(p.stock)} {p.unit}</Td>
                    <Td align="right">{Number(p.reorderLevel)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <EmptyState title="Nothing is running low" body="Set a low-stock alert level on products to get warnings here and in notifications." />
          )}
        </Card>
      )}
      {tab === "valuation" && valuation && (
        <Card>
          <CardHeader title="Stock valuation" subtitle="Quantity × weighted average purchase cost" action={<a className="text-sm text-brand-700" href="/api/v1/reports/stock-valuation?format=csv">CSV</a>} />
          <div className="grid grid-cols-2 gap-3 p-5">
            <div><div className="text-xs uppercase text-muted">At cost</div><div className="text-xl font-semibold"><Money value={valuation.totalValue} /></div></div>
            <div><div className="text-xs uppercase text-muted">At selling price</div><div className="text-xl font-semibold"><Money value={valuation.totalRetailValue} /></div></div>
          </div>
          <Table>
            <thead><tr><Th>Product</Th><Th>Category</Th><Th align="right">Qty</Th><Th align="right">Avg cost</Th><Th align="right">Value</Th></tr></thead>
            <tbody>
              {(valuation.items as Array<Record<string, string>>).map((v) => (
                <tr key={v.id}>
                  <Td><Link className="hover:text-brand-700" href={`/products/${v.id}`}>{v.name}</Link></Td>
                  <Td>{v.categoryName}</Td>
                  <Td align="right">{Number(v.quantity)} {v.unit}</Td>
                  <Td align="right"><Money value={v.avgCost} /></Td>
                  <Td align="right"><Money value={v.value} /></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
      {tab === "movements" && (
        <Card>
          <Table>
            <thead><tr><Th>When</Th><Th>Product</Th><Th>Type</Th><Th align="right">Qty</Th><Th>Branch</Th><Th>By</Th></tr></thead>
            <tbody>
              {moves.map((m, i) => (
                <tr key={i}>
                  <Td className="whitespace-nowrap text-xs">{formatDateTimeIN(m.created_at)}</Td>
                  <Td><Link className="hover:text-brand-700" href={`/products/${m.product_id}`}>{m.name}</Link></Td>
                  <Td><Badge color={Number(m.quantity) > 0 ? "green" : "orange"}>{m.kind!.replace("_", " ")}</Badge></Td>
                  <Td align="right">{Number(m.quantity) > 0 ? "+" : ""}{Number(m.quantity)}</Td>
                  <Td>{m.branch}</Td>
                  <Td className="text-xs text-muted">{m.by_name}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
      {tab === "transfer" && (
        <Card>
          <CardHeader title="Transfer stock" subtitle="Moves stock between your branches at average cost" />
          {branches.length < 2 ? <EmptyState title="Add a second branch first" action={<LinkButton href="/team?tab=branches">Manage branches</LinkButton>} /> : <TransferForm products={transferProducts} branches={branches} />}
        </Card>
      )}
    </>
  );
}
