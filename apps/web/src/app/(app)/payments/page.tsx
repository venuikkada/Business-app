import Link from "next/link";
import { payments } from "@cba/server";
import { formatDateIN, PAYMENT_METHOD_LABEL } from "@cba/core";
import { tenantOrError } from "@/lib/session";
import { qs } from "@/lib/fmt";
import { Card, EmptyState, ErrorPanel, Input, LinkButton, Money, PageHeader, Pagination, SearchForm, StatusBadge, Table, Tabs, Td, Th } from "@/components/ui";

export const metadata = { title: "Payments" };

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const dir = sp.direction === "out" ? "out" : sp.direction === "in" ? "in" : undefined;
  const res = await tenantOrError(async (t) => ({ list: await payments.listPayments(t, { ...sp, direction: dir }), canCreate: t.can("payments.create") && !t.isSupport }));
  if (!res.ok) return <ErrorPanel code={res.code} message={res.message} />;
  const { list, canCreate } = res.data;
  const keep = { q: sp.q, from: sp.from, to: sp.to };
  return (
    <>
      <PageHeader
        title="Payments"
        subtitle={<>Received <Money value={list.totalIn} className="text-emerald-700" /> · Paid <Money value={list.totalOut} /></>}
        actions={canCreate && (<><LinkButton href="/payments/new?direction=in">Receive payment</LinkButton><LinkButton href="/payments/new?direction=out" variant="secondary">Make payment</LinkButton></>)}
      />
      <Tabs active={dir ?? ""} tabs={[{ key: "", label: "All", href: `/payments${qs(keep)}` }, { key: "in", label: "Received", href: `/payments${qs({ ...keep, direction: "in" })}` }, { key: "out", label: "Paid", href: `/payments${qs({ ...keep, direction: "out" })}` }]} />
      <Card>
        <SearchForm action="/payments" q={sp.q} placeholder="Receipt no., party or reference">
          {dir && <input type="hidden" name="direction" value={dir} />}
          <Input type="date" name="from" defaultValue={sp.from} className="sm:w-40" aria-label="From" />
          <Input type="date" name="to" defaultValue={sp.to} className="sm:w-40" aria-label="To" />
        </SearchForm>
        {list.items.length === 0 ? (
          <EmptyState title="No payments recorded" body="Record money received against invoices to keep balances accurate." />
        ) : (
          <>
            <Table>
              <thead><tr><Th>Number</Th><Th>Party</Th><Th>Date</Th><Th>Mode</Th><Th align="right">Amount</Th><Th>Status</Th></tr></thead>
              <tbody>
                {list.items.map((p) => (
                  <tr key={p.id as string} className="hover:bg-stone-50">
                    <Td><Link className="font-medium text-brand-700" href={`/payments/${p.id}`}>{p.number as string}</Link></Td>
                    <Td>{p.partyName as string}</Td>
                    <Td>{formatDateIN(p.paidOn as string)}</Td>
                    <Td>{PAYMENT_METHOD_LABEL[p.method as string]}{p.reference ? <div className="text-xs text-muted">{p.reference as string}</div> : null}</Td>
                    <Td align="right"><Money value={p.amount as string} className={p.direction === "in" ? "text-emerald-700" : ""} /></Td>
                    <Td><StatusBadge status={p.status as string} /></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={list.page} pageSize={list.pageSize} total={list.total} hrefFor={(p) => `/payments${qs({ ...keep, direction: dir, page: p })}`} />
          </>
        )}
      </Card>
    </>
  );
}
