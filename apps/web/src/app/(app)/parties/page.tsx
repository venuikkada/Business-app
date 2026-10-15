import Link from "next/link";
import { parties } from "@cba/server";
import { formatIndianPhone } from "@cba/core";
import { tenantOrError } from "@/lib/session";
import { qs } from "@/lib/fmt";
import { Badge, Card, EmptyState, ErrorPanel, LinkButton, Money, PageHeader, Pagination, SearchForm, Table, Tabs, Td, Th } from "@/components/ui";

export const metadata = { title: "Customers & suppliers" };

export default async function PartiesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const res = await tenantOrError(async (t) => ({
    list: await parties.listParties(t, { q: sp.q, type: sp.type, page: sp.page, status: sp.status, archived: sp.archived, sort: sp.sort, dir: sp.dir }),
    canCreate: t.can("parties.create"),
    canExport: t.can("parties.export"),
    showBalance: t.can("payments.view") || t.can("invoices.view"),
  }));
  if (!res.ok) return <ErrorPanel code={res.code} message={res.message} />;
  const { list, canCreate, canExport, showBalance } = res.data;
  const keep = { q: sp.q, type: sp.type };
  return (
    <>
      <PageHeader
        title="Customers & suppliers"
        subtitle={`${list.total} ${sp.archived === "true" ? "archived" : "active"}`}
        actions={
          <>
            {canExport && <a href="/api/v1/parties/export" className="text-sm font-medium text-brand-700 hover:underline">Export CSV</a>}
            {canCreate && <LinkButton href="/parties/import" variant="secondary">Import</LinkButton>}
            {canCreate && <LinkButton href={`/parties/new${sp.type === "supplier" ? "?kind=supplier" : ""}`}>Add {sp.type === "supplier" ? "supplier" : "customer"}</LinkButton>}
          </>
        }
      />
      <Tabs
        active={sp.archived === "true" ? "archived" : sp.status === "outstanding" ? "outstanding" : sp.type ?? ""}
        tabs={[
          { key: "", label: "All", href: `/parties${qs({ q: sp.q })}` },
          { key: "customer", label: "Customers", href: `/parties${qs({ q: sp.q, type: "customer" })}` },
          { key: "supplier", label: "Suppliers", href: `/parties${qs({ q: sp.q, type: "supplier" })}` },
          { key: "outstanding", label: "With balance", href: `/parties${qs({ q: sp.q, status: "outstanding" })}` },
          { key: "archived", label: "Archived", href: `/parties${qs({ q: sp.q, archived: "true" })}` },
        ]}
      />
      <Card>
        <SearchForm action="/parties" q={sp.q} placeholder="Name, phone, GSTIN or email">
          {sp.type && <input type="hidden" name="type" value={sp.type} />}
        </SearchForm>
        {list.items.length === 0 ? (
          <EmptyState icon={<span>👥</span>} title={sp.q ? "No matches" : "No customers yet"} body={sp.q ? "Try another name or number." : "Add customers one by one or import your existing list from Excel."} action={canCreate && !sp.q ? <LinkButton href="/parties/new">Add customer</LinkButton> : undefined} />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th>Phone</Th>
                  <Th>GSTIN</Th>
                  <Th>City</Th>
                  {showBalance && <Th align="right">Balance</Th>}
                </tr>
              </thead>
              <tbody>
                {list.items.map((p) => (
                  <tr key={p.id as string} className="hover:bg-stone-50">
                    <Td>
                      <Link href={`/parties/${p.id}`} className="font-medium text-ink hover:text-brand-700">{p.name as string}</Link>
                      <div className="mt-0.5 flex gap-1">
                        {p.isCustomer ? <Badge>Customer</Badge> : null}
                        {p.isSupplier ? <Badge color="blue">Supplier</Badge> : null}
                      </div>
                    </Td>
                    <Td className="whitespace-nowrap">{formatIndianPhone(p.phone as string)}</Td>
                    <Td className="font-mono text-xs">{(p.gstin as string) ?? ""}</Td>
                    <Td>{(p.billingCity as string) ?? ""}</Td>
                    {showBalance && (
                      <Td align="right">
                        <Money value={Math.abs(Number(p.balance)).toFixed(2)} className={Number(p.balance) > 0 ? "font-medium text-emerald-700" : Number(p.balance) < 0 ? "font-medium text-red-700" : "text-muted"} />
                        <div className="text-[11px] text-muted">{Number(p.balance) > 0 ? "to collect" : Number(p.balance) < 0 ? "to pay" : "settled"}</div>
                      </Td>
                    )}
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={list.page} pageSize={list.pageSize} total={list.total} hrefFor={(p) => `/parties${qs({ ...keep, status: sp.status, archived: sp.archived, page: p })}`} />
          </>
        )}
      </Card>
    </>
  );
}
