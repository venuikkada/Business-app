import { COMMON_GST_RATES, GST_RATES, INDIAN_STATES } from "@cba/core";
import { timingSafeEqual } from "node:crypto";
import { env, smsTestMode } from "../../config/env.js";
import { db } from "../../db/pool.js";
import { ApiRouter } from "../../http/router.js";
import { AppError } from "../../lib/errors.js";
import { SECTORS } from "../../lib/sectors.js";
import { runJobs } from "../jobs/runner.js";

export const metaRoutes = new ApiRouter("");
const r = metaRoutes;

r.get("/health", { access: { access: "public" } }, async () => {
  await db().one("SELECT 1 AS ok");
  return { ok: true, time: new Date().toISOString() };
});

/** Lists used by onboarding forms. */
r.get("/meta", { access: { access: "public" } }, async () => ({
  /** true = OTPs are not sent by SMS yet (test server) */
  smsTestMode: smsTestMode(),
  sectors: SECTORS,
  states: INDIAN_STATES,
  gstRates: GST_RATES,
  commonGstRates: COMMON_GST_RATES,
  languages: [
    { code: "en", label: "English" },
    { code: "hi", label: "हिन्दी" },
    { code: "te", label: "తెలుగు" },
    { code: "hinglish", label: "Hinglish" },
  ],
}));

/**
 * Hostinger cron fallback: `curl -fsS -X POST -H "X-Cron-Key: $CRON_SECRET" https://site/api/v1/internal/cron`
 * Runs jobs for at most ~50 s (the request stays well under the 120 s limit).
 */
r.post("/internal/cron", { access: { access: "public" } }, async ({ req }) => {
  const key = Buffer.from(req.get("x-cron-key") ?? "");
  const secret = Buffer.from(env().CRON_SECRET);
  if (key.length !== secret.length || !timingSafeEqual(key, secret)) throw new AppError(404, "not_found", "Not found.");
  return runJobs(50_000);
});
