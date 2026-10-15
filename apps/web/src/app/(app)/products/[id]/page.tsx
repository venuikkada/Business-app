import Link from "next/link";
import { products } from "@cba/server";
import { formatDateIN, formatDateTimeIN, DOC_TYPE_META, type DocType } from "@cba/core";
import { tenantOrError } from "@/lib/session";
import { ActionButton } from "@/components/client";
import { AdjustStockButton } from "@/components/products/stock-forms";
import { branchesFor } from "@/components/products/load";
import { Badge, Card, CardHeader, DefinitionList, ErrorPanel, LinkButton, Money, PageHeader, Stat, StatusBadge, Table, Td, Th } from "@/components/ui";

export const metadata = { title: "Product" };

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await tenantOrError(async (t) => ({
    p: await products.getProduct(t, id),
    moves: t.can("inventory.view") ? ((await products.productMovements(t, id, 50)) as Array<Record<string, string>>) : [],
    branches: await branchesFor(t),
    can: { edit: t.can("products.edit") && !t.isSupport, del: t.can("products.delete") && !t.isSupport, adjust: t.can("inventory.create") && t.hasFeature("inventory") && !t.isSupport, approve: t.can("inventory.approve"), fin: t.can("financials.view") },
  }));
  if (!res.ok) return <ErrorPanel code={res.code} message={res.message} />;
  const { p, moves, branches, can } = res.data;
  const stock = p.stock as Array<{ branchId: string; branchName: string; quantity: string; avgCost?: string }>;
  const total = stock.reduce((a, s) => a + Number(s.quantity), 0);
  const serials = p.serials as Array<Record<string, string>>;
  return (
    <>
      <PageHeader
        back={{ href: "/products", label: "Products" }}
        title={<span className="flex flex-wrap items-center gap-2">{p.name as string} {p.archivedAt ? <Badge>Archived</Badge> : null}</span>}
        subtitle={[p.sku, p.brand, p.categoryName, p.hsnCode ? `HSN ${p.hsnCode}` : null].filter(Boolean).join(" · ")}
        actions={
          <>
            {can.adjust && !!p.trackInventory && <AdjustStockButton productId={id} productName={p.name as string} branches={branches} trackSerials={!!p.trackSerials} canApprove={can.approve} />}
            {can.edit && <LinkButton href={`/products/${id}/edit`} variant="secondary">Edit</LinkButton>}
            {can.del && <ActionButton path={`products/${id}/${p.archivedAt ? "unarchive" : "archive"}`} variant="ghost" success={p.archivedAt ? "Restored" : "Archived"}>{p.archivedAt ? "Unarchive" : "Archive"}</ActionButton>}
          </>
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Selling price" value={<Money value={p.sellingPrice as string} />} hint={`GST ${Number(p.taxRate)}% ${p.pricesIncludeTax ? "included" : "extra"}`} />
        {can.fin && <Stat label="Cost price" value={<Money value={p.costPrice as string} />} hint={Number(p.sellingPrice) ? `Margin ${(((Number(p.sellingPrice) - Number(p.costPrice)) / Number(p.sellingPrice)) * 100).toFixed(1)}%` : undefined} />}
        {p.trackInventory ? <Stat label="In stock" value={`${total} ${p.unit as string}`} tone={total <= Number(p.reorderLevel) ? "bad" : "default"} hint={`Alert at ${Number(p.reorderLevel)}`} /> : <Stat label="Stock" value="Not tracked" />}
        {p.warrantyMonths ? <Stat label="Warranty" value={`${p.warrantyMonths} months`} /> : null}
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {!!p.trackInventory && (
            <Card>
              <CardHeader title="Stock movements" subtitle="Every change to stock is recorded and cannot be edited" />
              {moves.length ? (
                <Table>
                  <thead><tr><Th>When</Th><Th>Type</Th><Th>Reference</Th><Th align="right">Qty</Th><Th align="right">Balance</Th></tr></thead>
                  <tbody>
                    {moves.map((m) => (
                      <tr key={m.id}>
                        <Td className="whitespace-nowrap text-xs">{formatDateTimeIN(m.createdAt)}<div className="text-muted">{m.createdByName}</div></Td>
                        <Td><Badge color={Number(m.quantity) > 0 ? "green" : "orange"}>{m.kind!.replace("_", " ")}</Badge>{m.reason && <span className="ml-1 text-xs text-muted">{m.reason.replace("_", " ")}</span>}</Td>
                        <Td className="text-sm">{m.documentNumber ? <Link className="text-brand-700" href={`/documents/${m.docType}/${m.sourceId}`}>{DOC_TYPE_META[m.docType as DocType]?.label} {m.documentNumber}</Link> : m.note ?? ""}{branches.length > 1 && <div className="text-xs text-muted">{m.branchName}</div>}</Td>
                        <Td align="right" className={Number(m.quantity) > 0 ? "text-emerald-700" : ""}>{Number(m.quantity) > 0 ? "+" : ""}{Number(m.quantity)}</Td>
                        <Td align="right">{m.balanceAfter !== null ? Number(m.balanceAfter) : ""}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              ) : (
                <p className="p-5 text-sm text-muted">No stock movements yet.</p>
              )}
            </Card>
          )}
          {!!p.trackSerials && (
            <Card>
              <CardHeader title="Serial numbers" subtitle={`${serials.filter((s) => s.status === "in_stock").length} in stock`} />
              <Table>
                <thead><tr><Th>Serial</Th><Th>Status</Th><Th>Sold on</Th><Th>Warranty until</Th></tr></thead>
                <tbody>
                  {serials.map((s) => (
                    <tr key={s.serialNumber}>
                      <Td className="font-mono text-xs">{s.serialNumber}</Td>
                      <Td><StatusBadge status={s.status === "in_stock" ? "active" : s.status!} /></Td>
                      <Td>{formatDateIN(s.soldOn)}</Td>
                      <Td>{formatDateIN(s.warrantyUntil)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          )}
        </div>
        <div className="space-y-5">
          {!!p.trackInventory && (
            <Card>
              <CardHeader title="Stock by branch" />
              <ul className="divide-y divide-line text-sm">
                {stock.map((s) => (
                  <li key={s.branchId} className="flex justify-between px-5 py-2.5">
                    <span>{s.branchName}</span>
                    <span className="font-medium">{Number(s.quantity)} {p.unit as string}{can.fin && s.avgCost ? <span className="ml-2 text-xs font-normal text-muted">@ ₹{Number(s.avgCost).toFixed(2)}</span> : null}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card className="p-5">
            <DefinitionList items={[["Barcode", p.barcode as string], ["Unit", p.unit as string], ["MRP", p.mrp ? <Money value={p.mrp as string} /> : null], ["Description", p.description as string], ["Variant of", p.parentName as string]]} />
          </Card>
          {(p.variants as unknown[]).length > 0 && (
            <Card>
              <CardHeader title="Variants" />
              <ul className="divide-y divide-line text-sm">
                {(p.variants as Array<Record<string, unknown>>).map((v) => (
                  <li key={v.id as string} className="px-5 py-2"><Link className="text-brand-700" href={`/products/${v.id}`}>{v.name as string}</Link></li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
