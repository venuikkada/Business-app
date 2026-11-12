import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { del, get, patch, post } from "../lib/api";
import { dateTime, deviceName, phone } from "../lib/format";
import { useSession } from "../lib/session";
import { useErrorText, useT } from "../i18n";
import { Banner, Input } from "../components/ui";
import { LanguagePicker } from "../components/LanguagePicker";

interface Device { id: number; userAgent: string | null; ip: string | null; lastSeenAt: string; current: boolean }

export function Account() {
  const t = useT();
  const errText = useErrorText();
  const { me, reload, signOut } = useSession();
  const [name, setName] = useState(me?.user.name ?? "");
  const [email, setEmail] = useState(me?.user.email ?? "");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [devices, setDevices] = useState<Device[]>([]);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const loadDevices = () => get<Device[]>("/me/sessions").then(setDevices).catch(() => {});
  useEffect(() => {
    loadDevices();
  }, []);

  const run = async (fn: () => Promise<unknown>) => {
    setMsg(null);
    try {
      await fn();
      setMsg({ kind: "ok", text: t("common.saved") });
    } catch (e) {
      setMsg({ kind: "error", text: errText(e) });
    }
  };

  const saveProfile = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      await patch("/me", { name, email: email || null });
      await reload();
    });
  };
  const savePassword = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      await post("/me/password", { currentPassword: current || undefined, newPassword: next });
      setCurrent("");
      setNext("");
      await reload();
      loadDevices();
    });
  };

  return (
    <div className="stack">
      <h1>{t("account.title")}</h1>
      {msg && <Banner kind={msg.kind}>{msg.text}</Banner>}
      <form className="card stack" onSubmit={saveProfile}>
        <h2>{t("account.profile")}</h2>
        <Input label={t("team.name")} value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
        <Input label={t("login.mobile")} value={phone(me?.user.mobile)} disabled />
        <Input label={`${t("settings.email")} (${t("common.optional")})`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <label className="field">
          <span>{t("lang.label")}</span>
          <LanguagePicker saveToProfile />
        </label>
        <button className="btn primary">{t("common.save")}</button>
      </form>

      <form className="card stack" onSubmit={savePassword}>
        <h2>{t("account.password")}</h2>
        <p className="muted small">{t("account.passwordHelp")}</p>
        {me?.user.hasPassword && <Input label={t("account.currentPassword")} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />}
        <Input label={t("login.newPassword")} hint={t("login.passwordRule")} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={8} />
        <button className="btn">{me?.user.hasPassword ? t("account.changePassword") : t("account.setPassword")}</button>
      </form>

      <div className="card stack">
        <h2>{t("account.devices")}</h2>
        <ul className="list">
          {devices.map((d) => (
            <li key={d.id} className="spread">
              <div>
                <strong>{deviceName(d.userAgent)}</strong> {d.current && <span className="badge ok">{t("account.thisDevice")}</span>}
                <div className="muted small">{t("account.lastActive", { time: dateTime(d.lastSeenAt) })} · {d.ip}</div>
              </div>
              {!d.current && <button className="btn small" onClick={() => del(`/me/sessions/${d.id}`).then(loadDevices)}>{t("account.signOutDevice")}</button>}
            </li>
          ))}
        </ul>
        {devices.length > 1 && <button className="btn" onClick={() => post("/me/sessions/revoke-others").then(loadDevices)}>{t("account.signOutOthers")}</button>}
      </div>

      <div className="card stack">
        <Link className="btn block" to="/switch">{t("nav.switchBusiness")}</Link>
        <button className="btn block danger" onClick={signOut}>{t("nav.logout")}</button>
      </div>
    </div>
  );
}
