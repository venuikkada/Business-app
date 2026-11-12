import { useEffect, useState, type FormEvent } from "react";
import { validateGSTIN } from "@cba/core";
import { api, get, patch, post } from "../lib/api";
import { useSession } from "../lib/session";
import { useErrorText, useT } from "../i18n";
import { Banner, Input, Modal, Select, fieldErrors } from "../components/ui";

export function Settings() {
  const t = useT();
  const { can } = useSession();
  return (
    <div className="stack">
      <h1>{t("settings.title")}</h1>
      <BusinessForm />
      <Branches />
      {can("settings.view") && <Numbering />}
    </div>
  );
}

function BusinessForm() {
  const t = useT();
  const errText = useErrorText();
  const { current, can, reloadCurrent } = useSession();
  const tn = current!.tenant;
  const [f, setF] = useState({
    name: tn.name ?? "", legalName: tn.legalName ?? "", gstin: tn.gstin ?? "", pan: tn.pan ?? "", stateCode: tn.stateCode ?? "",
    addressLine1: tn.addressLine1 ?? "", addressLine2: tn.addressLine2 ?? "", city: tn.city ?? "", pincode: tn.pincode ?? "",
    phone: tn.phone ?? "", email: tn.email ?? "", aggregateTurnoverBand: tn.aggregateTurnoverBand ?? "",
  });
  const [states, setStates] = useState<{ code: string; name: string }[]>([]);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const editable = can("settings.edit");
  useEffect(() => {
    get("/meta").then((m) => setStates(m.states)).catch(() => {});
  }, []);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const gst = f.gstin ? validateGSTIN(f.gstin) : null;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    setErrs({});
    try {
      await patch("/tenant", { ...f, aggregateTurnoverBand: f.aggregateTurnoverBand || null });
      await reloadCurrent();
      setMsg({ kind: "ok", text: t("common.saved") });
    } catch (e2) {
      setMsg({ kind: "error", text: errText(e2) });
      setErrs(fieldErrors(e2));
    } finally {
      setBusy(false);
    }
  };
  const uploadLogo = async (file: File | undefined) => {
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    try {
      await api("POST", "/tenant/logo", fd);
      await reloadCurrent();
      setMsg({ kind: "ok", text: t("common.saved") });
    } catch (e) {
      setMsg({ kind: "error", text: errText(e) });
    }
  };

  return (
    <form className="card stack" onSubmit={save}>
      <h2>{t("settings.business")}</h2>
      {msg && <Banner kind={msg.kind}>{msg.text}</Banner>}
      <div className="row">
        {tn.logoFileId && <img src={`/api/v1/files/${tn.logoFileId}`} alt="" style={{ width: 64, height: 64, objectFit: "contain", borderRadius: 8, border: "1px solid var(--line)" }} />}
        {editable && (
          <label className="btn small">
            {t("settings.uploadLogo")}
            <input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => uploadLogo(e.target.files?.[0])} />
          </label>
        )}
      </div>
      <fieldset disabled={!editable} className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="grid2">
          <Input label={t("onb.businessName")} value={f.name} onChange={set("name")} required error={errs.name} />
          <Input label={t("settings.legalName")} value={f.legalName} onChange={set("legalName")} />
          <Input label={t("onb.gstin")} value={f.gstin} onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase().slice(0, 15) })} error={errs.gstin} hint={gst && !gst.valid ? gst.reason : undefined} />
          <Input label={t("settings.pan")} value={f.pan} onChange={(e) => setF({ ...f, pan: e.target.value.toUpperCase().slice(0, 10) })} error={errs.pan} />
          <Select label={t("onb.state")} value={f.stateCode} onChange={set("stateCode")}>
            {states.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
          </Select>
          <Input label={t("onb.city")} value={f.city} onChange={set("city")} />
          <Input label={t("settings.address")} value={f.addressLine1} onChange={set("addressLine1")} />
          <Input label={t("settings.pincode")} inputMode="numeric" value={f.pincode} onChange={set("pincode")} error={errs.pincode} />
          <Input label={t("settings.phone")} inputMode="tel" value={f.phone} onChange={set("phone")} />
          <Input label={t("settings.email")} type="email" value={f.email} onChange={set("email")} error={errs.email} />
        </div>
        <Select label={t("settings.turnover")} value={f.aggregateTurnoverBand} onChange={set("aggregateTurnoverBand")}>
          <option value="">—</option>
          {["below_5cr", "5cr_to_20cr", "above_20cr"].map((b) => <option key={b} value={b}>{t(`settings.turnover.${b}`)}</option>)}
        </Select>
        {f.aggregateTurnoverBand && f.aggregateTurnoverBand !== "below_5cr" && <Banner kind="warn">{t("settings.einvoiceNote")}</Banner>}
        {editable && <button className="btn primary" disabled={busy}>{busy ? t("common.saving") : t("common.save")}</button>}
      </fieldset>
    </form>
  );
}

function Branches() {
  const t = useT();
  const errText = useErrorText();
  const { current, can, reloadCurrent } = useSession();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const add = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await post("/branches", { name, stateCode: current!.tenant.stateCode, city: current!.tenant.city });
      setAdding(false);
      setName("");
      await reloadCurrent();
    } catch (e2) {
      setError(errText(e2));
    }
  };
  const update = async (id: number, body: object) => {
    try {
      await patch(`/branches/${id}`, body);
      await reloadCurrent();
    } catch (e) {
      setError(errText(e));
    }
  };
  return (
    <div className="card stack">
      <div className="spread">
        <h2>{t("settings.branches")}</h2>
        {can("settings.edit") && <button className="btn small" onClick={() => setAdding(true)}>+ {t("settings.addBranch")}</button>}
      </div>
      <Banner>{error}</Banner>
      <ul className="list">
        {current!.branches.map((b: any) => (
          <li key={b.id} className="spread">
            <div>
              <strong>{b.name}</strong> <span className="muted small">({b.code})</span> {b.isDefault && <span className="badge">{t("settings.main")}</span>}{" "}
              {!b.isActive && <span className="badge bad">{t("settings.closed")}</span>}
              <div className="muted small">{[b.city, b.gstin].filter(Boolean).join(" · ")}</div>
            </div>
            {can("settings.edit") && !b.isDefault && (
              <div className="row">
                <button className="btn small" onClick={() => update(b.id, { isDefault: true })}>{t("settings.makeMain")}</button>
                <button className="btn small" onClick={() => update(b.id, { isActive: !b.isActive })}>{b.isActive ? t("settings.closeBranch") : t("settings.reopen")}</button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {adding && (
        <Modal title={t("settings.addBranch")} onClose={() => setAdding(false)}>
          <form className="stack" onSubmit={add}>
            <Input label={t("onb.branchName")} value={name} onChange={(e) => setName(e.target.value)} required minLength={2} autoFocus />
            <button className="btn primary block">{t("common.add")}</button>
          </form>
        </Modal>
      )}
    </div>
  );
}

interface Series { id: number; branchName: string; docType: string; fy: string; prefix: string; nextNumber: number; padding: number }

function Numbering() {
  const t = useT();
  const errText = useErrorText();
  const { can } = useSession();
  const [rows, setRows] = useState<Series[]>([]);
  const [error, setError] = useState("");
  const load = () => get<Series[]>("/document-series").then(setRows).catch((e) => setError(errText(e)));
  useEffect(() => {
    load();
  }, []);
  const save = async (s: Series, prefix: string) => {
    try {
      await patch(`/document-series/${s.id}`, { prefix });
      load();
    } catch (e) {
      setError(errText(e));
    }
  };
  const preview = (s: Series) => `${s.prefix}/${s.fy.slice(2)}/${String(s.nextNumber).padStart(s.padding, "0")}`;
  const shown = rows.filter((r) => ["invoice", "quotation", "credit_note", "payment_in", "purchase_order", "payslip"].includes(r.docType));
  return (
    <div className="card stack">
      <h2>{t("settings.numbering")}</h2>
      <p className="muted small">{t("settings.numberingHelp")}</p>
      <Banner>{error}</Banner>
      <div className="scroll-x">
        <table className="simple">
          <thead>
            <tr><th>{t("team.branches")}</th><th>{t("settings.docType")}</th><th>{t("settings.prefix")}</th><th>{t("settings.preview")}</th></tr>
          </thead>
          <tbody>
            {shown.map((s) => (
              <tr key={s.id}>
                <td>{s.branchName}</td>
                <td>{t(`doc.${s.docType}`)}</td>
                <td style={{ width: 110 }}>
                  {can("settings.edit") ? (
                    <input defaultValue={s.prefix} maxLength={6} style={{ minHeight: 34, padding: "4px 8px" }} onBlur={(e) => e.target.value !== s.prefix && save(s, e.target.value.toUpperCase())} />
                  ) : s.prefix}
                </td>
                <td><code>{preview(s)}</code></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
