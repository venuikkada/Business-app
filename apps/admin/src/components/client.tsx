"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input, Textarea, buttonClass } from "@cba/ui";

export async function adminApi<T = unknown>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/${path}`, { method: "POST", headers: { "content-type": "application/json", "x-cba-csrf": "1" }, body: JSON.stringify(body ?? {}) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message ?? `Failed (${res.status})`);
  return data as T;
}

/** Button that asks for a reason (always required for admin actions) and posts. */
export function AdminAction({ path, body, label, reasonLabel = "Reason (recorded in the platform audit log)", variant = "secondary", danger }: { path: string; body?: Record<string, unknown>; label: ReactNode; reasonLabel?: string; variant?: "primary" | "secondary" | "danger" | "ghost"; danger?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <span className="inline-block">
      <button className={buttonClass(danger ? "danger" : variant, "sm")} onClick={() => setOpen(!open)}>{label}</button>
      {open && (
        <span className="mt-2 block w-72 space-y-2 rounded-lg border border-line bg-white p-3 shadow">
          <Field label={reasonLabel}><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          {msg && <span className="block text-xs text-red-700">{msg}</span>}
          <Button size="sm" variant={danger ? "danger" : "primary"} disabled={busy || reason.trim().length < 5} onClick={async () => {
            setBusy(true);
            setMsg(null);
            try {
              await adminApi(path, { ...(body ?? {}), reason });
              setOpen(false);
              setReason("");
              router.refresh();
            } catch (e) {
              setMsg(e instanceof Error ? e.message : "Failed");
            } finally {
              setBusy(false);
            }
          }}>Confirm</Button>
        </span>
      )}
    </span>
  );
}

export function LoginForm() {
  const router = useRouter();
  const [f, setF] = useState({ email: "", password: "", totp: "" });
  const [err, setErr] = useState<string | null>(null);
  const [needTotp, setNeedTotp] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <form className="space-y-4" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true);
      setErr(null);
      try {
        const r = await adminApi<{ mfaVerified: boolean }>("login", { email: f.email, password: f.password, totp: f.totp || undefined });
        router.push(r.mfaVerified ? "/" : "/setup-2fa");
        router.refresh();
      } catch (e2) {
        const m = e2 instanceof Error ? e2.message : "Failed";
        if (/authenticator code/i.test(m)) setNeedTotp(true);
        setErr(m);
      } finally {
        setBusy(false);
      }
    }}>
      <Field label="Email"><Input type="email" autoComplete="username" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required /></Field>
      <Field label="Password"><Input type="password" autoComplete="current-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required /></Field>
      {needTotp && <Field label="Authenticator code"><Input inputMode="numeric" maxLength={6} autoComplete="one-time-code" value={f.totp} onChange={(e) => setF({ ...f, totp: e.target.value })} autoFocus /></Field>}
      {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
      <Button type="submit" className="w-full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</Button>
    </form>
  );
}

export function TotpSetup() {
  const router = useRouter();
  const [s, setS] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return s ? (
    <div className="space-y-3">
      <img src={s.qr} alt="TOTP QR code" className="h-48 w-48 rounded-lg border border-line" />
      <code className="block break-all rounded bg-stone-100 p-2 text-xs">{s.secret}</code>
      <Field label="Code from your authenticator app"><Input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} /></Field>
      {err && <p className="text-sm text-red-700">{err}</p>}
      <Button disabled={code.length !== 6} onClick={async () => {
        try {
          await adminApi("totp/confirm", { code });
          router.push("/");
          router.refresh();
        } catch (e) {
          setErr(e instanceof Error ? e.message : "Failed");
        }
      }}>Verify & continue</Button>
    </div>
  ) : (
    <Button onClick={async () => {
      try {
        const r = await adminApi<{ secret: string; uri: string }>("totp/begin");
        const QR = await import("qrcode");
        setS({ secret: r.secret, qr: await QR.toDataURL(r.uri, { margin: 1, width: 220 }) });
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Failed");
      }
    }}>Generate QR code</Button>
  );
}

export function PostButton({ path, body, label, variant = "secondary", confirmText }: { path: string; body?: unknown; label: ReactNode; variant?: "primary" | "secondary" | "danger" | "ghost"; confirmText?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <button className={buttonClass(variant, "sm")} disabled={busy} onClick={async () => {
        if (confirmText && !confirm(confirmText)) return;
        setBusy(true);
        try {
          const r = await adminApi(path, body);
          setOut(typeof r === "object" ? JSON.stringify(r) : "Done");
          router.refresh();
        } catch (e) {
          setOut(e instanceof Error ? e.message : "Failed");
        } finally {
          setBusy(false);
        }
      }}>{busy ? "Working…" : label}</button>
      {out && <span className="max-w-md truncate text-xs text-muted">{out}</span>}
    </span>
  );
}
