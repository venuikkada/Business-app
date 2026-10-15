"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { api, ApiError } from "@/lib/api-client";
import { Badge, Button, Card, CardHeader, Field, Input, Textarea } from "../ui";
import { Modal, useToast } from "../client";

export function ProfileCard({ fullName, phone, email, verified }: { fullName: string; phone: string | null; email: string; verified: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [f, setF] = useState({ fullName, phone: phone ?? "" });
  return (
    <Card>
      <CardHeader title="Your profile" subtitle={<>{email} {verified ? <Badge color="green">Verified</Badge> : <Badge color="amber">Not verified</Badge>}</>} />
      <div className="grid gap-4 p-5 sm:grid-cols-2">
        <Field label="Name"><Input value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} /></Field>
        <Field label="Mobile"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <div className="flex gap-2 sm:col-span-2">
          <Button onClick={async () => { try { await api("PATCH", "me", { fullName: f.fullName, phone: f.phone || null }); toast("success", "Saved"); router.refresh(); } catch (e) { toast("error", e instanceof ApiError ? e.message : "Failed"); } }}>Save</Button>
          {!verified && <Button variant="secondary" onClick={async () => { try { await api("POST", "auth/resend-verification"); toast("success", "Verification email sent"); } catch (e) { toast("error", e instanceof ApiError ? e.message : "Failed"); } }}>Resend verification email</Button>}
        </div>
      </div>
    </Card>
  );
}

export function PasswordCard() {
  const toast = useToast();
  const [f, setF] = useState({ currentPassword: "", newPassword: "" });
  const [busy, setBusy] = useState(false);
  return (
    <Card>
      <CardHeader title="Change password" subtitle="You stay signed in here; other devices are signed out" />
      <form className="grid gap-4 p-5 sm:grid-cols-2" onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await api("POST", "me/password", f);
          toast("success", "Password changed");
          setF({ currentPassword: "", newPassword: "" });
        } catch (err) {
          toast("error", err instanceof ApiError ? err.message : "Failed");
        } finally {
          setBusy(false);
        }
      }}>
        <Field label="Current password"><Input type="password" autoComplete="current-password" value={f.currentPassword} onChange={(e) => setF({ ...f, currentPassword: e.target.value })} /></Field>
        <Field label="New password" hint="10+ characters, letters and numbers"><Input type="password" autoComplete="new-password" value={f.newPassword} onChange={(e) => setF({ ...f, newPassword: e.target.value })} /></Field>
        <div><Button type="submit" disabled={busy || !f.currentPassword || f.newPassword.length < 10}>Update password</Button></div>
      </form>
    </Card>
  );
}

export function TotpCard({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState("");
  const [disable, setDisable] = useState(false);
  const [pw, setPw] = useState("");
  return (
    <Card>
      <CardHeader title="Two-factor authentication" subtitle="A 6-digit code from Google Authenticator, Microsoft Authenticator or similar is needed at sign-in" action={enabled ? <Badge color="green">On</Badge> : <Badge>Off</Badge>} />
      <div className="p-5">
        {!enabled && !setup && <Button onClick={async () => { try { const r = await api<{ secret: string; uri: string }>("POST", "me/totp/begin"); setSetup({ secret: r.secret, qr: await QRCode.toDataURL(r.uri, { margin: 1, width: 200 }) }); } catch (e) { toast("error", e instanceof ApiError ? e.message : "Failed"); } }}>Set up</Button>}
        {setup && (
          <div className="flex flex-col gap-4 sm:flex-row">
            <img src={setup.qr} alt="Scan this QR code with your authenticator app" className="h-44 w-44 rounded-lg border border-line" />
            <div className="space-y-3">
              <p className="text-sm">Scan the QR code, or enter this key manually:</p>
              <code className="block break-all rounded bg-stone-100 p-2 text-xs">{setup.secret}</code>
              <Field label="Code from the app"><Input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} /></Field>
              <Button disabled={code.length !== 6} onClick={async () => { try { await api("POST", "me/totp/confirm", { code }); toast("success", "Two-factor authentication is on"); setSetup(null); router.refresh(); } catch (e) { toast("error", e instanceof ApiError ? e.message : "Failed"); } }}>Turn on</Button>
            </div>
          </div>
        )}
        {enabled && <Button variant="danger" onClick={() => setDisable(true)}>Turn off</Button>}
        <Modal open={disable} onClose={() => setDisable(false)} title="Turn off two-factor authentication" footer={<Button variant="danger" onClick={async () => { try { await api("POST", "me/totp/disable", { password: pw, code }); toast("success", "Turned off"); setDisable(false); router.refresh(); } catch (e) { toast("error", e instanceof ApiError ? e.message : "Failed"); } }}>Turn off</Button>}>
          <div className="space-y-3">
            <Field label="Password"><Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
            <Field label="Current code"><Input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} /></Field>
          </div>
        </Modal>
      </div>
    </Card>
  );
}

export function DangerCard({ kind, businessName }: { kind: "account" | "business"; businessName?: string }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState("");
  const [name, setName] = useState("");
  return (
    <Card className="border-red-200">
      <CardHeader title={kind === "business" ? "Delete this business" : "Delete my account"} subtitle={kind === "business" ? "The business is hidden immediately and permanently erased after 30 days. You can restore it within 30 days. Download an export first." : "Your personal details are erased. You must delete or hand over businesses you own first."} />
      <div className="p-5"><Button variant="danger" onClick={() => setOpen(true)}>{kind === "business" ? "Delete business" : "Delete account"}</Button></div>
      <Modal open={open} onClose={() => setOpen(false)} title="This cannot be undone easily" footer={<Button variant="danger" disabled={!pw || (kind === "business" && name !== businessName)} onClick={async () => {
        try {
          if (kind === "business") await api("POST", "business/delete", { password: pw, confirmName: name });
          else await api("POST", "me/delete", { password: pw });
          toast("success", kind === "business" ? "Business scheduled for deletion" : "Account deleted");
          router.push(kind === "business" ? "/select-business" : "/");
          router.refresh();
        } catch (e) {
          toast("error", e instanceof ApiError ? e.message : "Failed");
        }
      }}>Delete permanently</Button>}>
        <div className="space-y-3">
          {kind === "business" && <Field label={<>Type <b>{businessName}</b> to confirm</>}><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>}
          <Field label="Your password"><Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
        </div>
      </Modal>
    </Card>
  );
}

export function SupportForm() {
  const router = useRouter();
  const toast = useToast();
  const [f, setF] = useState({ subject: "", body: "" });
  return (
    <form className="space-y-3 p-5" onSubmit={async (e) => {
      e.preventDefault();
      try {
        await api("POST", "support", f);
        toast("success", "Message sent. We usually reply within one working day.");
        setF({ subject: "", body: "" });
        router.refresh();
      } catch (err) {
        toast("error", err instanceof ApiError ? err.message : "Failed");
      }
    }}>
      <Field label="Subject"><Input value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} /></Field>
      <Field label="How can we help?" hint="Never share passwords or OTPs. Support staff will never ask for them."><Textarea rows={4} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
      <Button type="submit" disabled={f.subject.length < 3 || f.body.length < 3}>Send</Button>
    </form>
  );
}
