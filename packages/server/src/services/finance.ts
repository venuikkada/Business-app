import { randomUUID } from "node:crypto";
import { expenseSchema, expenseCategorySchema, accountSchema, accountTransferSchema, accountEntrySchema, D } from "@cba/core";
import type { z } from "zod";
import { resolveBranch, type Tenant } from "../context";
import { AppError, notFound } from "../errors";
import { camelize, likePattern, orderBy, parseList } from "../util";
import { nextNumber } from "./documents";
import { defaultAccountFor } from "./payments";

// ---------------------------------------------------------------- expenses
export async function listExpenseCategories(t: Tenant) {
  t.require("expenses.view");
  return camelize(await t.db.query("select id, name, archived_at from expense_categories order by archived_at nulls first, lower(name)"));
}

export async function createExpenseCategory(t: Tenant, input: z.input<typeof expenseCategorySchema>) {
  t.require("expenses.create");
  const d = expenseCategorySchema.parse(input);
  return camelize(await t.db.one("insert into expense_categories(business_id, name) values ($1,$2) returning id, name", [t.businessId, d.name]));
}

export async function recordExpense(t: Tenant, input: z.input<typeof expenseSchema> & { confirmDuplicate?: boolean }) {
  t.require("expenses.create");
  t.requireFeature("expenses");
  const d = expenseSchema.parse(input);
  if (d.expenseDate > t.today) throw new AppError("VALIDATION", "Expense date cannot be in the future");
  if (new D(d.taxAmount ?? 0).gt(d.amount)) throw new AppError("VALIDATION", "GST amount cannot exceed the total");
  const cat = await t.db.maybe<{ name: string }>("select name from expense_categories where id = $1 and archived_at is null", [d.categoryId]);
  if (!cat) throw new AppError("VALIDATION", "Expense category not found");
  if (d.attachmentId) {
    const f = await t.db.maybe("select 1 from files where id = $1 and purpose = 'expense_receipt'", [d.attachmentId]);
    if (!f) throw new AppError("VALIDATION", "Receipt file not found");
  }
  // Duplicate guard: same category, amount and date (or same reference) in the last 7 days of entries.
  if (!input.confirmDuplicate) {
    const dup = await t.db.maybe<{ number: string }>(
      `select number from expenses where status = 'active' and category_id = $1 and amount = $2 and expense_date = $3
          or (status = 'active' and $4::text is not null and reference = $4 and expense_date > $3::date - 7) limit 1`,
      [d.categoryId, d.amount, d.expenseDate, d.reference],
    );
    if (dup) throw new AppError("POSSIBLE_DUPLICATE", `This looks like expense ${dup.number} recorded earlier. Save anyway?`, { number: dup.number });
  }
  const accountId = d.accountId ?? (await defaultAccountFor(t, d.method));
  const branchId = await resolveBranch(t, null);
  const { number } = await nextNumber(t, "expense", d.expenseDate, "EXP");
  const e = await t.db.one<{ id: string }>(
    `insert into expenses(business_id, branch_id, number, category_id, amount, tax_amount, expense_date, method, account_id, party_id, reference, notes, attachment_file_id, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning id`,
    [t.businessId, branchId, number, d.categoryId, d.amount, d.taxAmount ?? 0, d.expenseDate, d.method, accountId, d.partyId ?? null, d.reference, d.notes, d.attachmentId ?? null, t.userId],
  );
  if (accountId) {
    await t.db.exec(
      `insert into account_transactions(business_id, account_id, txn_date, amount, kind, category, source_type, source_id, notes, created_by)
       values ($1,$2,$3,$4,'expense',$5,'expense',$6,$7,$8)`,
      [t.businessId, accountId, d.expenseDate, `-${d.amount}`, cat.name, e.id, `${number} ${cat.name}`, t.userId],
    );
  }
  await t.audit("expense.create", "expense", e.id, `${number}: ₹${d.amount} ${cat.name}`, undefined, d);
  return getExpense(t, e.id);
}

export async function voidExpense(t: Tenant, id: string, reason: string) {
  t.require("expenses.delete");
  if (!reason || reason.trim().length < 3) throw new AppError("VALIDATION", "Enter a reason");
  const e = await t.db.maybe<{ status: string; number: string; amount: string; account_id: string | null }>("select status, number, amount, account_id from expenses where id = $1 for update", [id]);
  if (!e) throw notFound("Expense");
  if (e.status === "void") throw new AppError("CONFLICT", "Already void");
  await t.db.exec("update expenses set status = 'void', voided_by = $2, voided_at = now(), void_reason = $3 where id = $1", [id, t.userId, reason.trim()]);
  if (e.account_id) {
    await t.db.exec(
      `insert into account_transactions(business_id, account_id, txn_date, amount, kind, source_type, source_id, notes, created_by)
       values ($1,$2,$3,$4,'reversal','expense_void',$5,$6,$7)`,
      [t.businessId, e.account_id, t.today, e.amount, id, `Void ${e.number}: ${reason}`, t.userId],
    );
  }
  await t.audit("expense.void", "expense", id, `Voided ${e.number}: ${reason}`);
}

export async function getExpense(t: Tenant, id: string) {
  t.require("expenses.view");
  const e = await t.db.maybe(
    `select e.*, c.name as category_name, a.name as account_name, p.name as party_name, u.full_name as created_by_name
       from expenses e join expense_categories c on c.id = e.category_id left join accounts a on a.id = e.account_id
       left join parties p on p.id = e.party_id left join users u on u.id = e.created_by where e.id = $1`,
    [id],
  );
  if (!e) throw notFound("Expense");
  return camelize(e);
}

export async function listExpenses(t: Tenant, query: unknown) {
  t.require("expenses.view");
  const q = parseList(query);
  const extra = (query ?? {}) as { categoryId?: string };
  const params: unknown[] = [];
  const where = [q.status === "void" ? "e.status = 'void'" : q.status === "all" ? "true" : "e.status = 'active'"];
  if (extra.categoryId && /^[0-9a-f-]{36}$/.test(extra.categoryId)) {
    params.push(extra.categoryId);
    where.push(`e.category_id = $${params.length}`);
  }
  if (q.from) {
    params.push(q.from);
    where.push(`e.expense_date >= $${params.length}`);
  }
  if (q.to) {
    params.push(q.to);
    where.push(`e.expense_date <= $${params.length}`);
  }
  if (q.q) {
    params.push(likePattern(q.q));
    where.push(`(e.number ilike $${params.length} or e.notes ilike $${params.length} or e.reference ilike $${params.length} or c.name ilike $${params.length})`);
  }
  const w = where.join(" and ");
  const tot = await t.db.one<{ n: number; total: string }>(`select count(*)::int n, coalesce(sum(e.amount),0) total from expenses e join expense_categories c on c.id = e.category_id where ${w}`, params);
  const order = orderBy(q.sort, { date: "e.expense_date", amount: "e.amount", category: "lower(c.name)" }, "date", q.dir);
  params.push(q.pageSize, (q.page - 1) * q.pageSize);
  const rows = await t.db.query(
    `select e.id, e.number, e.amount, e.tax_amount, e.expense_date, e.method, e.reference, e.notes, e.status, e.attachment_file_id, c.name as category_name, a.name as account_name
       from expenses e join expense_categories c on c.id = e.category_id left join accounts a on a.id = e.account_id
      where ${w} order by ${order}, e.created_at desc limit $${params.length - 1} offset $${params.length}`,
    params,
  );
  return { items: camelize(rows), total: tot.n, sumTotal: tot.total, page: q.page, pageSize: q.pageSize };
}

// ---------------------------------------------------------------- accounts
export async function listAccounts(t: Tenant) {
  t.require("accounts.view");
  return camelize(
    await t.db.query(
      `select a.*, a.opening_balance + coalesce((select sum(amount) from account_transactions x where x.account_id = a.id), 0) as balance
         from accounts a order by a.archived_at nulls first, a.type, lower(a.name)`,
    ),
  );
}

export async function createAccount(t: Tenant, input: z.input<typeof accountSchema>) {
  t.require("accounts.create");
  const d = accountSchema.parse(input);
  const r = await t.db.one<{ id: string }>(
    "insert into accounts(business_id, name, type, opening_balance, account_number_last4) values ($1,$2,$3,$4,$5) returning id",
    [t.businessId, d.name, d.type, d.openingBalance, d.accountNumberLast4],
  );
  await t.audit("account.create", "account", r.id, `Account ${d.name} created`);
  return r;
}

export async function updateAccount(t: Tenant, id: string, input: { name?: string; archived?: boolean; isDefault?: boolean }) {
  t.require("accounts.edit");
  const a = await t.db.maybe<{ type: string }>("select type from accounts where id = $1", [id]);
  if (!a) throw notFound("Account");
  if (input.name) await t.db.exec("update accounts set name = $2 where id = $1", [id, accountSchema.shape.name.parse(input.name)]);
  if (input.archived !== undefined) await t.db.exec(`update accounts set archived_at = ${input.archived ? "now()" : "null"}, is_default = case when $2 then false else is_default end where id = $1`, [id, input.archived]);
  if (input.isDefault) {
    await t.db.exec("update accounts set is_default = false where type = $1 and is_default", [a.type]);
    await t.db.exec("update accounts set is_default = true where id = $1", [id]);
  }
  await t.audit("account.update", "account", id, undefined, undefined, input);
}

export async function transferBetweenAccounts(t: Tenant, input: z.input<typeof accountTransferSchema>) {
  t.require("accounts.edit");
  const d = accountTransferSchema.parse(input);
  const accs = await t.db.query<{ id: string; name: string }>("select id, name from accounts where id = any($1) and archived_at is null", [[d.fromAccountId, d.toAccountId]]);
  if (accs.length !== 2) throw new AppError("VALIDATION", "Account not found");
  const group = randomUUID();
  const name = (id: string) => accs.find((a) => a.id === id)!.name;
  await t.db.exec(
    `insert into account_transactions(business_id, account_id, txn_date, amount, kind, transfer_group, notes, created_by)
     values ($1,$2,$4,$5,'transfer_out',$6,$7,$8), ($1,$3,$4,$9,'transfer_in',$6,$10,$8)`,
    [t.businessId, d.fromAccountId, d.toAccountId, d.txnDate, `-${d.amount}`, group, d.notes ?? `To ${name(d.toAccountId)}`, t.userId, d.amount, d.notes ?? `From ${name(d.fromAccountId)}`],
  );
  await t.audit("account.transfer", "account", d.fromAccountId, `₹${d.amount} ${name(d.fromAccountId)} → ${name(d.toAccountId)}`);
  return { transferGroup: group };
}

/** Other income, owner deposits/withdrawals and bank charges. */
export async function recordAccountEntry(t: Tenant, input: z.input<typeof accountEntrySchema>) {
  t.require("accounts.edit");
  const d = accountEntrySchema.parse(input);
  const acc = await t.db.maybe("select 1 from accounts where id = $1 and archived_at is null", [d.accountId]);
  if (!acc) throw new AppError("VALIDATION", "Account not found");
  const kind = d.direction === "in" ? (/(capital|deposit|owner)/i.test(d.category) ? "deposit" : "income") : "withdrawal";
  const r = await t.db.one<{ id: string }>(
    `insert into account_transactions(business_id, account_id, txn_date, amount, kind, category, notes, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
    [t.businessId, d.accountId, d.txnDate, d.direction === "in" ? d.amount : `-${d.amount}`, kind, d.category, d.notes, t.userId],
  );
  await t.audit("account.entry", "account", d.accountId, `${d.direction === "in" ? "+" : "-"}₹${d.amount} ${d.category}`);
  return r;
}

/** Cashbook: every money movement with a running balance. */
export async function cashbook(t: Tenant, accountId: string | null, from: string, to: string) {
  t.require("accounts.view");
  const opening = await t.db.one<{ b: string }>(
    `select coalesce((select sum(opening_balance) from accounts where $1::uuid is null or id = $1), 0)
          + coalesce((select sum(amount) from account_transactions where ($1::uuid is null or account_id = $1) and txn_date < $2), 0) as b`,
    [accountId, from],
  );
  const rows = await t.db.query<Record<string, unknown>>(
    `select x.id, x.txn_date, x.amount, x.kind, x.category, x.notes, x.source_type, x.source_id, a.name as account_name
       from account_transactions x join accounts a on a.id = x.account_id
      where ($1::uuid is null or x.account_id = $1) and x.txn_date between $2 and $3 order by x.txn_date, x.created_at`,
    [accountId, from, to],
  );
  let bal = new D(opening.b);
  let inflow = new D(0);
  let outflow = new D(0);
  const entries = rows.map((r) => {
    const amt = new D(r.amount as string);
    // Internal transfers move money between accounts but are not business inflow/outflow.
    // (They do count when looking at a single account.)
    const isTransfer = String(r.kind).startsWith("transfer");
    if (accountId || !isTransfer) {
      if (amt.gt(0)) inflow = inflow.add(amt);
      else outflow = outflow.add(amt.neg());
    }
    bal = bal.add(amt);
    return { ...camelize<Record<string, unknown>>(r), balance: bal.toFixed(2) };
  });
  return { openingBalance: new D(opening.b).toFixed(2), entries, inflow: inflow.toFixed(2), outflow: outflow.toFixed(2), closingBalance: bal.toFixed(2) };
}
