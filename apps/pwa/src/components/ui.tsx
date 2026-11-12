import { useEffect, type ReactNode, type InputHTMLAttributes, type SelectHTMLAttributes } from "react";
import { useT } from "../i18n";

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {error ? <small className="err">{error}</small> : hint ? <small>{hint}</small> : null}
    </label>
  );
}

export function Input({ label, hint, error, ...rest }: { label: string; hint?: string; error?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <Field label={label} hint={hint} error={error}>
      <input {...rest} aria-invalid={!!error} />
    </Field>
  );
}

export function Select({ label, hint, error, children, ...rest }: { label: string; hint?: string; error?: string; children: ReactNode } & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <Field label={label} hint={hint} error={error}>
      <select {...rest}>{children}</select>
    </Field>
  );
}

export function Banner({ kind = "error", children }: { kind?: "error" | "ok" | "warn"; children: ReactNode }) {
  if (!children) return null;
  return <div className={`banner ${kind}`} role={kind === "error" ? "alert" : "status"}>{children}</div>;
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const t = useT();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="spread" style={{ marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <button className="btn small" onClick={onClose}>{t("common.close")}</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Loading() {
  const t = useT();
  return <div className="center muted">{t("common.loading")}</div>;
}

/** Turns zod field errors from the API into { "path": "message" }. */
export function fieldErrors(e: any): Record<string, string> {
  const out: Record<string, string> = {};
  if (e?.code === "validation_failed" && Array.isArray(e.details)) for (const d of e.details) out[d.path] ??= d.message;
  return out;
}

export function PageHead({ title, sub, children }: { title: string; sub?: string; children?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <div className="muted small">{sub}</div>}
      </div>
      <div className="row">{children}</div>
    </div>
  );
}

export function Empty({ icon, title, text, children }: { icon: ReactNode; title: string; text?: string; children?: ReactNode }) {
  return (
    <div className="empty">
      {icon}
      <strong>{title}</strong>
      {text && <div className="small" style={{ marginBottom: 12 }}>{text}</div>}
      {children}
    </div>
  );
}

const STATUS: Record<string, [string, string]> = {
  paid: ["Paid", "ok"], partially_paid: ["Part paid", "warn"], issued: ["Unpaid", "bad"], cancelled: ["Cancelled", "gray"],
  sent: ["Open", ""], converted: ["Invoiced", "ok"], accepted: ["Accepted", "ok"], rejected: ["Rejected", "gray"],
};
export function StatusBadge({ status }: { status: string }) {
  const [label, cls] = STATUS[status] ?? [status, "gray"];
  return <span className={`badge ${cls}`}>{label}</span>;
}

/** Number input that keeps what the user typed and reports a number (or 0). */
export function Num({ label, value, onChange, step = "0.01", ...rest }: { label: string; value: number | string; onChange: (v: number) => void; step?: string } & Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value">) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="number" inputMode="decimal" min="0" step={step} value={value === 0 ? "" : value} placeholder="0" onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))} {...rest} />
    </label>
  );
}
