import pg from "pg";
import { env } from "./env";
import { fromPgError } from "./errors";

// Keep DATE as 'YYYY-MM-DD' strings (no timezone shifting) and NUMERIC as
// strings (no float rounding). Timestamps become ISO strings.
pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(1700, (v) => v);
pg.types.setTypeParser(1184, (v) => new Date(v).toISOString());
pg.types.setTypeParser(1114, (v) => new Date(v + "Z").toISOString());
pg.types.setTypeParser(20, (v) => Number(v)); // bigint counts

export type Row = Record<string, unknown>;

export interface Db {
  query<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T = Row>(sql: string, params?: unknown[]): Promise<T>;
  maybe<T = Row>(sql: string, params?: unknown[]): Promise<T | null>;
  exec(sql: string, params?: unknown[]): Promise<number>;
}

function wrap(client: pg.PoolClient): Db {
  const query = async <T>(sql: string, params: unknown[] = []) => {
    try {
      const r = await client.query(sql, params as unknown[]);
      return r.rows as T[];
    } catch (e) {
      throw fromPgError(e);
    }
  };
  return {
    query,
    async one<T>(sql: string, params?: unknown[]) {
      const rows = await query<T>(sql, params);
      if (rows.length !== 1) throw new Error(`Expected exactly one row, got ${rows.length}`);
      return rows[0]!;
    },
    async maybe<T>(sql: string, params?: unknown[]) {
      const rows = await query<T>(sql, params);
      return rows[0] ?? null;
    },
    async exec(sql: string, params?: unknown[]) {
      try {
        const r = await client.query(sql, params as unknown[]);
        return r.rowCount ?? 0;
      } catch (e) {
        throw fromPgError(e);
      }
    },
  };
}

/**
 * TLS for hosted PostgreSQL whose certificates are signed by the provider's own
 * CA (e.g. Supabase): DB_SSL_CA_BASE64 holds that CA in PEM, base64-encoded.
 * The server certificate is then fully verified (chain + hostname). Without
 * it, TLS follows the connection string's sslmode.
 */
export function sslOptions(): pg.PoolConfig["ssl"] {
  const ca = process.env.DB_SSL_CA_BASE64;
  if (!ca) return undefined;
  return { ca: Buffer.from(ca, "base64").toString("utf8"), rejectUnauthorized: true };
}

const pools = new Map<string, pg.Pool>();
function pool(url: string): pg.Pool {
  let p = pools.get(url);
  if (!p) {
    p = new pg.Pool({ connectionString: url, ssl: sslOptions(), max: Number(process.env.DB_POOL_MAX ?? 10), idleTimeoutMillis: 30_000 });
    pools.set(url, p);
  }
  return p;
}

export interface TxContext {
  userId?: string | null;
  businessId?: string | null;
}

/**
 * Runs `fn` in a transaction on the given pool. The request context is set
 * with transaction-local settings so RLS policies can enforce tenant
 * isolation; nothing leaks to the next request on the pooled connection.
 */
export async function transaction<T>(url: string, ctx: TxContext, fn: (db: Db) => Promise<T>): Promise<T> {
  const client = await pool(url).connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.user_id', $1, true), set_config('app.business_id', $2, true)", [ctx.userId ?? "", ctx.businessId ?? ""]);
    const result = await fn(wrap(client));
    await client.query("commit");
    return result;
  } catch (e) {
    await client.query("rollback").catch(() => undefined);
    throw fromPgError(e);
  } finally {
    client.release();
  }
}

/** Tenant traffic: RLS-restricted cba_app role. */
export function appTx<T>(ctx: TxContext, fn: (db: Db) => Promise<T>): Promise<T> {
  return transaction(env.databaseUrl, ctx, fn);
}

/** Super-admin traffic: cba_platform role (no grants on tenant business data). */
export function platformTx<T>(ctx: TxContext, fn: (db: Db) => Promise<T>): Promise<T> {
  return transaction(env.platformDatabaseUrl, ctx, fn);
}

export async function closePools() {
  await Promise.all([...pools.values()].map((p) => p.end()));
  pools.clear();
}
