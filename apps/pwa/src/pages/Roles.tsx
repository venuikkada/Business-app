import { useCallback, useEffect, useState, type FormEvent } from "react";
import { del, get, patch, post } from "../lib/api";
import { useSession } from "../lib/session";
import { useErrorText, useT } from "../i18n";
import { Banner, Input, Loading, Modal, Select } from "../components/ui";

interface Role { id: number; key: string; name: string; description: string | null; isSystem: boolean; permissions: string[]; memberCount: number }
interface Group { key: string; label: string; actions: { key: string; label: string; ownerOnly: boolean }[] }

export function Roles() {
  const t = useT();
  const errText = useErrorText();
  const { can } = useSession();
  const [roles, setRoles] = useState<Role[] | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Role | "new" | null>(null);

  const load = useCallback(async () => {
    try {
      const [r, g] = await Promise.all([get<Role[]>("/roles"), get<Group[]>("/permissions")]);
      setRoles(r);
      setGroups(g);
    } catch (e) {
      setError(errText(e));
    }
  }, [errText]);
  useEffect(() => {
    load();
  }, [load]);

  if (!roles) return error ? <Banner>{error}</Banner> : <Loading />;
  return (
    <div className="stack">
      <div className="spread">
        <h1>{t("roles.title")}</h1>
        {can("roles.manage") && <button className="btn primary" onClick={() => setEditing("new")}>+ {t("roles.new")}</button>}
      </div>
      <Banner>{error}</Banner>
      <div className="card">
        <ul className="list">
          {roles.map((r) => (
            <li key={r.id} className="spread">
              <div>
                <strong>{r.name}</strong> <span className={`badge ${r.isSystem ? "" : "ok"}`}>{r.isSystem ? t("roles.builtIn") : t("roles.custom")}</span>
                <div className="muted small">{r.description}</div>
                <div className="muted small">{t("roles.members", { n: r.memberCount })} · {r.permissions.length} ✓</div>
              </div>
              <button className="btn small" onClick={() => setEditing(r)}>{r.isSystem || !can("roles.manage") ? "👁" : t("common.edit")}</button>
            </li>
          ))}
        </ul>
      </div>
      {editing && (
        <RoleEditor
          role={editing === "new" ? null : editing}
          roles={roles}
          groups={groups}
          readOnly={editing !== "new" && (editing.isSystem || !can("roles.manage"))}
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

function RoleEditor({ role, roles, groups, readOnly, onClose, onDone }: { role: Role | null; roles: Role[]; groups: Group[]; readOnly: boolean; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const errText = useErrorText();
  const { can, current } = useSession();
  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [perms, setPerms] = useState<Set<string>>(new Set(role?.permissions ?? []));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const mine = new Set(current!.me.permissions);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const body = { name, description: description || null, permissions: [...perms] };
      role ? await patch(`/roles/${role.id}`, body) : await post("/roles", body);
      onDone();
    } catch (e2) {
      setError(errText(e2));
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!role || !confirm(t("common.confirmDelete"))) return;
    try {
      await del(`/roles/${role.id}`);
      onDone();
    } catch (e) {
      setError(errText(e));
    }
  };

  return (
    <Modal title={role ? role.name : t("roles.new")} onClose={onClose}>
      <form className="stack" onSubmit={save}>
        {readOnly && role?.isSystem && <Banner kind="warn">{t("roles.systemLocked")}</Banner>}
        <Banner>{error}</Banner>
        {!readOnly && (
          <>
            <Input label={t("roles.name")} value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={80} />
            <Input label={`${t("roles.description")} (${t("common.optional")})`} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={255} />
            {!role && (
              <Select label={t("roles.copyFrom")} defaultValue="" onChange={(e) => setPerms(new Set(roles.find((r) => r.id === Number(e.target.value))?.permissions.filter((p) => mine.has(p)) ?? []))}>
                <option value="">{t("roles.blank")}</option>
                {roles.filter((r) => r.key !== "owner").map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </Select>
            )}
          </>
        )}
        <strong className="small">{t("roles.permissions")}</strong>
        {groups.map((g) => {
          const allOn = g.actions.every((a) => perms.has(a.key));
          return (
            <div className="perm-group" key={g.key}>
              <div className="spread">
                <strong className="small">{g.label}</strong>
                {!readOnly && (
                  <label className="check small">
                    <input type="checkbox" checked={allOn} onChange={(e) => {
                        const n = new Set(perms);
                        for (const a of g.actions) if (!a.ownerOnly && mine.has(a.key)) e.target.checked ? n.add(a.key) : n.delete(a.key);
                        setPerms(n);
                      }} />
                    {t("roles.selectAll")}
                  </label>
                )}
              </div>
              <div className="perm-actions">
                {g.actions.map((a) => (
                  <label className="check small" key={a.key} title={a.ownerOnly ? "Owner only" : undefined}>
                    <input
                      type="checkbox"
                      checked={perms.has(a.key)}
                      disabled={readOnly || a.ownerOnly || !mine.has(a.key)}
                      onChange={(e) => {
                        const n = new Set(perms);
                        e.target.checked ? n.add(a.key) : n.delete(a.key);
                        setPerms(n);
                      }}
                    />
                    {a.label}
                  </label>
                ))}
              </div>
            </div>
          );
        })}
        {!readOnly && (
          <div className="spread">
            {role && can("roles.manage") ? <button type="button" className="btn danger" onClick={remove}>{t("common.delete")}</button> : <span />}
            <button className="btn primary" disabled={busy}>{busy ? t("common.saving") : t("common.save")}</button>
          </div>
        )}
      </form>
    </Modal>
  );
}
