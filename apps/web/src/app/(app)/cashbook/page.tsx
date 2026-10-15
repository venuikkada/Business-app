import { finance } from "@cba/server";
import { formatDateIN } from "@cba/core";
import { tenantOrError } from "@/lib/session";
import { qs } from "@/lib/fmt";
import { CashbookActions } from "@/components/money/cashbook-forms";
import { Badge, Card, CardHeader, ErrorPanel, Money, PageHeader, Table, Td, Th, cn } from "@/components/ui";
import Link from "next/link";

export const metadata = { title: "Cash & bank" };

export default async function CashbookPage({ searchParams }: { searchParams: Promise<{ accountId?: string; from?: string; to?: string }> }) {
  const sp = await searchParams;
  const res = await tenantOrError(async (t) => {
    const accounts = (await finance.listAccounts(t)) as Array<{ id: string; name: string; type: string; balance: string; archivedAt: string | null; isDefault: boolean }>;
    const from = sp.from ?? `${t.today.slice(0, 7)}-01`;
    const to = sp.to ?? t.today;
    const accountId = sp.accountId && accounts.some((a) => a.id === sp.accountId) ? sp.accountId : null;
    return { accounts, book: await finance.cashbook(t, accountId, from, to), from, to, accountId, today: t.today, canEdit: t.can("accounts.edit") && !t.isSupport };
  });
  if (!res.ok) return <ErrorPanel code={res.code} message={res.message} />;
  const { accounts, book, from, to, accountId, today, canEdit } = res.data;
  const active = accounts.filter((a) => !a.archivedAt);
  return (
    <>
      <PageHeader title="Cash & bank" subtitle="Every rupee in and out of your cash drawer and bank accounts" actions={canEdit && <CashbookActions accounts={active.map((a) => ({ id: a.id, name: a.name }))} today={today} />} />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Link href={`/cashbook${qs({ from: sp.from, to: sp.to })}`} className={cn("rounded-[14px] border bg-white p-4", !accountId ? "border-brand-400 ring-2 ring-brand-100" : "border-line")}>
          <div className="text-xs font-medium uppercase text-muted">All accounts</div>
          <div className="mt-1 text-xl font-semibold"><Money value={active.reduce((s, a) => s + Number(a.balance), 0).toFixed(2)} /></div>
        </Link>
        {active.map((a) => (
          <Link key={a.id} href={`/cashbook${qs({ accountId: a.id, from: sp.from, to: sp.to })}`} className={cn("rounded-[14px] border bg-white p-4", accountId === a.id ? "border-brand-400 ring-2 ring-brand-100" : "border-line")}>
            <div className="flex items-center gap-2 text-xs font-medium uppercase text-muted">{a.name} {a.isDefault && <Badge>default {a.type}</Badge>}</div>
            <div className={cn("mt-1 text-xl font-semibold", Number(a.balance) < 0 && "text-red-700")}><Money value={a.balance} /></div>
          </Link>
        ))}
      </div>
      <Card>
        <CardHeader
          title="Cashbook"
          subtitle={<>Opening <Money value={book.openingBalance} /> · In <Money value={book.inflow} className="text-emerald-700" /> · Out <Money value={book.outflow} /> · Closing <Money value={book.closingBalance} /></>}
          action={
            <form method="get" className="flex gap-2 text-sm">
              {accountId && <input type="hidden" name="accountId" value={accountId} />}
              <input type="date" name="from" defaultValue={from} className="h-8 rounded-lg border border-line px-2" aria-label="From" />
              <input type="date" name="to" defaultValue={to} className="h-8 rounded-lg border border-line px-2" aria-label="To" />
              <button className="h-8 rounded-lg border border-line px-3">Go</button>
            </form>
          }
        />
        <Table>
          <thead><tr><Th>Date</Th><Th>Particulars</Th>{!accountId && <Th>Account</Th>}<Th align="right">In</Th><Th align="right">Out</Th><Th align="right">Balance</Th></tr></thead>
          <tbody>
            {(book.entries as Array<Record<string, string>>).map((e) => (
              <tr key={e.id}>
                <Td className="whitespace-nowrap">{formatDateIN(e.txnDate)}</Td>
                <Td>
                  {e.sourceType === "payment" ? <Link className="text-brand-700" href={`/payments/${e.sourceId}`}>{e.notes}</Link> : e.notes ?? e.category}
                  <div className="text-xs text-muted">{e.kind?.replace("_", " ")}{e.category ? ` · ${e.category}` : ""}</div>
                </Td>
                {!accountId && <Td className="text-xs">{e.accountName}</Td>}
                <Td align="right" className="text-emerald-700">{Number(e.amount) > 0 ? <Money value={e.amount} /> : ""}</Td>
                <Td align="right">{Number(e.amount) < 0 ? <Money value={Math.abs(Number(e.amount)).toFixed(2)} /> : ""}</Td>
                <Td align="right"><Money value={e.balance} /></Td>
              </tr>
            ))}
            {book.entries.length === 0 && <tr><Td className="text-muted">No entries in this period.</Td></tr>}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
