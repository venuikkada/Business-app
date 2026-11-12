import { hostname } from "node:os";
import { Db, db, json, withTx } from "../../db/pool.js";
import { istDate } from "../../lib/dates.js";
import { enqueue } from "./queue.js";
import { HANDLERS, type JobContext } from "./handlers.js";

const WORKER_ID = `${hostname().slice(0, 40)}:${process.pid}`;
export const DEFAULT_BUDGET_MS = 50_000; // Hostinger cron fires every minute; finish well inside it.
const STALE_LOCK_MINUTES = 10;

/** Recurring work. dedupe keys make each slot run once even if cron fires twice. */
export async function scheduleRecurring(now = new Date()) {
  const hourKey = now.toISOString().slice(0, 13);
  await enqueue("maintenance.cleanup", {}, { dedupeKey: `cleanup:${hourKey}`, priority: 9 });
  const today = istDate(now);
  await enqueue("subscription.check", {}, { dedupeKey: `subcheck:${today}`, priority: 3 });
  // Daily encrypted backup per active business, after 02:00 IST (20:30 UTC previous day).
  const istHour = (now.getUTCHours() * 60 + now.getUTCMinutes() + 330) / 60 % 24;
  if (istHour >= 2) {
    const tenants = await db().all("SELECT id FROM tenants WHERE status = 'active'");
    for (const t of tenants) {
      await enqueue("backup.tenant", { tenantId: Number(t.id) }, { tenantId: Number(t.id), dedupeKey: `backup:${t.id}:${today}`, priority: 8 });
    }
  }
}

/** Puts jobs whose worker died (locked > 10 min) back in the queue. */
async function releaseStale() {
  await db().exec(
    `UPDATE jobs SET status = 'queued', locked_by = NULL, locked_at = NULL,
            last_error = CONCAT('worker timed out; ', COALESCE(last_error, ''))
      WHERE status = 'running' AND locked_at < DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL ${STALE_LOCK_MINUTES} MINUTE)`,
  );
}

async function claim(): Promise<any | null> {
  return withTx(async (conn) => {
    const d = new Db(conn);
    // SKIP LOCKED: two cron runs never take the same job (MySQL 8 / MariaDB 10.6+).
    const job = await d.one(
      `SELECT id, tenant_id, type, payload, attempts, max_attempts FROM jobs
        WHERE status = 'queued' AND run_at <= CURRENT_TIMESTAMP(3)
        ORDER BY priority, run_at, id LIMIT 1 FOR UPDATE SKIP LOCKED`,
    );
    if (!job) return null;
    await d.exec(
      "UPDATE jobs SET status = 'running', locked_by = :w, locked_at = CURRENT_TIMESTAMP(3), attempts = attempts + 1 WHERE id = :id",
      { id: job.id, w: WORKER_ID },
    );
    return job;
  });
}

export interface RunSummary {
  processed: number;
  failed: number;
  stoppedForTime: boolean;
}

/**
 * Processes due jobs until the time budget is used. Each handler gets a deadline and
 * must stop early (and re-queue the rest of its work) if it is running out of time.
 */
export async function runJobs(budgetMs = DEFAULT_BUDGET_MS, opts: { schedule?: boolean } = {}): Promise<RunSummary> {
  const started = Date.now();
  const deadline = started + budgetMs;
  if (opts.schedule !== false) await scheduleRecurring();
  await releaseStale();
  const out: RunSummary = { processed: 0, failed: 0, stoppedForTime: false };
  while (true) {
    if (Date.now() > deadline - 5_000) {
      out.stoppedForTime = true;
      break;
    }
    const job = await claim();
    if (!job) break;
    const handler = HANDLERS[job.type];
    const ctx: JobContext = {
      jobId: Number(job.id),
      tenantId: job.tenant_id ? Number(job.tenant_id) : null,
      payload: json<Record<string, unknown>>(job.payload, {}),
      deadline,
    };
    try {
      if (!handler) throw new Error(`No handler for job type "${job.type}"`);
      const result = await handler(ctx);
      await db().exec(
        "UPDATE jobs SET status = 'done', result = :result, finished_at = CURRENT_TIMESTAMP(3), locked_by = NULL, last_error = NULL WHERE id = :id",
        { id: job.id, result: JSON.stringify(result ?? null) },
      );
      out.processed++;
    } catch (err: any) {
      out.failed++;
      const attempts = Number(job.attempts) + 1;
      const dead = attempts >= Number(job.max_attempts);
      const backoffSec = Math.min(3600, 30 * 2 ** (attempts - 1)); // 30s, 60s, 2m, 4m ... max 1h
      await db().exec(
        `UPDATE jobs SET status = :status, last_error = :err, locked_by = NULL, locked_at = NULL,
                run_at = DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL :backoff SECOND),
                finished_at = IF(:dead, CURRENT_TIMESTAMP(3), NULL)
          WHERE id = :id`,
        { id: job.id, status: dead ? "dead" : "queued", err: String(err?.stack ?? err).slice(0, 4000), backoff: backoffSec, dead: dead ? 1 : 0 },
      );
    }
  }
  return out;
}
