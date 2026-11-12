import { Link, useNavigate } from "react-router-dom";
import { useSession } from "../lib/session";
import { useErrorText, useT } from "../i18n";
import { useState } from "react";
import { Banner } from "../components/ui";

export function PickBusiness() {
  const t = useT();
  const errText = useErrorText();
  const nav = useNavigate();
  const { me, openBusiness, signOut } = useSession();
  const [error, setError] = useState("");
  return (
    <div className="auth" style={{ gridTemplateColumns: "1fr" }}>
      <div className="pane"><div className="card stack">
        <h1>{t("pick.title")}</h1>
        <Banner>{error}</Banner>
        <ul className="list">
          {me?.businesses.map((b) => (
            <li key={b.id}>
              <button
                className="btn block"
                style={{ justifyContent: "space-between" }}
                onClick={() => openBusiness(b.id).then(() => nav("/")).catch((e) => setError(errText(e)))}
              >
                <span>{b.name}</span>
                <span className="badge">{b.role.name}</span>
              </button>
              <div className="muted small" style={{ marginTop: 4 }}>{t(`sector.${b.sector}`)}</div>
            </li>
          ))}
        </ul>
        <Link className="btn block" to="/onboarding">+ {t("nav.addBusiness")}</Link>
        <button className="linkbtn small" onClick={signOut}>{t("nav.logout")}</button>
      </div></div>
    </div>
  );
}
