import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { DEFAULT_PLANS } from "@cba/core";
import { sslOptions } from "./db";

const here = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = path.resolve(here, "../../../db/migrations");

/**
 * Applies pending SQL migrations in filename order, each in its own
 * transaction, and records a checksum so edited migrations are detected.
 * Must run as the schema owner (never as cba_app / cba_platform).
 */
export async function migrate(ownerUrl: string, log: (m: string) => void = console.log): Promise<string[]> {
  const client = new pg.Client({ connectionString: ownerUrl, ssl: sslOptions() });
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query(`create table if not exists schema_migrations (
      name text primary key, checksum text not null, applied_at timestamptz not null default now())`);
    await client.query("select pg_advisory_lock(727274)");
    const done = new Map((await client.query("select name, checksum from schema_migrations")).rows.map((r) => [r.name as string, r.checksum as string]));
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
    for (const f of files) {
      const sql = await readFile(path.join(MIGRATIONS_DIR, f), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      if (done.has(f)) {
        if (done.get(f) !== checksum) throw new Error(`Migration ${f} was modified after being applied. Create a new migration instead.`);
        continue;
      }
      log(`applying ${f}`);
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into schema_migrations(name, checksum) values ($1, $2)", [f, checksum]);
        await client.query("commit");
        applied.push(f);
      } catch (e) {
        await client.query("rollback");
        throw new Error(`Migration ${f} failed: ${(e as Error).message}`);
      }
    }
    // Seed default plans once; later edits from the super-admin panel are kept.
    for (const p of DEFAULT_PLANS) {
      await client.query(
        `insert into plans(code, name, description, price_monthly, price_yearly, trial_days, limits, features, sort_order)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict (code) do nothing`,
        [p.code, p.name, p.description, p.priceMonthly, p.priceYearly, p.trialDays, JSON.stringify(p.limits), JSON.stringify(p.features), p.sortOrder],
      );
    }
    await client.query(
      `insert into platform_settings(key, value) values
         ('max_unpaid_businesses_per_user', '1'::jsonb),
         ('grace_period_days', '7'::jsonb),
         ('support_grant_hours', '24'::jsonb)
       on conflict (key) do nothing`,
    );
  } finally {
    await client.query("select pg_advisory_unlock(727274)").catch(() => undefined);
    await client.end();
  }
  return applied;
}
