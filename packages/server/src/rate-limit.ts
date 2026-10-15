import type { Db } from "./db";
import { AppError } from "./errors";

/**
 * Fixed-window rate limiter stored in PostgreSQL so it works across
 * multiple server instances. `bucket` should identify the actor and action,
 * e.g. "login:ip:1.2.3.4" or "login:email:a@b.com".
 */
export async function rateLimit(db: Db, bucket: string, limit: number, windowSeconds: number): Promise<void> {
  const row = await db.one<{ hits: number }>(
    `insert into rate_limits(bucket, window_start, hits)
     values ($1, to_timestamp(floor(extract(epoch from now()) / $2) * $2), 1)
     on conflict (bucket, window_start) do update set hits = rate_limits.hits + 1
     returning hits`,
    [bucket, windowSeconds],
  );
  if (row.hits > limit) {
    throw new AppError("RATE_LIMITED", "Too many attempts. Please wait a few minutes and try again.", { retryAfterSeconds: windowSeconds });
  }
}

export async function pruneRateLimits(db: Db) {
  await db.exec("delete from rate_limits where window_start < now() - interval '1 day'");
}
