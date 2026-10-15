import { finance } from "@cba/server";
import { tenantOrError } from "@/lib/session";
import { ExpenseForm } from "@/components/money/expense-form";
import { ErrorPanel, PageHeader } from "@/components/ui";

export const metadata = { title: "Add expense" };

export default async function NewExpense() {
  const res = await tenantOrError(async (t) => {
    t.require("expenses.create");
    t.requireFeature("expenses");
    const cats = ((await finance.listExpenseCategories(t)) as Array<{ id: string; name: string; archivedAt: string | null }>).filter((c) => !c.archivedAt);
    const accounts = t.can("accounts.view") ? ((await finance.listAccounts(t)) as Array<{ id: string; name: string; archivedAt: string | null }>).filter((a) => !a.archivedAt) : [];
    return { cats, accounts, today: t.today };
  });
  if (!res.ok) return <ErrorPanel code={res.code} message={res.message} />;
  return (
    <>
      <PageHeader title="Add expense" back={{ href: "/expenses", label: "Expenses" }} />
      <ExpenseForm categories={res.data.cats} accounts={res.data.accounts} today={res.data.today} />
    </>
  );
}
