import { useEffect, useState } from "react";
import { get, post } from "../lib/api";
import { dateTime } from "../lib/format";
import { useLive } from "../components/Layout";
import { useT } from "../i18n";
import { Loading } from "../components/ui";

interface Note { id: number; type: string; title: string; body: string | null; link: string | null; read: boolean; createdAt: string }

export function Notifications() {
  const t = useT();
  const live = useLive();
  const [items, setItems] = useState<Note[] | null>(null);
  useEffect(() => {
    get<Note[]>("/notifications").then(setItems).catch(() => setItems([]));
  }, [live?.latestNotificationId]);
  if (!items) return <Loading />;
  const href = (link: string | null) => (link?.startsWith("/files/") ? `/api/v1${link}` : link ?? "#");
  return (
    <div className="stack">
      <div className="spread">
        <h1>{t("nav.notifications")}</h1>
        {items.some((n) => !n.read) && (
          <button className="btn small" onClick={() => post("/notifications/read-all").then(() => setItems(items.map((n) => ({ ...n, read: true }))))}>
            {t("notif.markAll")}
          </button>
        )}
      </div>
      <div className="card">
        {items.length === 0 && <p className="muted">{t("notif.empty")}</p>}
        <ul className="list">
          {items.map((n) => (
            <li key={n.id} style={{ opacity: n.read ? 0.65 : 1 }}>
              <a href={href(n.link)} onClick={() => !n.read && post(`/notifications/${n.id}/read`)}>
                <strong>{n.title}</strong>
              </a>
              {n.body && <div className="small">{n.body}</div>}
              <div className="muted small">{dateTime(n.createdAt)}</div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
