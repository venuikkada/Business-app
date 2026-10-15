import { finance } from "@cba/server";
import { formatDateIN, PAYMENT_METHOD_LABEL } from "@cba/core";
import { tenantOrError } from "@/lib/session";
import { qs } from "@/lib/fmt";
import { ActionButton } from "@/components/client";
import { Card, EmptyState, ErrorPanel, Input, LinkButton, Money, PageHeader, Pagination, SearchForm, Select, StatusBadge, Table, Td, Th } from "@/components/ui";

export const metadata = { title: "Expenses" };

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const res = await tenantOrError(async (t) => {
    t.requireFeature("expenses");
    return {
      list: await finance.listExpenses(t, sp),
      cats: (await finance.listExpenseCategories(t)) as Array<{ id: string; name: string }>,
      can: { create: t.can("expenses.create") && !t.isSupport, del: t.can("expenses.delete") && !t.isSupport },
    };
  });
  if (!res.ok) return <ErrorPanel code={res.code} message={res.message} />;
  const { list, cats, can } = res.data;
  return (
    <>
      <PageHeader title="Expenses" subtitle={<>Total <Money value={list.sumTotal} /> for the filtered period</>} actions={can.create && <LinkButton href="/expenses/new">Add expense</LinkButton>} />
      <Card>
        <SearchForm action="/expenses" q={sp.q} placeholder="Notes, reference, category">
          <Select name="categoryId" defaultValue={sp.categoryId ?? ""} className="sm:w-44" aria-label="Category"><option value="">All categories</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
          <Input type="date" name="from" defaultValue={sp.from} className="sm:w-40" aria-label="From" />
          <Input type="date" name="to" defaultValue={sp.to} className="sm:w-40" aria-label="To" />
        </SearchForm>
        {list.items.length === 0 ? (
          <EmptyState title="No expenses recorded" body="Track rent, salaries, electricity and other costs to see real profit." action={can.create ? <LinkButton href="/expenses/new">Add expense</LinkButton> : undefined} />
        ) : (
          <>
            <Table>
              <thead><tr><Th>Date</Th><Th>Category</Th><Th>Details</Th><Th>Paid by</Th><Th align="right">Amount</Th><Th /></tr></thead>
              <tbody>
                {list.items.map((e) => (
                  <tr key={e.id as string}>
                    <Td className="whitespace-nowrap">{formatDateIN(e.expenseDate as string)}<div className="text-xs text-muted">{e.number as string}</div></Td>
                    <Td>{e.categoryName as string}</Td>
                    <Td className="max-w-xs">
                      <div className="truncate">{(e.notes as string) ?? ""}</div>
                      {e.reference ? <div className="text-xs text-muted">Ref {e.reference as string}</div> : null}
                      {e.attachmentFileId ? <a className="text-xs text-brand-700" href={`/api/v1/files/${e.attachmentFileId}`} target="_blank" rel="noopener">View receipt</a> : null}
                    </Td>
                    <Td>{PAYMENT_METHOD_LABEL[e.method as string]}</Td>
                    <Td align="right"><Money value={e.amount as string} />{Number(e.taxAmount) ? <div className="text-xs text-muted">GST ₹{e.taxAmount as string}</div> : null}</Td>
                    <Td align="right">
                      {e.status === "void" ? <StatusBadge status="void" /> : can.del ? (
                        <ActionButton size="sm" variant="ghost" path={`expenses/${e.id}/void`} success="Expense voided" confirm={{ title: "Void this expense?", danger: true, confirmLabel: "Void", reason: { label: "Reason", minLength: 3 } }}>Void</ActionButton>
                      ) : null}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={list.page} pageSize={list.pageSize} total={list.total} hrefFor={(p) => `/expenses${qs({ ...sp, page: p })}`} />
          </>
        )}
      </Card>
    </>
  );
}
