import mysql, { type Pool, type PoolConnection, type ResultSetHeader } from "mysql2/promise";
import { env } from "../config/env.js";

let pool: Pool | null = null;

export function getPool(): Pool {
  if (pool) return pool;
  const e = env();
  pool = mysql.createPool({
    host: e.DB_HOST,
    port: e.DB_PORT,
    user: e.DB_USER,
    password: e.DB_PASSWORD,
    database: e.DB_NAME,
    connectionLimit: e.DB_CONNECTION_LIMIT,
    waitForConnections: true,
    namedPlaceholders: true,
    timezone: "Z", // DATETIME values are UTC
    dateStrings: ["DATE"], // business dates stay as 'YYYY-MM-DD' (no timezone shift)
    supportBigNumbers: true,
    charset: "utf8mb4_unicode_ci",
    connectTimeout: 10_000,
  });
  // CURRENT_TIMESTAMP in SQL must also be UTC.
  pool.on("connection", (conn) => {
    conn.query("SET time_zone = '+00:00'");
  });
  return pool;
}

export async function closePool() {
  if (pool) {
    const p = pool;
    pool = null;
    await p.end();
  }
}

export type Params = Record<string, unknown>;
type Conn = Pool | PoolConnection;

function clean(params: Params = {}): Params {
  const out: Params = {};
  for (const [k, v] of Object.entries(params)) out[k] = v === undefined ? null : v;
  return out;
}

/**
 * Thin query helper for PLATFORM tables (users, sessions, otp ...).
 * Business data must go through TenantDb instead.
 */
export class Db {
  constructor(protected readonly conn: Conn) {}

  async all<T = any>(sql: string, params?: Params): Promise<T[]> {
    const [rows] = await this.conn.query(sql, clean(params));
    return rows as T[];
  }

  async one<T = any>(sql: string, params?: Params): Promise<T | null> {
    const rows = await this.all<T>(sql, params);
    return rows[0] ?? null;
  }

  async exec(sql: string, params?: Params): Promise<ResultSetHeader> {
    const [res] = await this.conn.query(sql, clean(params));
    return res as ResultSetHeader;
  }

  get raw(): Conn {
    return this.conn;
  }
}

/**
 * Query helper for BUSINESS tables. Every statement must use :tenantId and the
 * value is always injected from the signed-in context, never from user input.
 * A query without :tenantId throws before it reaches MySQL.
 */
export class TenantDb extends Db {
  constructor(conn: Conn, readonly tenantId: number) {
    super(conn);
  }

  private check(sql: string) {
    if (!sql.includes(":tenantId")) {
      throw new Error("TenantDb: query is not scoped to :tenantId");
    }
  }

  override async all<T = any>(sql: string, params?: Params): Promise<T[]> {
    this.check(sql);
    return super.all<T>(sql, { ...params, tenantId: this.tenantId });
  }

  override async exec(sql: string, params?: Params): Promise<ResultSetHeader> {
    this.check(sql);
    return super.exec(sql, { ...params, tenantId: this.tenantId });
  }
}

export function db(): Db {
  return new Db(getPool());
}

/** Runs fn inside one transaction; rolls back on any error. */
export async function withTx<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const out = await fn(conn);
    await conn.commit();
    return out;
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

/** MariaDB returns JSON columns as strings, MySQL as objects. Accept both. */
export function json<T>(v: unknown, fallback: T): T {
  if (v == null) return fallback;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return v as T;
}
