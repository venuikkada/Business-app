"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { INDIAN_STATES, RESOURCES, type Resource } from "@cba/core";
import { api, ApiError, newIdempotencyKey } from "@/lib/api-client";
import { Badge, Button, Field, Input, Select, Textarea, cn } from "../ui";
import { CopyButton, Modal, useToast } from "../client";

type Role = { id: string; name: string; key: string | null; description: string | null; permissions: string[]; isSystem: boolean; memberCount: number };
type Branch = { id: string; name: string };

export function InviteButton({ roles, branches, disabled }: { roles: Role[]; branches: Branch[]; disabled?: string | null }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ email: "", roleId: roles.find((r) => r.key === "salesperson")?.id ?? roles[0]?.id ?? "", branchIds: [] as string[] });
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Button onClick={() => { setOpen(true); setLink(null); }} disabled={!!disabled} title={disabled ?? undefined}>Invite employee</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Invite an employee" footer={!link && <Button disabled={busy || !f.email} onClick={async () => {
        setBusy(true);
        try {
          const r = await api<{ inviteUrl: string }>("POST", "team/invitations", { email: f.email, roleId: f.roleId, branchIds: f.branchIds.length ? f.branchIds : null }, { idempotencyKey: newIdempotencyKey() });
          setLink(r.inviteUrl);
          toast("success", "Invitation sent");
          router.refresh();
        } catch (e) {
          toast("error", e instanceof ApiError ? e.message : "Failed");
        } finally {
          setBusy(false);
        }
      }}>{busy ? "Sending…" : "Send invitation"}</Button>}>
        {link ? (
          <div className="space-y-3 text-sm">
            <p>We emailed the invitation. You can also share this link directly (valid 7 days, works only for {f.email}):</p>
            <code className="block break-all rounded-lg bg-stone-100 p-2 text-xs">{link}</code>
            <CopyButton text={link} label="Copy link" />
          </div>
        ) : (
          <div className="space-y-3">
            <Field label="Email"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoFocus /></Field>
            <Field label="Role">
              <Select value={f.roleId} onChange={(e) => setF({ ...f, roleId: e.target.value })}>{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select>
            </Field>
            <p className="text-xs text-muted">{roles.find((r) => r.id === f.roleId)?.description}</p>
            {branches.length > 1 && (
              <Field label="Branches" hint="None selected = all branches">
                <div className="flex flex-wrap gap-2">
                  {branches.map((b) => (
                    <label key={b.id} className="flex items-center gap-1.5 text-sm"><input type="checkbox" className="accent-brand-600" checked={f.branchIds.includes(b.id)} onChange={(e) => setF({ ...f, branchIds: e.target.checked ? [...f.branchIds, b.id] : f.branchIds.filter((x) => x !== b.id) })} />{b.name}</label>
                  ))}
                </div>
              </Field>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}

export function MemberRow({ m, roles, isMe }: { m: { id: string; fullName: string; email: string; roleId: string; roleKey: string | null; status: string; lastLoginAt: string | null }; roles: Role[]; isMe: boolean }) {
  const router = useRouter();
  const toast = useToast();
  async function patch(body: Record<string, unknown>) {
    try {
      await api("PATCH", `team/members/${m.id}`, body);
      toast("success", "Updated");
      router.refresh();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Failed");
    }
  }
  return (
    <div className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="font-medium">{m.fullName} {isMe && <Badge>You</Badge>} {m.status === "disabled" && <Badge color="red">Disabled</Badge>}</div>
        <div className="text-xs text-muted">{m.email}{m.lastLoginAt ? ` · last seen ${new Date(m.lastLoginAt).toLocaleDateString("en-IN")}` : ""}</div>
      </div>
      <div className="flex items-center gap-2">
        <select className="h-9 rounded-lg border border-line px-2 text-sm" value={m.roleId} disabled={isMe} onChange={(e) => patch({ roleId: e.target.value })} aria-label={`Role for ${m.fullName}`}>
          {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        {!isMe && <Button size="sm" variant="ghost" onClick={() => patch({ status: m.status === "active" ? "disabled" : "active" })}>{m.status === "active" ? "Disable" : "Enable"}</Button>}
      </div>
    </div>
  );
}

export function RoleEditor({ role, myPermissions, canCustom }: { role: Role | null; myPermissions: string[]; canCustom: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [perms, setPerms] = useState<string[]>(role?.permissions ?? []);
  const locked = role?.key === "owner";
  const toggle = (p: string) => setPerms((x) => (x.includes(p) ? x.filter((y) => y !== p) : [...x, p]));
  return (
    <>
      <Button size="sm" variant={role ? "ghost" : "primary"} onClick={() => setOpen(true)} disabled={!canCustom && !role}>{role ? (locked ? "View" : "Edit") : "New role"}</Button>
      <Modal wide open={open} onClose={() => setOpen(false)} title={role ? `Role: ${role.name}` : "New role"} footer={!locked && canCustom && <Button onClick={async () => {
        try {
          await api(role ? "PUT" : "POST", role ? `roles/${role.id}` : "roles", { name, description: description || null, permissions: perms });
          toast("success", "Role saved");
          setOpen(false);
          router.refresh();
        } catch (e) {
          toast("error", e instanceof ApiError ? e.message : "Failed");
        }
      }}>Save role</Button>}>
        {!canCustom && <p className="mb-3 rounded-lg bg-brand-50 p-3 text-sm text-brand-900">Custom roles are available on the Business plan. Built-in roles can be viewed here.</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name"><Input value={name} disabled={locked || !canCustom} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Description"><Textarea rows={1} value={description} disabled={locked || !canCustom} onChange={(e) => setDescription(e.target.value)} /></Field>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase text-muted"><th className="py-2">Area</th>{["view", "create", "edit", "delete", "export", "approve"].map((a) => <th key={a} className="px-2 py-2 text-center">{a}</th>)}</tr></thead>
            <tbody>
              {(Object.keys(RESOURCES) as Resource[]).map((r) => (
                <tr key={r} className="border-t border-line">
                  <td className="py-2 pr-2">{RESOURCES[r].label}</td>
                  {["view", "create", "edit", "delete", "export", "approve"].map((a) => {
                    const p = `${r}.${a}`;
                    const exists = (RESOURCES[r].actions as readonly string[]).includes(a);
                    return (
                      <td key={a} className="px-2 py-2 text-center">
                        {exists && <input type="checkbox" className={cn("accent-brand-600", !myPermissions.includes(p) && "opacity-40")} checked={perms.includes(p)} disabled={locked || !canCustom || !myPermissions.includes(p)} onChange={() => toggle(p)} aria-label={p} />}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted">You can only grant permissions you have yourself. Permissions are enforced by the server on every request.</p>
      </Modal>
    </>
  );
}

export function BranchEditor({ branch, defaultState, canCreate }: { branch: { id: string; name: string; code: string | null; gstin: string | null; phone: string | null; addressLine1: string | null; city: string | null; stateCode: string; pincode: string | null } | null; defaultState: string; canCreate: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: branch?.name ?? "", code: branch?.code ?? "", gstin: branch?.gstin ?? "", phone: branch?.phone ?? "", line1: branch?.addressLine1 ?? "", city: branch?.city ?? "", stateCode: branch?.stateCode ?? defaultState, pincode: branch?.pincode ?? "" });
  return (
    <>
      <Button size="sm" variant={branch ? "ghost" : "primary"} disabled={!branch && !canCreate} onClick={() => setOpen(true)}>{branch ? "Edit" : "Add branch"}</Button>
      <Modal open={open} onClose={() => setOpen(false)} title={branch ? `Edit ${branch.name}` : "New branch"} footer={<Button onClick={async () => {
        try {
          await api(branch ? "PUT" : "POST", branch ? `branches/${branch.id}` : "branches", { name: f.name, code: f.code || null, gstin: f.gstin || null, phone: f.phone || null, stateCode: f.stateCode, address: { line1: f.line1 || null, city: f.city || null, stateCode: f.stateCode, pincode: f.pincode || null } });
          toast("success", "Saved");
          setOpen(false);
          router.refresh();
        } catch (e) {
          toast("error", e instanceof ApiError ? e.message : "Failed");
        }
      }}>Save</Button>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Short code"><Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} maxLength={10} /></Field>
          <Field label="State"><Select value={f.stateCode} onChange={(e) => setF({ ...f, stateCode: e.target.value })}>{INDIAN_STATES.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}</Select></Field>
          <Field label="GSTIN (if different)"><Input value={f.gstin} maxLength={15} onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase() })} /></Field>
          <Field label="Address"><Input value={f.line1} onChange={(e) => setF({ ...f, line1: e.target.value })} /></Field>
          <Field label="City"><Input value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></Field>
          <Field label="PIN"><Input value={f.pincode} onChange={(e) => setF({ ...f, pincode: e.target.value })} /></Field>
          <Field label="Phone"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        </div>
      </Modal>
    </>
  );
}
