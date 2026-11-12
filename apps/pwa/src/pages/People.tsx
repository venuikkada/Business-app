import { useEffect, useState } from "react";
import { Download, IdCard, Lock, Plus, Trash2, Wallet } from "lucide-react";
import { patch, post } from "../lib/api";
import { date, inr } from "../lib/format";
import { downloadPdf, useLoad } from "../lib/hooks";
import { useSession } from "../lib/session";
import { useErrorText } from "../i18n";
import { Banner, Empty, Input, Loading, Modal, Num, PageHead, Select } from "../components/ui";

interface Comp { name: string; amount: number }
const total = (s: any) => (s ? Number(s.basic) + s.allowances.reduce((a: number, c: any) => a + Number(c.amount), 0) : 0);

export function Employees() {
  const { can } = useSession();
  const { data, error, reload } = useLoad<any[]>("/employees");
  const [edit, setEdit] = useState<any | "new" | null>(null);
  return (
    <div>
      <PageHead title="Employees" sub={data ? `${data.filter((e) => e.status !== "left").length} working` : undefined}>
        {can("employees.create") && <button className="btn primary" onClick={() => setEdit("new")}><Plus className="ic" />Add employee</button>}
      </PageHead>
      <Banner>{error}</Banner>
      <div className="card flush">
        {!data ? <Loading /> : data.length === 0 ? <Empty icon={<IdCard />} title="No employees yet" text="Add staff details and their monthly salary to make payslips." /> : (
          <div className="scroll-x"><table className="table">
            <thead><tr><th>Employee</th><th>Role</th><th>Joined</th>{can("payroll.view") && <th className="num">Monthly salary</th>}<th>Status</th></tr></thead>
            <tbody>{data.map((e) => (
              <tr key={e.id} className={can("employees.edit") ? "click" : ""} onClick={() => can("employees.edit") && setEdit(e)}>
                <td><b>{e.name}</b><div className="muted small">{e.code}{e.mobile ? ` · ${e.mobile}` : ""}</div></td>
                <td>{e.designation ?? "—"}<div className="muted small">{e.department ?? ""}</div></td><td>{date(e.joiningDate)}</td>
                {can("payroll.view") && <td className="num">{e.salary ? inr(total(e.salary)) : <span className="muted small">Not set</span>}</td>}
                <td><span className={`badge ${e.status === "active" ? "ok" : e.status === "left" ? "gray" : "warn"}`}>{e.status === "on_notice" ? "On notice" : e.status === "left" ? "Left" : "Active"}</span></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
      {edit && <EmployeeForm emp={edit === "new" ? null : edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); reload(); }} />}
    </div>
  );
}

function CompRows({ title, rows, setRows, hint }: { title: string; rows: Comp[]; setRows: (r: Comp[]) => void; hint: string }) {
  return (
    <div className="stack">
      <div className="spread"><b className="small">{title}</b><button type="button" className="linkbtn small" onClick={() => setRows([...rows, { name: "", amount: 0 }])}>+ Add</button></div>
      {rows.length === 0 && <div className="muted small">{hint}</div>}
      {rows.map((r, i) => (
        <div className="row" key={i} style={{ flexWrap: "nowrap" }}>
          <input placeholder="Name" value={r.name} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
          <input type="number" placeholder="₹" style={{ width: 120 }} value={r.amount || ""} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, amount: Number(e.target.value) } : x)))} />
          <button type="button" className="iconbtn" style={{ border: 0, background: "none" }} aria-label="Remove" onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 className="ic" /></button>
        </div>
      ))}
    </div>
  );
}

function EmployeeForm({ emp, onClose, onDone }: { emp: any | null; onClose: () => void; onDone: () => void }) {
  const errText = useErrorText();
  const { can } = useSession();
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({
    name: emp?.name ?? "", mobile: emp?.mobile ?? "", designation: emp?.designation ?? "", department: emp?.department ?? "", joiningDate: emp?.joiningDate ?? today,
    pan: emp?.pan ?? "", uan: emp?.uan ?? "", bankAccount: "", bankIfsc: emp?.bankIfsc ?? "", status: emp?.status ?? "active",
  });
  const [basic, setBasic] = useState(Number(emp?.salary?.basic ?? 0));
  const [allow, setAllow] = useState<Comp[]>((emp?.salary?.allowances ?? []).map((c: any) => ({ name: c.name, amount: Number(c.amount) })));
  const [ded, setDed] = useState<Comp[]>((emp?.salary?.deductions ?? []).map((c: any) => ({ name: c.name, amount: Number(c.amount) })));
  const [error, setError] = useState("");
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p });
  const pay = can("payroll.run");
  const save = async () => {
    try {
      const body: any = { ...f, bankAccount: f.bankAccount || null };
      if (pay) Object.assign(body, { basic, allowances: allow.filter((c) => c.name.trim()), deductions: ded.filter((c) => c.name.trim()) });
      if (emp) await patch(`/employees/${emp.id}`, body); else await post("/employees", body);
      onDone();
    } catch (e) { setError(errText(e)); }
  };
  return (
    <Modal title={emp ? `${emp.name} (${emp.code})` : "Add employee"} onClose={onClose}>
      <div className="stack">
        <Banner>{error}</Banner>
        <div className="grid2">
          <Input label="Full name" value={f.name} onChange={(e) => set({ name: e.target.value })} autoFocus />
          <Input label="Mobile" inputMode="tel" value={f.mobile} onChange={(e) => set({ mobile: e.target.value })} />
          <Input label="Designation" value={f.designation} onChange={(e) => set({ designation: e.target.value })} placeholder="e.g. Sales executive" />
          <Input label="Department" value={f.department} onChange={(e) => set({ department: e.target.value })} />
          <Input label="Joining date" type="date" value={f.joiningDate} onChange={(e) => set({ joiningDate: e.target.value })} />
          <Select label="Status" value={f.status} onChange={(e) => set({ status: e.target.value })}><option value="active">Active</option><option value="on_notice">On notice</option><option value="left">Left</option></Select>
          <Input label="PAN" value={f.pan} onChange={(e) => set({ pan: e.target.value.toUpperCase().slice(0, 10) })} />
          <Input label="PF number (UAN)" inputMode="numeric" value={f.uan} onChange={(e) => set({ uan: e.target.value.replace(/\D/g, "").slice(0, 12) })} />
          <Input label={emp?.bankLast4 ? `Bank account (saved ••••${emp.bankLast4})` : "Bank account number"} inputMode="numeric" value={f.bankAccount} onChange={(e) => set({ bankAccount: e.target.value.replace(/\D/g, "") })} hint="Stored encrypted" />
          <Input label="IFSC" value={f.bankIfsc} onChange={(e) => set({ bankIfsc: e.target.value.toUpperCase().slice(0, 11) })} />
        </div>
        {pay && <>
          <h2 style={{ marginBottom: 0 }}>Monthly salary</h2>
          <Num label="Basic pay ₹" value={basic} onChange={setBasic} />
          <CompRows title="Allowances (added)" rows={allow} setRows={setAllow} hint="HRA, travel, mobile…" />
          <CompRows title="Deductions (cut every month)" rows={ded} setRows={setDed} hint="PF, ESI, professional tax…" />
          <div className="spread" style={{ fontWeight: 700 }}><span>Take-home for a full month</span><span>{inr(basic + allow.reduce((a, c) => a + c.amount, 0) - ded.reduce((a, c) => a + c.amount, 0))}</span></div>
        </>}
        <button className="btn primary block" onClick={save} disabled={!f.name.trim()}>Save employee</button>
      </div>
    </Modal>
  );
}

export function Payroll() {
  const errText = useErrorText();
  const { can } = useSession();
  const [month, setMonth] = useState(new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 7));
  const { data, error, setData } = useLoad<any>(`/payroll/${month}`);
  const [rows, setRows] = useState<Record<number, { paidDays: number; bonus: number; otherDeduction: number }>>({});
  const [msg, setMsg] = useState("");
  useEffect(() => {
    if (!data) return;
    setRows(Object.fromEntries(data.rows.map((r: any) => [r.employee.id, {
      paidDays: r.payslip ? Number(r.payslip.paidDays) : data.daysInMonth, bonus: Number(r.payslip?.breakdown?.bonus ?? 0), otherDeduction: Number(r.payslip?.advanceRecovery ?? 0),
    }])));
  }, [data]);
  if (!data) return error ? <Banner>{error}</Banner> : <Loading />;
  const locked = data.run && data.run.status !== "draft";
  const withSalary = data.rows.filter((r: any) => r.salary);
  const upd = (id: number, p: any) => setRows({ ...rows, [id]: { ...rows[id]!, ...p } });
  const run = async (fn: () => Promise<any>) => { setMsg(""); try { setData(await fn()); } catch (e) { setMsg(errText(e)); } };
  const generate = () => run(() => post(`/payroll/${month}`, { entries: withSalary.map((r: any) => ({ employeeId: r.employee.id, ...rows[r.employee.id] })) }));
  return (
    <div>
      <PageHead title="Salaries" sub={data.run ? `Total take-home ${inr(data.run.totalNet)} · ${locked ? "finalised" : "draft"}` : "Enter paid days, then generate payslips"}>
        <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} style={{ width: "auto" }} aria-label="Month" />
        {can("payroll.run") && !locked && <button className="btn primary" onClick={generate} disabled={!withSalary.length}><Wallet className="ic" />{data.run ? "Re-calculate" : "Generate payslips"}</button>}
        {can("payroll.run") && data.run && !locked && <button className="btn" onClick={() => confirm("Finalise this month? It cannot be changed after this.") && run(() => post(`/payroll/${month}/finalise`))}><Lock className="ic" />Finalise</button>}
      </PageHead>
      <Banner>{msg}</Banner>
      <div className="card flush">
        {data.rows.length === 0 ? <Empty icon={<Wallet />} title="No employees for this month" text="Add employees with a monthly salary first." /> : (
          <div className="scroll-x"><table className="table">
            <thead><tr><th>Employee</th><th className="num">Monthly pay</th><th>Paid days / {data.daysInMonth}</th><th>Bonus ₹</th><th>Advance / cut ₹</th><th className="num">Take-home</th><th /></tr></thead>
            <tbody>{data.rows.map((r: any) => {
              const v = rows[r.employee.id];
              const inp = (k: "paidDays" | "bonus" | "otherDeduction", step: string) => <input type="number" min="0" step={step} disabled={locked || !r.salary || !can("payroll.run")} style={{ width: 96, minHeight: 36, padding: "5px 9px" }} value={v?.[k] || (k === "paidDays" ? 0 : "")} onChange={(e) => upd(r.employee.id, { [k]: Number(e.target.value) })} aria-label={k} />;
              return (
                <tr key={r.employee.id}>
                  <td><b>{r.employee.name}</b><div className="muted small">{r.employee.code} · {r.employee.designation ?? ""}</div></td>
                  <td className="num">{r.salary ? inr(total(r.salary)) : <span className="badge warn">Salary not set</span>}</td>
                  <td>{inp("paidDays", "0.5")}</td><td>{inp("bonus", "1")}</td><td>{inp("otherDeduction", "1")}</td>
                  <td className="num">{r.payslip ? <b>{inr(r.payslip.netPay)}</b> : "—"}</td>
                  <td className="num">{r.payslip && <button className="btn small" onClick={() => downloadPdf(`/payslips/${r.payslip.id}/pdf`, `payslip-${r.employee.code}-${month}`).catch((e) => setMsg(e.message))}><Download className="ic" />Payslip</button>}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}
