import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import mysql from "mysql2/promise";
import { createHash } from "node:crypto";

export interface MigrateOptions {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  dir: string;
  log?: (msg: string) => void;
}

// Errors that mean "this account may not create triggers" (common on shared hosting).
const PRIVILEGE_ERRORS = new Set(["ER_SPECIFIC_ACCESS_DENIED_ERROR", "ER_BINLOG_CREATE_ROUTINE_NEED_SUPER", "ER_TABLEACCESS_DENIED_ERROR", "ER_DBACCESS_DENIED_ERROR"]);

/**
 * Applies db/mysql/NNN_*.sql files in order, once each, recorded in schema_migrations.
 * Files starting with "-- @optional" are skipped (and recorded) if the DB user lacks privileges.
 */
export async function migrate(o: MigrateOptions): Promise<string[]> {
  const log = o.log ?? console.log;
  const conn = await mysql.createConnection({
    host: o.host,
    port: o.port,
    user: o.user,
    password: o.password,
    database: o.database,
    multipleStatements: true,
    charset: "utf8mb4_unicode_ci",
  });
  try {
    await conn.query("SET time_zone = '+00:00'");
    // Only one process migrates at a time (Hostinger may start several app processes).
    const [lock] = await conn.query("SELECT GET_LOCK('bizapp_migrate', 120) AS got");
    if (!(lock as any[])[0]?.got) throw new Error("Could not get the migration lock (another migration is running).");
    await conn.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name VARCHAR(100) NOT NULL PRIMARY KEY,
      checksum CHAR(64) NOT NULL,
      status VARCHAR(10) NOT NULL DEFAULT 'applied',
      applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    const [rows] = await conn.query("SELECT name, checksum FROM schema_migrations");
    const done = new Map((rows as { name: string; checksum: string }[]).map((r) => [r.name, r.checksum]));
    const files = (await readdir(o.dir)).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();
    const applied: string[] = [];
    for (const f of files) {
      const sql = await readFile(path.join(o.dir, f), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      if (done.has(f)) {
        if (done.get(f) !== checksum) log(`warning: ${f} changed after it was applied (not re-run)`);
        continue;
      }
      const optional = sql.trimStart().startsWith("-- @optional");
      try {
        // DDL auto-commits in MySQL, so each file must be safe to fix forward.
        await conn.query(sql);
        await conn.query("INSERT INTO schema_migrations (name, checksum) VALUES (?, ?)", [f, checksum]);
        log(`applied ${f}`);
      } catch (err: any) {
        if (optional && PRIVILEGE_ERRORS.has(err?.code)) {
          await conn.query("INSERT INTO schema_migrations (name, checksum, status) VALUES (?, ?, 'skipped')", [f, checksum]);
          log(`skipped optional ${f}: ${err.code}`);
          continue;
        }
        throw new Error(`Migration ${f} failed: ${err?.message ?? err}`);
      }
      applied.push(f);
    }
    await conn.query("SELECT RELEASE_LOCK('bizapp_migrate')");
    return applied;
  } finally {
    await conn.end();
  }
}
