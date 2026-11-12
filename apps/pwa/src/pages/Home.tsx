import { Link, useNavigate } from "react-router-dom";
import { AlertTriangle, FileText, IndianRupee, Package, Plus, ReceiptText, TrendingUp, Users, Wallet } from "lucide-react";
import { date, inr } from "../lib/format";
import { useLoad } from "../lib/hooks";
import { useSession } from "../lib/session";
import { useLive } from "../components/Layout";
import { useT } from "../i18n";
import { Banner, Empty, StatusBadge } from "../components/ui";

interface Dash {
  today: string; todayCount: number; month: string; receivable: string; unpaidCount: number;
  week: { date: string; total: string }[];
  recent: { id: number; number: string; date: string; customer: string; total: string; status: string }[];
  lowStock: { id: number; name: string; qty: string; unit: string }[];
  counts: { items: number; parties: number; employees: number; openQuotations: number };
}

export function Home() {
  const t = useT();
  const nav = useNavigate();
  const { me, current, can } = useSession();
  const live = useLive();
  const { data: d } = useLoad<Dash>("/dashboard", [live?.changeCursor]);
  const tenant = current!.tenant;
  const sub = tenant.subscriptionStatus;
  const max = Math.max(1, ...(d?.week ?? []).map((w) => Number(w.total)));
  const dayName = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", timeZone: "UTC" });

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>{t("home.welcome", { name: (me?.user.name || "").split(" ")[0] ?? "" })} 👋</h1>
          <div className="muted small">{tenant.name} · {current!.me.role.name}</div>
        </div>
        <div className="row">
          {can("sales.create") && <Link className="btn" to="/quotations/new"><FileText className="ic" />New quotation</Link>}
          {can("sales.create") && <Link className="btn primary" to="/invoices/new"><Plus className="ic" />{t("nav.newInvoice")}</Link>}
        </div>
      </div>
      {sub === "trial" && <Banner kind="ok">{t("home.trialEnds", { date: date(tenant.subscriptionEndsAt) })}</Banner>}
      {sub === "grace" && <Banner kind="warn">{t("home.planGrace")}</Banner>}
      {sub === "expired" && <Banner kind="error">{t("home.planExpired")}</Banner>}

      <div className="stat-grid">
        <div className="stat"><div className="chip c-indigo"><IndianRupee className="ic" /></div><div className="label">Today's sales</div><div className="value">{inr(d?.today ?? 0)}</div><div className="sub">{d?.todayCount ?? 0} invoices</div></div>
        <div className="stat"><div className="chip c-green"><TrendingUp className="ic" /></div><div className="label">This month</div><div className="value">{inr(d?.month ?? 0)}</div><div className="sub">all branches you can see</div></div>
        <div className="stat"><div className="chip c-amber"><Wallet className="ic" /></div><div className="label">To collect</div><div className="value">{inr(d?.receivable ?? 0)}</div><div className="sub">{d?.unpaidCount ?? 0} unpaid invoices</div></div>
        <div className="stat"><div className="chip c-rose"><AlertTriangle className="ic" /></div><div className="label">Low stock</div><div className="value">{d?.lowStock.length ?? 0}</div><div className="sub">items to reorder</div></div>
      </div>

      <div className="grid2" style={{ alignItems: "start" }}>
        <div className="card">
          <div className="spread"><h2>Sales — last 7 days</h2><span className="muted small">{inr((d?.week ?? []).reduce((a, w) => a + Number(w.total), 0))}</span></div>
          <div className="bars">
            {(d?.week ?? []).map((w) => (
              <div key={w.date} className={`bar ${Number(w.total) ? "" : "zero"}`} title={`${date(w.date)}: ${inr(w.total)}`}>
                <i style={{ height: `${Math.max(3, (Number(w.total) / max) * 100)}%` }} />
                <span>{dayName(w.date)}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <h2>Your business</h2>
          <div className="grid2">
            {[["Items", d?.counts.items, "/items", Package, "c-sky"], ["Customers", d?.counts.parties, "/customers", Users, "c-indigo"], ["Open quotations", d?.counts.openQuotations, "/quotations", FileText, "c-amber"], ["Employees", d?.counts.employees, "/employees", Users, "c-green"]].map(([label, n, to, Icon, c]: any) => (
              <Link key={label} to={to} className="row" style={{ color: "inherit", padding: "8px 0" }}>
                <span className={`chip ${c}`} style={{ width: 36, height: 36, borderRadius: 10, display: "grid", placeItems: "center" }}><Icon className="ic" /></span>
                <span><b style={{ fontSize: "1.1rem" }}>{n ?? 0}</b><div className="muted small">{label}</div></span>
              </Link>
            ))}
          </div>
        </div>
      </div>

      <div className="grid2" style={{ alignItems: "start" }}>
        <div className="card flush">
          <div className="spread" style={{ padding: "16px 18px 8px" }}><h2 style={{ margin: 0 }}>Recent invoices</h2><Link to="/invoices" className="small">View all →</Link></div>
          {d && d.recent.length === 0 ? (
            <Empty icon={<ReceiptText />} title="No invoices yet" text="Create your first GST invoice in under a minute.">
              {can("sales.create") && <Link className="btn primary small" to="/invoices/new">Create invoice</Link>}
            </Empty>
          ) : (
            <table className="table"><tbody>
              {d?.recent.map((r) => (
                <tr key={r.id} className="click" onClick={() => nav(`/sales/${r.id}`)}>
                  <td><b>{r.number}</b><div className="muted small">{r.customer} · {date(r.date)}</div></td>
                  <td className="num"><b>{inr(r.total)}</b><div><StatusBadge status={r.status} /></div></td>
                </tr>
              ))}
            </tbody></table>
          )}
        </div>
        <div className="card flush">
          <div className="spread" style={{ padding: "16px 18px 8px" }}><h2 style={{ margin: 0 }}>Low stock</h2><Link to="/stock" className="small">Stock →</Link></div>
          {d && d.lowStock.length === 0 ? <Empty icon={<Package />} title="Stock looks fine" text="Items at or below their reorder level show here." /> : (
            <table className="table"><tbody>
              {d?.lowStock.map((i) => <tr key={i.id}><td>{i.name}</td><td className="num"><span className="badge bad">{Number(i.qty)} {i.unit} left</span></td></tr>)}
            </tbody></table>
          )}
        </div>
      </div>
    </div>
  );
}
