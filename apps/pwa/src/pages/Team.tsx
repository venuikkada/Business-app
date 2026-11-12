import { useCallback, useEffect, useState, type FormEvent } from "react";
import { del, get, patch, post } from "../lib/api";
import { dateTime, phone } from "../lib/format";
import { useSession } from "../lib/session";
import { useLive } from "../components/Layout";
import { useErrorText, useT } from "../i18n";
import { Banner, Input, Loading, Modal, Select } from "../components/ui";

interface Member {
  id: number;
  userId: number;
  name: string;
  mobile: string | null;
  status: "active" | "invited" | "disabled";
  role: { id: number; key: string; name: string };
  allBranches: boolean;
  branchIds: number[];
  lastLoginAt: string | null;
}
interface Role { id: number; key: string; name: string }

export function Team() {
  const t = useT();
  const errText = useErrorText();
  const live = useLive();
  const { current, can } = useSession();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [error, setError] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);
  const [invited, setInvited] = useState<{ name: string; link: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const [m, r] = await Promise.all([get<Member[]>("/team"), get<Role[]>("/roles")]);
      setMembers(m);
      setRoles(r);
    } catch (e) {
      setError(errText(e));
    }
  }, [errText]);
  useEffect(() => {
    load();
  }, [load, live?.changeCursor]);

  if (!members) return error ? <Banner>{error}</Banner> : <Loading />;
  const branches = current!.branches;
  const statusBadge = (s: Member["status"]) => <span className={`badge ${s === "active" ? "ok" : s === "invited" ? "warn" : "bad"}`}>{t(`team.status.${s}`)}</span>;

  return (
    <div className="stack">
      <div className="spread">
        <h1>{t("team.title")}</h1>
        {can("team.invite") && <button className="btn primary" onClick={() => setInviteOpen(true)}>+ {t("team.invite")}</button>}
      </div>
      <Banner>{error}</Banner>
      {invited && (
        <Banner kind="ok">
          {t("team.invited", { name: invited.name })}{" "}
          <a href={invited.link} target="_blank" rel="noopener noreferrer">{t("team.sendWhatsapp")} ↗</a>
        </Banner>
      )}
      <div className="card">
        <ul className="list">
          {members.map((m) => (
            <li key={m.id} className="spread">
              <div>
                <strong>{m.name || m.mobile}</strong> {m.userId === current!.me.userId && <span className="muted small">({t("team.you")})</span>}
                <div className="muted small">
                  {phone(m.mobile)} · {m.role.name} · {m.allBranches ? t("team.allBranches") : branches.filter((b: any) => m.branchIds.includes(b.id)).map((b: any) => b.name).join(", ")}
                </div>
                {m.lastLoginAt && <div className="muted small">{t("team.lastLogin")}: {dateTime(m.lastLoginAt)}</div>}
              </div>
              <div className="row">
                {statusBadge(m.status)}
                {can("team.edit") && m.userId !== current!.me.userId && (
                  <button className="btn small" onClick={() => setEditing(m)}>{t("common.edit")}</button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
      {inviteOpen && (
        <InviteForm
          roles={roles}
          branches={branches}
          onClose={() => setInviteOpen(false)}
          onDone={(name, link) => {
            setInviteOpen(false);
            setInvited({ name, link });
            load();
          }}
        />
      )}
      {editing && (
        <EditMember
          member={editing}
          roles={roles}
          branches={branches}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function BranchPicker({ branches, all, setAll, ids, setIds }: { branches: any[]; all: boolean; setAll: (v: boolean) => void; ids: number[]; setIds: (v: number[]) => void }) {
  const t = useT();
  return (
    <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
      <legend style={{ fontWeight: 600, fontSize: "0.85rem" }}>{t("team.branches")}</legend>
      <label className="check"><input type="radio" checked={all} onChange={() => setAll(true)} /> {t("team.allBranches")}</label>
      <label className="check"><input type="radio" checked={!all} onChange={() => setAll(false)} /> {t("team.onlyBranches")}</label>
      {!all && (
        <div style={{ paddingLeft: 24 }}>
          {branches.map((b) => (
            <label key={b.id} className="check">
              <input type="checkbox" checked={ids.includes(b.id)} onChange={(e) => setIds(e.target.checked ? [...ids, b.id] : ids.filter((x) => x !== b.id))} /> {b.name}
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}

function InviteForm({ roles, branches, onClose, onDone }: { roles: Role[]; branches: any[]; onClose: () => void; onDone: (name: string, link: string) => void }) {
  const t = useT();
  const errText = useErrorText();
  const [mobile, setMobile] = useState("");
  const [name, setName] = useState("");
  const [roleId, setRoleId] = useState(roles.find((r) => r.key === "cashier")?.id ?? roles[0]?.id ?? 0);
  const [all, setAll] = useState(true);
  const [ids, setIds] = useState<number[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await post("/team", { mobile, name, roleId, allBranches: all, branchIds: ids });
      onDone(name, r.whatsappLink);
    } catch (e2) {
      setError(errText(e2));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={t("team.invite")} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <p className="muted small">{t("team.inviteHelp")}</p>
        <Banner>{error}</Banner>
        <Input label={t("team.name")} value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
        <Input label={t("login.mobile")} inputMode="tel" value={mobile} onChange={(e) => setMobile(e.target.value)} required placeholder="98765 43210" />
        <Select label={t("team.role")} value={roleId} onChange={(e) => setRoleId(Number(e.target.value))}>
          {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </Select>
        {branches.length > 1 && <BranchPicker branches={branches} all={all} setAll={setAll} ids={ids} setIds={setIds} />}
        <button className="btn primary block" disabled={busy}>{busy ? t("common.saving") : t("common.add")}</button>
      </form>
    </Modal>
  );
}

function EditMember({ member, roles, branches, onClose, onDone }: { member: Member; roles: Role[]; branches: any[]; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const errText = useErrorText();
  const { can } = useSession();
  const [roleId, setRoleId] = useState(member.role.id);
  const [all, setAll] = useState(member.allBranches);
  const [ids, setIds] = useState<number[]>(member.branchIds);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      onDone();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={member.name || member.mobile || ""} onClose={onClose}>
      <div className="stack">
        <Banner>{error}</Banner>
        <Select label={t("team.role")} value={roleId} onChange={(e) => setRoleId(Number(e.target.value))}>
          {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </Select>
        {branches.length > 1 && <BranchPicker branches={branches} all={all} setAll={setAll} ids={ids} setIds={setIds} />}
        <button className="btn primary block" disabled={busy} onClick={() => run(() => patch(`/team/${member.id}`, { roleId, allBranches: all, branchIds: ids }))}>
          {t("common.save")}
        </button>
        <div className="spread">
          {member.status !== "invited" && (
            <button className="btn" disabled={busy} onClick={() => run(() => patch(`/team/${member.id}`, { status: member.status === "disabled" ? "active" : "disabled" }))}>
              {member.status === "disabled" ? t("team.enable") : t("team.disable")}
            </button>
          )}
          {can("team.remove") && (
            <button className="btn danger" disabled={busy} onClick={() => confirm(t("common.confirmDelete")) && run(() => del(`/team/${member.id}`))}>
              {t("common.remove")}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
