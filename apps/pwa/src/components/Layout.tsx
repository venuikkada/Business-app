import { createContext, useContext, useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Bell, Boxes, ChevronDown, FileText, History, IdCard, LayoutDashboard, Menu, Package, Plus, ReceiptText, Settings, ShieldCheck, UserCog, UserRound, Users, Wallet } from "lucide-react";
import { useSession } from "../lib/session";
import { usePoll, type PollState } from "../lib/poll";
import { useT } from "../i18n";
import { Banner, Modal } from "./ui";

const PollCtx = createContext<PollState | null>(null);
/** Screens read this to refresh when someone else changes data (every ~15 s). */
export const useLive = () => useContext(PollCtx);

const NAV = [
  { group: "nav.business", to: "/", icon: LayoutDashboard, key: "nav.dashboard", perm: null },
  { to: "/invoices", icon: ReceiptText, key: "nav.invoices", perm: "sales.view" },
  { to: "/quotations", icon: FileText, key: "nav.quotations", perm: "sales.view" },
  { to: "/customers", icon: Users, key: "nav.customers", perm: "parties.view" },
  { to: "/items", icon: Package, key: "nav.items", perm: "items.view" },
  { to: "/stock", icon: Boxes, key: "nav.stock", perm: "stock.view" },
  { group: "nav.people", to: "/employees", icon: IdCard, key: "nav.employees", perm: "employees.view" },
  { to: "/payroll", icon: Wallet, key: "nav.payroll", perm: "payroll.view" },
  { group: "nav.admin", to: "/team", icon: UserCog, key: "nav.team", perm: "team.view" },
  { to: "/roles", icon: ShieldCheck, key: "nav.roles", perm: "roles.view" },
  { to: "/audit", icon: History, key: "nav.audit", perm: "audit.view" },
  { to: "/settings", icon: Settings, key: "nav.settings", perm: "settings.view" },
  { to: "/account", icon: UserRound, key: "nav.account", perm: null },
] as const;

export function Layout() {
  const t = useT();
  const nav = useNavigate();
  const loc = useLocation();
  const { current, can, me, reload, reloadCurrent } = useSession();
  // Lost access to this business -> reload my profile and business list.
  const poll = usePoll(!!current, () => reload().catch(() => {}));
  // Someone changed something (maybe my role or branches): refresh my permissions quietly.
  const cursor = poll?.changeCursor;
  useEffect(() => {
    if (cursor !== undefined) reloadCurrent().catch(() => {});
  }, [cursor, reloadCurrent]);
  const [online, setOnline] = useState(navigator.onLine);
  const [more, setMore] = useState(false);
  useEffect(() => setMore(false), [loc.pathname]);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  const items = NAV.filter((n) => !n.perm || can(n.perm));
  const multi = (me?.businesses.length ?? 0) > 1;
  const initials = (me?.user.name || "U").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const mobile = items.filter((n) => ["/", "/invoices", "/items"].includes(n.to));

  return (
    <PollCtx.Provider value={poll}>
      <div className="shell">
        <aside className="sidebar">
          <div className="brand"><span className="logo-chip">CB</span>{t("app.name")}</div>
          {can("sales.create") && <NavLink to="/invoices/new" className="cta"><Plus className="ic" />{t("nav.newInvoice")}</NavLink>}
          {items.map((n) => (
            <div key={n.to}>
              {"group" in n && <div className="group">{t(n.group)}</div>}
              <NavLink to={n.to} end={n.to === "/"}><n.icon className="ic" />{t(n.key)}</NavLink>
            </div>
          ))}
        </aside>
        <div className="main">
          <header className="topbar">
            <button className="biz" onClick={() => nav("/switch")} title={t("nav.switchBusiness")}>
              <span className="logo-chip">{(current?.tenant.name ?? "B").slice(0, 2).toUpperCase()}</span>
              <span>{current?.tenant.name}</span>
              {multi && <ChevronDown className="ic" />}
            </button>
            <button className="iconbtn" onClick={() => nav("/notifications")} aria-label={t("nav.notifications")}>
              <Bell className="ic" />
              {poll && poll.unreadNotifications > 0 && <span className="dot">{poll.unreadNotifications > 99 ? "99+" : poll.unreadNotifications}</span>}
            </button>
            <button className="avatar" style={{ border: 0, cursor: "pointer" }} onClick={() => nav("/account")} aria-label={t("nav.account")}>{initials}</button>
          </header>
          {!online && <div style={{ padding: "8px 16px" }}><Banner kind="warn">{t("common.offline")}</Banner></div>}
          <main className="content"><Outlet /></main>
        </div>
        <nav className="bottomnav" aria-label="Main">
          {mobile.slice(0, 2).map((n) => <NavLink key={n.to} to={n.to} end={n.to === "/"}><n.icon className="ic" />{t(n.key)}</NavLink>)}
          {can("sales.create") && <button className="fab" onClick={() => nav("/invoices/new")} aria-label={t("nav.newInvoice")}><Plus /></button>}
          {mobile.slice(2).map((n) => <NavLink key={n.to} to={n.to}><n.icon className="ic" />{t(n.key)}</NavLink>)}
          <button onClick={() => setMore(true)}><Menu className="ic" />{t("nav.more")}</button>
        </nav>
        {more && (
          <Modal title={t("nav.more")} onClose={() => setMore(false)}>
            <div className="more-grid">
              {items.map((n) => <NavLink key={n.to} to={n.to} end={n.to === "/"}><n.icon />{t(n.key)}</NavLink>)}
            </div>
          </Modal>
        )}
      </div>
    </PollCtx.Provider>
  );
}
