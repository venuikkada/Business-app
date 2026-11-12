import { mkdir, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { TenantDb, db, getPool } from "../../db/pool.js";
import { encryptBuffer } from "../../lib/crypto.js";
import { istDate } from "../../lib/dates.js";
import { listAudit } from "../audit/service.js";
import { saveFile, storageRoot } from "../files/storage.js";
import { notify } from "../notifications/service.js";

export interface JobContext {
  jobId: number;
  tenantId: number | null;
  payload: Record<string, unknown>;
  /** epoch ms — stop and re-queue remaining work before this */
  deadline: number;
}

export type JobHandler = (ctx: JobContext) => Promise<unknown>;

/** Deletes expired security rows so tables stay small. */
async function cleanup() {
  const d = db();
  const out: Record<string, number> = {};
  out.otp = (await d.exec("DELETE FROM otp_codes WHERE created_at < DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 1 DAY) LIMIT 50000")).affectedRows;
  out.rateLimits = (await d.exec("DELETE FROM rate_limits WHERE window_start < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 2 DAY) LIMIT 50000")).affectedRows;
  out.refreshTokens = (await d.exec("DELETE FROM refresh_tokens WHERE expires_at < DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 1 DAY) LIMIT 50000")).affectedRows;
  out.sessions = (await d.exec(
    `DELETE FROM sessions WHERE (expires_at < DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 30 DAY))
        OR (revoked_at IS NOT NULL AND revoked_at < DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 30 DAY)) LIMIT 50000`,
  )).affectedRows;
  out.idempotency = (await d.exec("DELETE FROM idempotency_keys WHERE created_at < DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 7 DAY) LIMIT 50000")).affectedRows;
  out.jobs = (await d.exec("DELETE FROM jobs WHERE status = 'done' AND finished_at < DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 30 DAY) LIMIT 50000")).affectedRows;
  out.authEvents = (await d.exec("DELETE FROM auth_events WHERE created_at < DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 180 DAY) LIMIT 50000")).affectedRows;
  return out;
}

export const GRACE_DAYS = 7;

/** trial/active past end date -> grace (7 days, full access) -> expired (read-only). */
async function subscriptionCheck() {
  const d = db();
  const toGrace = await d.all(
    "SELECT id FROM tenants WHERE status = 'active' AND subscription_status IN ('trial','active') AND subscription_ends_at < CURRENT_TIMESTAMP(3)",
  );
  for (const t of toGrace) {
    await d.exec("UPDATE tenants SET subscription_status = 'grace' WHERE id = :id", { id: t.id });
    await notify(new TenantDb(getPool(), Number(t.id)), {
      permission: "billing.view", type: "subscription", link: "/settings",
      title: "Your plan has ended", body: `Renew within ${GRACE_DAYS} days to keep adding bills. Your data is safe.`,
    });
  }
  const toExpired = await d.all(
    `SELECT id FROM tenants WHERE status = 'active' AND subscription_status = 'grace'
        AND subscription_ends_at < DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL ${GRACE_DAYS} DAY)`,
  );
  for (const t of toExpired) {
    await d.exec("UPDATE tenants SET subscription_status = 'expired' WHERE id = :id", { id: t.id });
    await notify(new TenantDb(getPool(), Number(t.id)), {
      permission: "billing.view", type: "subscription", link: "/settings",
      title: "Plan expired — read-only mode", body: "You can still view and export everything. Renew to add new records.",
    });
  }
  // Remind 3 days before the end.
  const soon = await d.all(
    `SELECT id FROM tenants WHERE status = 'active' AND subscription_status IN ('trial','active')
        AND subscription_ends_at BETWEEN DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 3 DAY) AND DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 4 DAY)`,
  );
  for (const t of soon) {
    await notify(new TenantDb(getPool(), Number(t.id)), {
      permission: "billing.view", type: "subscription", link: "/settings", title: "Plan ends in 3 days", body: "Renew now to avoid interruption.",
    });
  }
  return { toGrace: toGrace.length, toExpired: toExpired.length, reminded: soon.length };
}

export const BACKUP_KEEP_DAYS = 14;

/**
 * Daily backup of one business: every table with a tenant_id, as JSON, gzipped and
 * encrypted with AES-256-GCM (DATA_ENCRYPTION_KEY). Kept for 14 days on disk.
 * Restore: scripts/decrypt-backup.ts. This is in ADDITION to Hostinger's own backups.
 */
async function backupTenant(ctx: JobContext) {
  const tenantId = Number(ctx.payload.tenantId ?? ctx.tenantId);
  if (!tenantId) throw new Error("tenantId missing");
  const d = db();
  const tables = await d.all(
    `SELECT DISTINCT TABLE_NAME AS t FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'tenant_id' ORDER BY TABLE_NAME`,
  );
  const dump: Record<string, unknown[]> = {};
  dump.tenants = await d.all("SELECT * FROM tenants WHERE id = :id", { id: tenantId });
  for (const { t } of tables) {
    if (!/^[a-z_]+$/.test(t)) continue;
    if (Date.now() > ctx.deadline - 3000) throw new Error("backup ran out of time; will retry");
    dump[t] = await d.all(`SELECT * FROM \`${t}\` WHERE tenant_id = :id`, { id: tenantId });
  }
  const body = gzipSync(Buffer.from(JSON.stringify({ version: 1, tenantId, createdAt: new Date().toISOString(), tables: dump })));
  const enc = encryptBuffer(body);
  const dir = path.join(storageRoot(), "backups", `t_${tenantId}`);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `${istDate()}.json.gz.enc`);
  await writeFile(file, enc, { mode: 0o600 });
  // Keep the newest 14 files.
  const files = (await readdir(dir)).filter((f) => f.endsWith(".enc")).sort();
  for (const f of files.slice(0, Math.max(0, files.length - BACKUP_KEEP_DAYS))) await unlink(path.join(dir, f)).catch(() => {});
  return { bytes: enc.length, tables: Object.keys(dump).length };
}

const csvCell = (v: unknown) => {
  const s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  // Neutralise spreadsheet formulas (CSV injection) and quote.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};

/** Audit log export to CSV (opens in Excel). Runs in the background for big logs. */
async function exportAuditCsv(ctx: JobContext) {
  if (!ctx.tenantId) throw new Error("tenantId missing");
  const tdb = new TenantDb(getPool(), ctx.tenantId);
  const filters = (ctx.payload.filters ?? {}) as Record<string, any>;
  const lines = [["Date & time (IST)", "User", "Action", "Record", "Record ID", "Summary", "Changes", "IP"].map(csvCell).join(",")];
  let before: number | undefined;
  let count = 0;
  while (count < 100_000) {
    if (Date.now() > ctx.deadline - 3000) throw new Error("export ran out of time; will retry");
    const page = await listAudit(tdb, { ...filters, before, limit: 1000 });
    for (const a of page.items) {
      const when = new Date(a.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: false });
      lines.push([when, a.userName, a.action, a.entityType, a.entityId, a.summary, a.changes, a.ip].map(csvCell).join(","));
      count++;
    }
    if (!page.nextBefore) break;
    before = page.nextBefore;
  }
  const buffer = Buffer.from("﻿" + lines.join("\r\n"), "utf8"); // BOM so Excel shows Hindi/Telugu correctly
  const saved = await saveFile(tdb, {
    kind: "export", buffer, mime: "text/csv", originalName: `audit-log-${istDate()}.csv`,
    createdBy: (ctx.payload.requestedBy as number) ?? null,
  });
  if (ctx.payload.requestedBy) {
    await notify(tdb, { userId: Number(ctx.payload.requestedBy), type: "export_ready", title: "Audit log export is ready", link: `/files/${saved.id}` });
  }
  return { fileId: saved.id, rows: count };
}

export const HANDLERS: Record<string, JobHandler> = {
  "maintenance.cleanup": cleanup,
  "subscription.check": subscriptionCheck,
  "backup.tenant": backupTenant,
  "export.audit_csv": exportAuditCsv,
  // Step 2+: "reminder.payment_due", "digest.low_stock", "export.report", "import.items", "payroll.payslips"
  "test.echo": async (ctx) => ctx.payload,
  "test.fail": async () => {
    throw new Error("intentional failure");
  },
};
