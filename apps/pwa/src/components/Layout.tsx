import { createContext, useContext, useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useSession } from "../lib/session";
import { usePoll, type PollState } from "../lib/poll";
import { useT } from "../i18n";
import { Banner } from "./ui";

const PollCtx = createContext<PollState | null>(null);
/** Screens read this to refresh when someone else changes data (every ~15 s). */
export const useLive = () => useContext(PollCtx);

const NAV = [
  { to: "/", icon: "🏠", key: "nav.home", perm: null },
  { to: "/team", icon: "👥", key: "nav.team", perm: "team.view" },
  { to: "/roles", icon: "🔐", key: "nav.roles", perm: "roles.view" },
  { to: "/audit", icon: "📜", key: "nav.audit", perm: "audit.view" },
  { to: "/settings", icon: "⚙️", key: "nav.settings", perm: "settings.view" },
  { to: "/account", icon: "👤", key: "nav.account", perm: null },
];

export function Layout() {
  const t = useT();
  const nav = useNavigate();
  const { current, can, me, reload, reloadCurrent } = useSession();
  // Lost access to this business -> reload my profile and business list.
  const poll = usePoll(!!current, () => reload().catch(() => {}));
  // Someone changed something (maybe my role or branches): refresh my permissions quietly.
  const cursor = poll?.changeCursor;
  useEffect(() => {
    if (cursor !== undefined) reloadCurrent().catch(() => {});
  }, [cursor, reloadCurrent]);
  const [online, setOnline] = useState(navigator.onLine);
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

  return (
    <PollCtx.Provider value={poll}>
      <div className="shell">
        <header className="topbar">
          <button className="biz" onClick={() => nav("/switch")} title={t("nav.switchBusiness")}>
            {current?.tenant.name} {multi ? "▾" : ""}
          </button>
          <button className="bell" onClick={() => nav("/notifications")} aria-label={t("nav.notifications")}>
            🔔{poll && poll.unreadNotifications > 0 && <span className="dot">{poll.unreadNotifications > 99 ? "99+" : poll.unreadNotifications}</span>}
          </button>
        </header>
        {!online && <div style={{ padding: "8px 16px" }}><Banner kind="warn">{t("common.offline")}</Banner></div>}
        <div className="layout">
          <nav className="sidenav" aria-label="Main">
            {items.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.to === "/"}>
                <span>{n.icon}</span>
                {t(n.key)}
              </NavLink>
            ))}
          </nav>
          <main className="content">
            <Outlet />
          </main>
        </div>
        <nav className="bottomnav" aria-label="Main">
          {items.slice(0, 5).map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === "/"}>
              <span className="ic">{n.icon}</span>
              {t(n.key)}
            </NavLink>
          ))}
          {items.length > 5 && (
            <NavLink to="/account">
              <span className="ic">👤</span>
              {t("nav.account")}
            </NavLink>
          )}
        </nav>
      </div>
    </PollCtx.Provider>
  );
}
