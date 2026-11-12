import { Db, db, json } from "../../db/pool.js";

export interface EnqueueOptions {
  tenantId?: number | null;
  runAt?: Date;
  priority?: number;
  dedupeKey?: string;
  maxAttempts?: number;
  createdBy?: number | null;
}

/** Adds a background job. With dedupeKey, a second identical job is silently ignored. */
export async function enqueue(type: string, payload: unknown, o: EnqueueOptions = {}, d: Db = db()): Promise<number | null> {
  const r = await d.exec(
    `INSERT IGNORE INTO jobs (tenant_id, type, payload, priority, run_at, max_attempts, dedupe_key, created_by)
     VALUES (:tenantId, :type, :payload, :priority, :runAt, :max, :dedupe, :by)`,
    {
      tenantId: o.tenantId ?? null,
      type,
      payload: JSON.stringify(payload ?? {}),
      priority: o.priority ?? 5,
      runAt: o.runAt ?? new Date(),
      max: o.maxAttempts ?? 5,
      dedupe: o.dedupeKey ?? null,
      by: o.createdBy ?? null,
    },
  );
  return r.affectedRows ? r.insertId : null;
}

export async function getJob(tenantId: number, id: number) {
  const j = await db().one(
    "SELECT id, type, status, attempts, last_error, result, created_at, finished_at FROM jobs WHERE tenant_id = :tid AND id = :id",
    { tid: tenantId, id },
  );
  if (!j) return null;
  return {
    id: Number(j.id),
    type: j.type,
    status: j.status,
    attempts: Number(j.attempts),
    error: j.status === "dead" || j.status === "failed" ? (j.last_error ?? "").split("\n")[0]?.slice(0, 200) : null,
    result: json(j.result, null),
    createdAt: j.created_at,
    finishedAt: j.finished_at,
  };
}
