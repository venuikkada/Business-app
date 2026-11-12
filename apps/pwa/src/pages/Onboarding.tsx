import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { validateGSTIN } from "@cba/core";
import { get, post, setTenantId } from "../lib/api";
import { useSession } from "../lib/session";
import { useErrorText, useT } from "../i18n";
import { Banner, Input, Select, fieldErrors } from "../components/ui";

interface Meta {
  sectors: { key: string; label: string; step: number | null }[];
  states: { code: string; name: string }[];
}

export function Onboarding() {
  const t = useT();
  const errText = useErrorText();
  const nav = useNavigate();
  const { reload, me } = useSession();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [name, setName] = useState("");
  const [sector, setSector] = useState("retail");
  const [stateCode, setStateCode] = useState("");
  const [city, setCity] = useState("");
  const [gstin, setGstin] = useState("");
  const [prefix, setPrefix] = useState("INV");
  const [branches, setBranches] = useState([{ name: "", stateCode: "" }]);
  const [error, setError] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    get<Meta>("/meta").then(setMeta).catch(() => {});
  }, []);

  const gstCheck = gstin ? validateGSTIN(gstin) : null;
  const onGstin = (v: string) => {
    const g = v.toUpperCase().replace(/\s/g, "").slice(0, 15);
    setGstin(g);
    const r = validateGSTIN(g);
    if (r.valid && r.stateCode) setStateCode(r.stateCode);
  };

  const fyShort = (() => {
    const d = new Date();
    const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
    return `${String(y).slice(2)}-${String(y + 1).slice(2)}`;
  })();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    setFields({});
    try {
      const r = await post("/tenants", {
        name,
        sector,
        stateCode,
        city,
        gstin: gstin || null,
        invoicePrefix: prefix,
        fyStartMonth: 4,
        branches: branches.map((b, i) => ({ name: b.name || (i === 0 ? `${city || name} – Main` : `Branch ${i + 1}`), stateCode: b.stateCode || stateCode, city })),
      });
      setTenantId(r.tenantId);
      await reload();
      nav("/");
    } catch (e2) {
      setError(errText(e2));
      setFields(fieldErrors(e2));
    } finally {
      setBusy(false);
    }
  };

  if (!meta) return <div className="center muted">{t("common.loading")}</div>;
  return (
    <div className="content" style={{ maxWidth: 640 }}>
      <form className="card stack" onSubmit={submit}>
        <div>
          <h1>{t("onb.title")}</h1>
          <p className="muted">{t("onb.subtitle")}</p>
        </div>
        <Banner>{error}</Banner>
        <Input label={t("onb.businessName")} value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={150} error={fields.name} placeholder="Sri Lakshmi Mobiles" />

        <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ fontWeight: 600, fontSize: "0.85rem", marginBottom: 6 }}>{t("onb.sector")}</legend>
          <div className="grid2">
            {meta.sectors.map((s) => (
              <label key={s.key} className="check card" style={{ padding: 10, margin: 0, borderColor: sector === s.key ? "var(--brand)" : undefined }}>
                <input type="radio" name="sector" value={s.key} checked={sector === s.key} onChange={() => setSector(s.key)} />
                <span>
                  {t(`sector.${s.key}`)}
                  {s.step !== 2 && <span className="badge warn" style={{ marginLeft: 6 }}>{t("onb.sectorSoon")}</span>}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <Input
          label={`${t("onb.gstin")} (${t("common.optional")})`}
          hint={gstCheck && !gstCheck.valid ? gstCheck.reason : t("onb.gstinHint")}
          error={fields.gstin}
          value={gstin}
          onChange={(e) => onGstin(e.target.value)}
          placeholder="36ABCDE1234F1Z5"
          style={{ textTransform: "uppercase" }}
        />
        <div className="grid2">
          <Select label={t("onb.state")} value={stateCode} onChange={(e) => setStateCode(e.target.value)} required error={fields.stateCode}>
            <option value="">—</option>
            {meta.states.map((s) => (
              <option key={s.code} value={s.code}>{s.name}</option>
            ))}
          </Select>
          <Input label={t("onb.city")} value={city} onChange={(e) => setCity(e.target.value)} maxLength={80} placeholder="Hyderabad" />
        </div>
        <div className="grid2">
          <Input
            label={t("onb.invoicePrefix")}
            value={prefix}
            onChange={(e) => setPrefix(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 6))}
            hint={t("onb.invoicePrefixHint", { sample: `${prefix || "INV"}/${fyShort}/0001` })}
            error={fields.invoicePrefix}
            required
          />
          <Field2 label={t("onb.fy")} text={t("onb.fyApril")} />
        </div>

        <div className="stack">
          <strong className="small">{t("onb.branches")}</strong>
          {branches.map((b, i) => (
            <div className="row" key={i}>
              <input
                aria-label={t("onb.branchName")}
                placeholder={i === 0 ? `${t("onb.branchName")} — Ameerpet` : t("onb.branchName")}
                value={b.name}
                onChange={(e) => setBranches(branches.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                style={{ flex: 1 }}
              />
              {i > 0 && (
                <button type="button" className="btn small danger" onClick={() => setBranches(branches.filter((_, j) => j !== i))}>
                  {t("common.remove")}
                </button>
              )}
            </div>
          ))}
          {branches.length < 20 && (
            <button type="button" className="btn small" onClick={() => setBranches([...branches, { name: "", stateCode: "" }])}>
              + {t("onb.addBranch")}
            </button>
          )}
        </div>

        <button className="btn primary block" disabled={busy}>{busy ? t("common.saving") : t("onb.create")}</button>
        <p className="muted small" style={{ textAlign: "center" }}>{t("onb.trial")}</p>
        {me && me.businesses.length > 0 && (
          <button type="button" className="linkbtn small" onClick={() => nav(-1)}>{t("common.back")}</button>
        )}
      </form>
    </div>
  );
}

function Field2({ label, text }: { label: string; text: string }) {
  return (
    <div className="field">
      <span style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: 4 }}>{label}</span>
      <div className="muted" style={{ padding: "10px 0" }}>{text}</div>
    </div>
  );
}
