import { db } from "../db/pool.js";
import { tooMany } from "../lib/errors.js";

/**
 * Fixed-window counter stored in MySQL, so limits survive restarts and work when
 * Hostinger runs more than one Node.js process. Returns the hit count.
 */
export async function hit(bucket: string, windowSec: number): Promise<{ hits: number; retryAfter: number }> {
  const nowSec = Math.floor(Date.now() / 1000);
  const start = nowSec - (nowSec % windowSec);
  const res = await db().exec(
    `INSERT INTO rate_limits (bucket, window_start, hits) VALUES (:bucket, FROM_UNIXTIME(:start), 1)
     ON DUPLICATE KEY UPDATE hits = LAST_INSERT_ID(hits + 1)`,
    { bucket: bucket.slice(0, 190), start },
  );
  // On a fresh insert insertId is 0 (no auto-increment) -> first hit.
  const hits = res.insertId ? Number(res.insertId) : 1;
  return { hits, retryAfter: start + windowSec - nowSec };
}

export async function limit(bucket: string, max: number, windowSec: number, message?: string): Promise<void> {
  const { hits, retryAfter } = await hit(bucket, windowSec);
  if (hits > max) throw tooMany(Math.max(1, retryAfter), message);
}

/** Cheap in-memory limiter for general API traffic (per process). */
const buckets = new Map<string, { count: number; reset: number }>();
export function memoryLimit(key: string, max: number, windowMs: number): number | null {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset <= now) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    if (buckets.size > 50_000) for (const [k, v] of buckets) if (v.reset <= now) buckets.delete(k);
    return null;
  }
  b.count++;
  return b.count > max ? Math.ceil((b.reset - now) / 1000) : null;
}
