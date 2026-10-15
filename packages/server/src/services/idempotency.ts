import { createHash } from "node:crypto";
import type { Tenant } from "../context";
import { AppError } from "../errors";

/**
 * Replays the stored response for a repeated Idempotency-Key (e.g. a mobile
 * app retrying "Save invoice" on a flaky network) instead of creating a
 * duplicate record. The key row is written in the same transaction as the
 * work, so a failed request leaves no key behind.
 */
export async function idempotent<T>(t: Tenant, key: string | null | undefined, body: unknown, fn: () => Promise<T>): Promise<T> {
  if (!key) return fn();
  if (!/^[\w-]{8,100}$/.test(key)) throw new AppError("VALIDATION", "Invalid Idempotency-Key");
  const hash = createHash("sha256").update(JSON.stringify(body ?? null)).digest("hex");
  const inserted = await t.db.maybe(
    "insert into idempotency_keys(business_id, key, user_id, request_hash) values ($1,$2,$3,$4) on conflict do nothing returning key",
    [t.businessId, key, t.userId, hash],
  );
  if (!inserted) {
    const ex = await t.db.one<{ request_hash: string; response: T | null }>("select request_hash, response from idempotency_keys where business_id = $1 and key = $2", [t.businessId, key]);
    if (ex.request_hash !== hash) throw new AppError("CONFLICT", "This Idempotency-Key was already used for a different request");
    if (ex.response === null) throw new AppError("CONFLICT", "The same request is already being processed");
    return ex.response;
  }
  const result = await fn();
  await t.db.exec("update idempotency_keys set response = $3, status_code = 200 where business_id = $1 and key = $2", [t.businessId, key, JSON.stringify(result ?? null)]);
  return result;
}
