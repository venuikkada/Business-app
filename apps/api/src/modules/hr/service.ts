import { dec } from "@cba/core";
import { TenantDb, json, withTx } from "../../db/pool.js";
import type { TenantCtx } from "../../http/context.js";
import { decrypt, encrypt } from "../../lib/crypto.js";
import { badRequest, conflict, notFound } from "../../lib/errors.js";
import { audit } from "../audit/service.js";

export interface Component { name: string; amount: number }
export interface EmployeeInput {
  name: string; mobile?: string | null; designation?: string | null; department?: string | null; branchId?: number | null; joiningDate: string;
  pan?: string | null; uan?: string | null; bankAccount?: string | null; bankIfsc?: string | null; status?: "active" | "on_notice" | "left";
  basic?: number; allowances?: Component[]; deductions?: Component[];
}

function empOut(ctx: TenantCtx, e: any) {
  const pay = ctx.permissions.has("payroll.view");
  let last4: string | null = null;
  if (e.bank_account_enc) {
    try { last4 = decrypt(e.bank_account_enc).toString("utf8").slice(-4); } catch { last4 = null; }
  }
  const comps = json<any>(e.components, { allowances: [], deductions: [] });
  return {
    id: Number(e.id), code: e.code, name: e.name, mobile: e.mobile, designation: e.designation, department: e.department,
    branchId: e.branch_id ? Number(e.branch_id) : null, joiningDate: e.joining_date, pan: e.pan, uan: e.uan, bankLast4: last4, bankIfsc: e.bank_ifsc, status: e.status,
    salary: pay && e.basic != null ? { basic: e.basic, allowances: comps.allowances ?? [], deductions: comps.deductions ?? [] } : null,
  };
}

const EMP_SQL = `SELECT e.*, s.basic, s.components FROM employees e
  LEFT JOIN salary_structures s ON s.tenant_id = e.tenant_id AND s.employee_id = e.id
       AND s.effective_from = (SELECT MAX(x.effective_from) FROM salary_structures x WHERE x.tenant_id = e.tenant_id AND x.employee_id = e.id)
 WHERE e.tenant_id = :tenantId`;

export async function listEmployees(ctx: TenantCtx) {
  return (await ctx.tdb.all(EMP_SQL + " ORDER BY FIELD(e.status,'active','on_notice','left'), e.name")).map((e) => empOut(ctx, e));
}

async function saveSalary(tdb: TenantDb, ctx: TenantCtx, employeeId: number, i: EmployeeInput) {
  if (i.basic === undefined || !ctx.permissions.has("payroll.run")) return;
  await tdb.exec(
    `INSERT INTO salary_structures (tenant_id, employee_id, effective_from, basic, components, created_by)
     VALUES (:tenantId, :e, CURRENT_DATE, :basic, :c, :by) ON DUPLICATE KEY UPDATE basic = VALUES(basic), components = VALUES(components)`,
    { e: employeeId, basic: i.basic, c: JSON.stringify({ allowances: i.allowances ?? [], deductions: i.deductions ?? [] }), by: ctx.userId },
  );
}

export async function saveEmployee(ctx: TenantCtx, id: number | null, i: EmployeeInput) {
  const eid = await withTx(async (conn) => {
    const tdb = new TenantDb(conn, ctx.tenantId);
    const vals = {
      name: i.name, mobile: i.mobile || null, desig: i.designation || null, dept: i.department || null, branch: i.branchId ?? null, join: i.joiningDate,
      pan: i.pan ? i.pan.toUpperCase() : null, uan: i.uan || null, ifsc: i.bankIfsc ? i.bankIfsc.toUpperCase() : null, status: i.status ?? "active",
    };
    let empId = id;
    if (empId) {
      const before = await tdb.one("SELECT * FROM employees WHERE tenant_id = :tenantId AND id = :id FOR UPDATE", { id: empId });
      if (!before) throw notFound("Employee");
      await tdb.exec(
        `UPDATE employees SET name = :name, mobile = :mobile, designation = :desig, department = :dept, branch_id = :branch, joining_date = :join, pan = :pan,
                uan = :uan, bank_ifsc = :ifsc, status = :status, bank_account_enc = :bank WHERE tenant_id = :tenantId AND id = :id`,
        { ...vals, id: empId, bank: i.bankAccount ? encrypt(i.bankAccount) : before.bank_account_enc },
      );
      const after = await tdb.one("SELECT * FROM employees WHERE tenant_id = :tenantId AND id = :id", { id: empId });
      await audit(tdb, ctx, { action: "update", entityType: "employee", entityId: empId, summary: `Updated employee ${i.name}`, before, after });
    } else {
      const n = await tdb.one("SELECT COUNT(*) AS n FROM employees WHERE tenant_id = :tenantId");
      const r = await tdb.exec(
        `INSERT INTO employees (tenant_id, code, name, mobile, designation, department, branch_id, joining_date, pan, uan, bank_ifsc, status, bank_account_enc)
         VALUES (:tenantId, :code, :name, :mobile, :desig, :dept, :branch, :join, :pan, :uan, :ifsc, :status, :bank)`,
        { ...vals, code: `EMP-${String(Number(n.n) + 1).padStart(3, "0")}`, bank: i.bankAccount ? encrypt(i.bankAccount) : null },
      );
      empId = r.insertId;
      await audit(tdb, ctx, { action: "create", entityType: "employee", entityId: empId, summary: `Added employee ${i.name}`, after: { name: i.name, designation: i.designation ?? null } });
    }
    await saveSalary(tdb, ctx, empId, i);
    return empId;
  });
  return empOut(ctx, await ctx.tdb.one(EMP_SQL + " AND e.id = :id", { id: eid }));
}

const daysIn = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();

/** Salary register for a month: every active employee with their structure and (if generated) payslip. */
export async function payrollMonth(ctx: TenantCtx, month: string) {
  const run = await ctx.tdb.one("SELECT * FROM payroll_runs WHERE tenant_id = :tenantId AND period_month = :m", { m: month });
  const emps = (await ctx.tdb.all(EMP_SQL + " AND e.status <> 'left' AND e.joining_date <= LAST_DAY(:d) ORDER BY e.name", { d: `${month}-01` })).map((e) => empOut({ ...ctx, permissions: new Set([...ctx.permissions, "payroll.view"]) } as TenantCtx, e));
  const slips = run ? await ctx.tdb.all("SELECT * FROM payslips WHERE tenant_id = :tenantId AND payroll_run_id = :r", { r: run.id }) : [];
  const byEmp = new Map(slips.map((s) => [Number(s.employee_id), s]));
  return {
    month, daysInMonth: daysIn(month),
    run: run ? { id: Number(run.id), status: run.status, totalGross: run.total_gross, totalNet: run.total_net } : null,
    rows: emps.map((e) => {
      const s = byEmp.get(e.id);
      return {
        employee: { id: e.id, code: e.code, name: e.name, designation: e.designation }, salary: e.salary,
        payslip: s ? { id: Number(s.id), paidDays: s.paid_days, gross: s.gross, totalDeductions: s.total_deductions, advanceRecovery: s.advance_recovery, netPay: s.net_pay, breakdown: json(s.breakdown, {}) } : null,
      };
    }),
  };
}

/** Generates (or re-generates while still a draft) the month's payslips. Pay is pro-rated by paid days. */
export async function runPayroll(ctx: TenantCtx, month: string, entries: { employeeId: number; paidDays: number; bonus?: number; otherDeduction?: number }[]) {
  const dim = daysIn(month);
  await withTx(async (conn) => {
    const tdb = new TenantDb(conn, ctx.tenantId);
    await tdb.exec("INSERT IGNORE INTO payroll_runs (tenant_id, period_month) VALUES (:tenantId, :m)", { m: month });
    const run = await tdb.one("SELECT * FROM payroll_runs WHERE tenant_id = :tenantId AND period_month = :m FOR UPDATE", { m: month });
    if (run.status !== "draft") throw conflict("payroll_locked", "This month's payroll is finalised and cannot be changed.");
    await tdb.exec("DELETE FROM payslips WHERE tenant_id = :tenantId AND payroll_run_id = :r", { r: run.id });
    let tg = dec(0), tn = dec(0);
    for (const en of entries) {
      if (en.paidDays < 0 || en.paidDays > dim) throw badRequest("invalid_days", `Paid days must be between 0 and ${dim}.`);
      const s = await tdb.one(
        `SELECT s.basic, s.components FROM salary_structures s JOIN employees e ON e.id = s.employee_id AND e.tenant_id = s.tenant_id
          WHERE s.tenant_id = :tenantId AND s.employee_id = :e ORDER BY s.effective_from DESC LIMIT 1`, { e: en.employeeId });
      if (!s) continue; // no salary set for this employee yet
      const c = json<any>(s.components, { allowances: [], deductions: [] });
      const f = dec(en.paidDays).div(dim);
      const pro = (v: unknown) => dec(String(v ?? 0)).mul(f).toDecimalPlaces(2);
      const basic = pro(s.basic);
      const allowances = (c.allowances ?? []).map((a: any) => ({ name: a.name, amount: pro(a.amount).toFixed(2) }));
      const deductions = (c.deductions ?? []).map((a: any) => ({ name: a.name, amount: pro(a.amount).toFixed(2) }));
      const bonus = dec(en.bonus ?? 0), other = dec(en.otherDeduction ?? 0);
      const gross = allowances.reduce((t: any, a: any) => t.plus(a.amount), basic).plus(bonus);
      const ded = deductions.reduce((t: any, a: any) => t.plus(a.amount), dec(0));
      const net = gross.minus(ded).minus(other);
      if (net.lt(0)) throw badRequest("negative_pay", "Deductions are more than the pay for one employee. Reduce the deduction.");
      await tdb.exec(
        `INSERT INTO payslips (tenant_id, payroll_run_id, employee_id, days_in_month, paid_days, gross, total_deductions, advance_recovery, net_pay, breakdown)
         VALUES (:tenantId, :r, :e, :dim, :pd, :g, :d, :adv, :net, :b)`,
        { r: run.id, e: en.employeeId, dim, pd: en.paidDays, g: gross.toFixed(2), d: ded.toFixed(2), adv: other.toFixed(2), net: net.toFixed(2),
          b: JSON.stringify({ basic: basic.toFixed(2), allowances, deductions, bonus: bonus.toFixed(2), otherDeduction: other.toFixed(2) }) },
      );
      tg = tg.plus(gross); tn = tn.plus(net);
    }
    await tdb.exec("UPDATE payroll_runs SET total_gross = :g, total_net = :n WHERE tenant_id = :tenantId AND id = :id", { g: tg.toFixed(2), n: tn.toFixed(2), id: run.id });
    await audit(tdb, ctx, { action: "create", entityType: "payroll_run", entityId: Number(run.id), summary: `Generated payroll for ${month}: net ₹${tn.toFixed(2)}`, after: { month, employees: entries.length, net: tn.toFixed(2) } });
  });
  return payrollMonth(ctx, month);
}

export async function finalisePayroll(ctx: TenantCtx, month: string) {
  const r = await ctx.tdb.exec("UPDATE payroll_runs SET status = 'finalised', finalised_by = :by, finalised_at = CURRENT_TIMESTAMP(3) WHERE tenant_id = :tenantId AND period_month = :m AND status = 'draft'", { m: month, by: ctx.userId });
  if (!r.affectedRows) throw conflict("payroll_locked", "Nothing to finalise for this month.");
  await audit(ctx.tdb, ctx, { action: "approve", entityType: "payroll_run", summary: `Finalised payroll for ${month}` });
  return payrollMonth(ctx, month);
}

export async function payslipForPdf(ctx: TenantCtx, id: number) {
  const s = await ctx.tdb.one(
    `SELECT p.*, r.period_month, e.name, e.code, e.designation, e.department, e.pan FROM payslips p
       JOIN payroll_runs r ON r.id = p.payroll_run_id AND r.tenant_id = p.tenant_id JOIN employees e ON e.id = p.employee_id AND e.tenant_id = p.tenant_id
      WHERE p.tenant_id = :tenantId AND p.id = :id`, { id });
  if (!s) throw notFound("Payslip");
  return {
    month: s.period_month, paidDays: s.paid_days, daysInMonth: s.days_in_month, gross: s.gross, totalDeductions: s.total_deductions, advanceRecovery: s.advance_recovery,
    netPay: s.net_pay, breakdown: json<any>(s.breakdown, {}), employee: { name: s.name, code: s.code, designation: s.designation, department: s.department, pan: s.pan },
  };
}
