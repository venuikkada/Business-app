import Link from "next/link";
import { notFound } from "next/navigation";
import { documents } from "@cba/server";
import { DOC_TYPE_META, formatDateIN } from "@cba/core";
import { tenantOrError } from "@/lib/session";
import { qs } from "@/lib/fmt";
import { asDocType, EMPTY_TEXT, STATUS_TABS, partyWord } from "@/components/documents/meta";
import { Card, EmptyState, ErrorPanel, LinkButton, Money, PageHeader, Pagination, SearchForm, StatusBadge, Table, Tabs, Td, Th, Input } from "@/components/ui";

type SP = Promise<Record<string, string | undefined>>;

export async function generateMetadata({ params }: { params: Promise<{ type: string }> }) {
  const t = asDocType((await params).type);
  return { title: t ? DOC_TYPE_META[t].plural : "Documents" };
}

export default async function DocumentList({ params, searchParams }: { params: Promise<{ type: string }>; searchParams: SP }) {
  const type = asDocType((await params).type);
  if (!type) notFound();
  const sp = await searchParams;
  const meta = DOC_TYPE_META[type];
  const res = await tenantOrError(async (t) => ({
    list: await documents.listDocuments(t, [type], { q: sp.q, status: sp.status, page: sp.page, from: sp.from, to: sp.to, partyId: sp.partyId, sort: sp.sort, dir: sp.dir }),
    canCreate: t.can((meta.side === "purchase" ? "purchases.create" : type === "quotation" ? "quotations.create" : type === "sales_order" || type === "delivery_challan" ? "sales_orders.create" : "invoices.create") as never),
  }));
  if (!res.ok) return <ErrorPanel code={res.code} message={res.message} />;
  const { list, canCreate } = res.data;
  const base = `/documents/${type}`;
  const keep = { q: sp.q, from: sp.from, to: sp.to, partyId: sp.partyId };
  const hasMoney = type === "invoice" || type === "purchase_bill";
  return (
    <>
      <PageHeader
        title={meta.plural}
        subtitle={hasMoney ? <>Total <Money value={list.sumTotal} /> · Outstanding <Money value={list.sumBalance} /></> : `${list.total} document${list.total === 1 ? "" : "s"}`}
        actions={canCreate && <LinkButton href={`/documents/new?type=${type}`}>New {meta.label.toLowerCase()}</LinkButton>}
      />
      <Tabs active={sp.status ?? ""} tabs={STATUS_TABS[type].map(([k, l]) => ({ key: k, label: l, href: `${base}${qs({ ...keep, status: k })}` }))} />
      <Card>
        <SearchForm action={base} q={sp.q} placeholder={`Search number or ${partyWord(type).toLowerCase()}…`}>
          {sp.status && <input type="hidden" name="status" value={sp.status} />}
          <Input type="date" name="from" defaultValue={sp.from} className="sm:w-40" aria-label="From" />
          <Input type="date" name="to" defaultValue={sp.to} className="sm:w-40" aria-label="To" />
        </SearchForm>
        {list.items.length === 0 ? (
          <EmptyState
            icon={<span>₹</span>}
            title={sp.q || sp.status ? "Nothing matches these filters" : `No ${meta.plural.toLowerCase()} yet`}
            body={sp.q || sp.status ? "Try a different search or clear the filters." : EMPTY_TEXT[type]}
            action={canCreate && !sp.q ? <LinkButton href={`/documents/new?type=${type}`}>Create {meta.label.toLowerCase()}</LinkButton> : undefined}
          />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Number</Th>
                  <Th>{partyWord(type)}</Th>
                  <Th>Date</Th>
                  {hasMoney && <Th>Due</Th>}
                  {type === "quotation" && <Th>Valid until</Th>}
                  <Th align="right">Amount</Th>
                  {hasMoney && <Th align="right">Balance</Th>}
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {list.items.map((d) => (
                  <tr key={d.id as string} className="hover:bg-stone-50">
                    <Td>
                      <Link href={`${base}/${d.id}`} className="font-medium text-brand-700 hover:underline">{(d.number as string) ?? "Draft"}</Link>
                    </Td>
                    <Td className="max-w-[16rem] truncate">{d.partyName as string}</Td>
                    <Td className="whitespace-nowrap">{formatDateIN(d.issueDate as string)}</Td>
                    {hasMoney && <Td className="whitespace-nowrap">{formatDateIN(d.dueDate as string)}</Td>}
                    {type === "quotation" && <Td className="whitespace-nowrap">{formatDateIN(d.validUntil as string)}</Td>}
                    <Td align="right"><Money value={d.grandTotal as string} /></Td>
                    {hasMoney && <Td align="right"><Money value={["issued", "partially_paid"].includes(d.status as string) ? (d.balanceDue as string) : "0"} /></Td>}
                    <Td><StatusBadge status={d.isExpired ? "expired" : (d.status as string)} overdue={!!d.isOverdue} /></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={list.page} pageSize={list.pageSize} total={list.total} hrefFor={(p) => `${base}${qs({ ...keep, status: sp.status, page: p })}`} />
          </>
        )}
      </Card>
    </>
  );
}
