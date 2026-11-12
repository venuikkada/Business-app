import type { TenantDb } from "../../db/pool.js";
import { json } from "../../db/pool.js";
import type { TenantCtx } from "../../http/context.js";

export type AuditAction = "create" | "update" | "delete" | "restore" | "approve" | "reject" | "cancel" | "export" | "import" | "print" | "other";

const SECRET_KEY = /(password|token|secret|hash|_enc$|otp|cvv)/i;
const SKIP_KEYS = new Set(["updated_at", "created_at"]);

type Plain = Record<string, unknown>;

function norm(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "bigint") return v.toString();
  return v ?? null;
}

/** Field-level differences between two versions of a record. Secrets are masked. */
export function diff(before: Plain | null | undefined, after: Plain | null | undefined): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  for (const k of keys) {
    if (SKIP_KEYS.has(k)) continue;
    const a = norm(before?.[k]);
    const b = norm(after?.[k]);
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    out[k] = SECRET_KEY.test(k) ? { from: a == null ? null : "•••", to: b == null ? null : "•••" } : { from: a, to: b };
  }
  return out;
}

export interface AuditEntry {
  action: AuditAction;
  entityType: string;
  entityId?: number | null;
  summary: string;
  before?: Plain | null;
  after?: Plain | null;
  branchId?: number | null;
}

/**
 * Writes one audit row. Call it with the SAME TenantDb/transaction as the change,
 * so the change and its audit row are saved together or not at all.
 */
export async function audit(tdb: TenantDb, ctx: Pick<TenantCtx, "userId" | "meta">, e: AuditEntry): Promise<void> {
  const changes = e.before !== undefined || e.after !== undefined ? diff(e.before, e.after) : null;
  if (e.action === "update" && changes && Object.keys(changes).length === 0) return; // nothing changed
  await tdb.exec(
    `INSERT INTO audit_logs (tenant_id, user_id, action, entity_type, entity_id, summary, changes, branch_id, ip, user_agent, request_id)
     VALUES (:tenantId, :userId, :action, :entityType, :entityId, :summary, :changes, :branchId, :ip, :ua, :rid)`,
    {
      userId: ctx.userId || null,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId ?? null,
      summary: e.summary.slice(0, 255),
      changes: changes ? JSON.stringify(changes) : null,
      branchId: e.branchId ?? null,
      ip: ctx.meta.ip,
      ua: ctx.meta.userAgent,
      rid: ctx.meta.requestId || null,
    },
  );
}

export interface AuditQuery {
  entityType?: string;
  entityId?: number;
  userId?: number;
  action?: string;
  from?: string;
  to?: string;
  before?: number;
  limit: number;
}

export async function listAudit(tdb: TenantDb, q: AuditQuery) {
  const where = ["a.tenant_id = :tenantId"];
  const p: Record<string, unknown> = { limit: q.limit + 1 };
  if (q.entityType) (where.push("a.entity_type = :entityType"), (p.entityType = q.entityType));
  if (q.entityId) (where.push("a.entity_id = :entityId"), (p.entityId = q.entityId));
  if (q.userId) (where.push("a.user_id = :userId"), (p.userId = q.userId));
  if (q.action) (where.push("a.action = :action"), (p.action = q.action));
  // from/to are IST calendar dates; stored times are UTC (IST = UTC + 5:30)
  if (q.from) (where.push("a.created_at >= DATE_SUB(:from, INTERVAL 330 MINUTE)"), (p.from = q.from));
  if (q.to) (where.push("a.created_at < DATE_SUB(DATE_ADD(:to, INTERVAL 1 DAY), INTERVAL 330 MINUTE)"), (p.to = q.to));
  if (q.before) (where.push("a.id < :before"), (p.before = q.before));
  const rows = await tdb.all(
    `SELECT a.id, a.action, a.entity_type, a.entity_id, a.summary, a.changes, a.branch_id, a.ip, a.created_at,
            a.user_id, COALESCE(m.display_name, u.name) AS user_name
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.user_id
       LEFT JOIN memberships m ON m.tenant_id = a.tenant_id AND m.user_id = a.user_id
      WHERE ${where.join(" AND ")}
      ORDER BY a.id DESC
      LIMIT :limit`,
    p,
  );
  const more = rows.length > q.limit;
  const items = rows.slice(0, q.limit).map((r) => ({
    id: Number(r.id),
    action: r.action,
    entityType: r.entity_type,
    entityId: r.entity_id ? Number(r.entity_id) : null,
    summary: r.summary,
    changes: json(r.changes, null),
    branchId: r.branch_id ? Number(r.branch_id) : null,
    ip: r.ip,
    userId: r.user_id ? Number(r.user_id) : null,
    userName: r.user_name ?? (r.user_id ? "Unknown" : "System"),
    createdAt: r.created_at,
  }));
  return { items, nextBefore: more ? items[items.length - 1]!.id : null };
}
