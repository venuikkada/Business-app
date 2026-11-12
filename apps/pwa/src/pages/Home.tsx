import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { get } from "../lib/api";
import { date, dateTime } from "../lib/format";
import { useSession } from "../lib/session";
import { useLive } from "../components/Layout";
import { useT } from "../i18n";
import { Banner } from "../components/ui";

export function Home() {
  const t = useT();
  const { me, current, can } = useSession();
  const live = useLive();
  const [recent, setRecent] = useState<any[]>([]);
  const tenant = current!.tenant;

  useEffect(() => {
    if (can("audit.view")) get("/audit-logs?limit=5").then((r) => setRecent(r.items)).catch(() => {});
  }, [can, live?.changeCursor]);

  const sub = tenant.subscriptionStatus;
  return (
    <div className="stack">
      <h1>{t("home.welcome", { name: me?.user.name || "" })}</h1>
      {sub === "trial" && <Banner kind="ok">{t("home.trialEnds", { date: date(tenant.subscriptionEndsAt) })}</Banner>}
      {sub === "grace" && <Banner kind="warn">{t("home.planGrace")}</Banner>}
      {sub === "expired" && <Banner kind="error">{t("home.planExpired")}</Banner>}

      <div className="card">
        <div className="spread">
          <div>
            <div className="muted small">{t("home.businessCard")}</div>
            <h2 style={{ margin: 0 }}>{tenant.name}</h2>
            <div className="muted small">
              {t(`sector.${tenant.sector}`)}
              {tenant.gstin ? ` · GSTIN ${tenant.gstin}` : ""}
            </div>
          </div>
          <span className="badge">{current!.me.role.name}</span>
        </div>
        <p className="muted small" style={{ marginTop: 10, marginBottom: 0 }}>
          {t("settings.branches")}: {current!.branches.map((b: any) => b.name).join(", ")}
        </p>
      </div>

      <div className="card">
        <h2>{t("home.nextSteps")}</h2>
        <ul className="list">
          {can("team.invite") && <li><Link to="/team">👥 {t("home.stepTeam")}</Link></li>}
          {can("settings.edit") && <li><Link to="/settings">⚙️ {t("home.stepSettings")}</Link></li>}
          {can("roles.manage") && <li><Link to="/roles">🔐 {t("home.stepRoles")}</Link></li>}
        </ul>
        <Banner kind="warn">{t("home.comingNext")}</Banner>
      </div>

      {recent.length > 0 && (
        <div className="card">
          <div className="spread">
            <h2>{t("home.recent")}</h2>
            <Link to="/audit" className="small">{t("nav.audit")} →</Link>
          </div>
          <ul className="list">
            {recent.map((a) => (
              <li key={a.id}>
                <div>{a.summary}</div>
                <div className="muted small">{a.userName} · {dateTime(a.createdAt)}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
