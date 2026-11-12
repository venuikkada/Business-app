import { useCallback, useEffect, useState } from "react";
import { get, post } from "../lib/api";
import { dateTime } from "../lib/format";
import { useSession } from "../lib/session";
import { useLive } from "../components/Layout";
import { useErrorText, useT } from "../i18n";
import { Banner, Input, Loading, Select } from "../components/ui";

interface Entry {
  id: number;
  action: string;
  entityType: string;
  entityId: number | null;
  summary: string;
  changes: Record<string, { from: unknown; to: unknown }> | null;
  userName: string;
  ip: string | null;
  createdAt: string;
}

const ENTITIES = ["invoice", "quotation", "payment", "item", "stock_movement", "party", "employee", "payroll_run", "tenant", "branch", "role", "membership", "document_series"];
const ACTIONS = ["create", "update", "delete", "cancel", "export"];
const show = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));

export function Audit() {
  const t = useT();
  const errText = useErrorText();
  const live = useLive();
  const { can } = useSession();
  const [items, setItems] = useState<Entry[] | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const [filters, setFilters] = useState({ entityType: "", action: "", from: "", to: "" });
  const [error, setError] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const [exportState, setExportState] = useState<{ status: string; fileId?: number } | null>(null);

  const qs = useCallback(
    (before?: number) => {
      const p = new URLSearchParams({ limit: "30" });
      for (const [k, v] of Object.entries(filters)) if (v) p.set(k, v);
      if (before) p.set("before", String(before));
      return p.toString();
    },
    [filters],
  );

  const load = useCallback(async () => {
    try {
      const r = await get(`/audit-logs?${qs()}`);
      setItems(r.items);
      setNext(r.nextBefore);
    } catch (e) {
      setError(errText(e));
    }
  }, [qs, errText]);
  useEffect(() => {
    load();
  }, [load, live?.changeCursor]);

  const more = async () => {
    if (!next) return;
    const r = await get(`/audit-logs?${qs(next)}`);
    setItems([...(items ?? []), ...r.items]);
    setNext(r.nextBefore);
  };

  // Export runs as a background job; check every 3 s until it's ready.
  const exportCsv = async () => {
    setError("");
    try {
      const body: Record<string, string> = {};
      for (const [k, v] of Object.entries(filters)) if (v) body[k] = v;
      const { jobId } = await post("/audit-logs/export", body);
      setExportState({ status: "queued" });
      const check = async (n: number) => {
        const j = await get(`/jobs/${jobId}`);
        if (j.status === "done") setExportState({ status: "done", fileId: j.result.fileId });
        else if (j.status === "dead" || n > 100) setExportState({ status: "failed" });
        else window.setTimeout(() => check(n + 1), 3000);
      };
      check(0);
    } catch (e) {
      setError(errText(e));
    }
  };

  return (
    <div className="stack">
      <div className="spread">
        <div>
          <h1>{t("audit.title")}</h1>
          <p className="muted small">{t("audit.subtitle")}</p>
        </div>
        {can("audit.export") && (
          exportState?.status === "done" ? (
            <a className="btn" href={`/api/v1/files/${exportState.fileId}`}>⬇ {t("audit.download")}</a>
          ) : (
            <button className="btn" onClick={exportCsv} disabled={exportState?.status === "queued"}>
              {exportState?.status === "queued" ? t("audit.exporting") : t("audit.export")}
            </button>
          )
        )}
      </div>
      <Banner>{error}</Banner>
      <div className="card grid2">
        <Select label={t("audit.filterRecord")} value={filters.entityType} onChange={(e) => setFilters({ ...filters, entityType: e.target.value })}>
          <option value="">{t("audit.all")}</option>
          {ENTITIES.map((x) => <option key={x} value={x}>{t(`entity.${x}`)}</option>)}
        </Select>
        <Select label={t("audit.filterAction")} value={filters.action} onChange={(e) => setFilters({ ...filters, action: e.target.value })}>
          <option value="">{t("audit.all")}</option>
          {ACTIONS.map((x) => <option key={x} value={x}>{t(`action.${x}`)}</option>)}
        </Select>
        <Input label={t("audit.from")} type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
        <Input label={t("audit.to")} type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
      </div>
      {!items ? (
        <Loading />
      ) : (
        <div className="card">
          {items.length === 0 && <p className="muted">{t("common.none")}</p>}
          <ul className="list">
            {items.map((a) => (
              <li key={a.id}>
                <div className="spread">
                  <span>
                    <span className={`badge ${a.action === "delete" ? "bad" : a.action === "create" ? "ok" : ""}`}>{t(`action.${a.action}`)}</span>{" "}
                    {a.summary}
                  </span>
                  {a.changes && Object.keys(a.changes).length > 0 && (
                    <button className="linkbtn small" onClick={() => setOpen(open === a.id ? null : a.id)}>{t("audit.changes")} ({Object.keys(a.changes).length})</button>
                  )}
                </div>
                <div className="muted small">
                  {a.userName || t("audit.system")} · {dateTime(a.createdAt)} · {t(`entity.${a.entityType}`)}{a.entityId ? ` #${a.entityId}` : ""}
                </div>
                {open === a.id && a.changes && (
                  <div className="changes">
                    {Object.entries(a.changes).map(([k, v]) => (
                      <div key={k}>
                        <strong>{k}</strong>: <del>{show(v.from)}</del> → <ins>{show(v.to)}</ins>
                      </div>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
          {next && <button className="btn block" onClick={more}>{t("common.loadMore")}</button>}
        </div>
      )}
    </div>
  );
}
