import { useEffect, useState, type FormEvent } from "react";
import { post } from "../lib/api";
import { useSession } from "../lib/session";
import { useErrorText, useT } from "../i18n";
import { Banner, Input } from "../components/ui";
import { LanguagePicker } from "../components/LanguagePicker";

type Mode = "otp" | "password" | "reset";

export function Login() {
  const t = useT();
  const errText = useErrorText();
  const { reload } = useSession();
  const [mode, setMode] = useState<Mode>("otp");
  const [mobile, setMobile] = useState("");
  const [name, setName] = useState("");
  const [otp, setOtp] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (wait <= 0) return;
    const id = window.setTimeout(() => setWait(wait - 1), 1000);
    return () => window.clearTimeout(id);
  }, [wait]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const sendOtp = (purpose: "login" | "reset_password") =>
    run(async () => {
      const r = await post("/auth/otp/request", { mobile, purpose });
      setSentTo(r.mobile);
      setWait(r.resendAfter);
      setOtp("");
    });

  const verify = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      await post("/auth/otp/verify", { mobile, otp, name: name || undefined });
      await reload();
    });
  };

  const passwordLogin = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      await post("/auth/login", { identifier, password });
      await reload();
    });
  };

  const reset = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      await post("/auth/password/reset", { mobile, otp, newPassword });
      setInfo(t("login.resetDone"));
      setMode("password");
      setIdentifier(mobile);
      setSentTo(null);
    });
  };

  const switchMode = (m: Mode) => {
    setMode(m);
    setError("");
    setInfo("");
    setSentTo(null);
  };

  return (
    <div className="auth">
      <div className="card stack">
        <div className="spread">
          <div className="brandmark">
            <img src="/icons/icon-192.png" alt="" />
            <div>
              <strong>{t("app.name")}</strong>
              <div className="muted small">{t("app.tagline")}</div>
            </div>
          </div>
          <LanguagePicker compact />
        </div>

        {mode !== "reset" && (
          <div className="tabs" role="tablist">
            <button className={mode === "otp" ? "on" : ""} onClick={() => switchMode("otp")} role="tab">{t("login.tabOtp")}</button>
            <button className={mode === "password" ? "on" : ""} onClick={() => switchMode("password")} role="tab">{t("login.tabPassword")}</button>
          </div>
        )}
        <Banner>{error}</Banner>
        <Banner kind="ok">{info}</Banner>

        {mode === "otp" && !sentTo && (
          <form className="stack" onSubmit={(e) => (e.preventDefault(), sendOtp("login"))}>
            <h1>{t("login.title")}</h1>
            <p className="muted">{t("login.subtitle")}</p>
            <Input label={t("login.mobile")} hint={t("login.mobileHint")} inputMode="tel" autoComplete="tel" value={mobile} onChange={(e) => setMobile(e.target.value)} required maxLength={14} placeholder="98765 43210" />
            <button className="btn primary block" disabled={busy}>{t("login.sendOtp")}</button>
          </form>
        )}

        {mode === "otp" && sentTo && (
          <form className="stack" onSubmit={verify}>
            <p className="muted">{t("login.otpSentTo", { mobile: sentTo })}</p>
            <Input label={t("login.otp")} className="otp-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))} required autoFocus />
            <Input label={`${t("login.yourName")} (${t("common.optional")})`} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
            <button className="btn primary block" disabled={busy || otp.length !== 6}>{t("login.verify")}</button>
            <div className="spread small">
              <button type="button" className="linkbtn" onClick={() => setSentTo(null)}>{t("login.changeNumber")}</button>
              {wait > 0 ? <span className="muted">{t("login.resendIn", { s: wait })}</span> : <button type="button" className="linkbtn" onClick={() => sendOtp("login")}>{t("login.resend")}</button>}
            </div>
          </form>
        )}

        {mode === "password" && (
          <form className="stack" onSubmit={passwordLogin}>
            <Input label={t("login.identifier")} autoComplete="username" value={identifier} onChange={(e) => setIdentifier(e.target.value)} required />
            <Input label={t("login.password")} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            <button className="btn primary block" disabled={busy}>{t("login.signIn")}</button>
            <button type="button" className="linkbtn small" onClick={() => switchMode("reset")}>{t("login.forgot")}</button>
          </form>
        )}

        {mode === "reset" && (
          <form className="stack" onSubmit={sentTo ? reset : (e) => (e.preventDefault(), sendOtp("reset_password"))}>
            <h1>{t("login.resetTitle")}</h1>
            <Input label={t("login.mobile")} inputMode="tel" value={mobile} onChange={(e) => setMobile(e.target.value)} required disabled={!!sentTo} />
            {sentTo && (
              <>
                <p className="muted small">{t("login.otpSentTo", { mobile: sentTo })}</p>
                <Input label={t("login.otp")} className="otp-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))} required />
                <Input label={t("login.newPassword")} hint={t("login.passwordRule")} type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={8} />
              </>
            )}
            <button className="btn primary block" disabled={busy}>{sentTo ? t("common.save") : t("login.sendOtp")}</button>
            <button type="button" className="linkbtn small" onClick={() => switchMode("password")}>{t("common.back")}</button>
          </form>
        )}
      </div>
    </div>
  );
}
