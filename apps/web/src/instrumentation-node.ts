import { runStartupChecks } from "@cba/server/startup-check";

// Skipped while `next build` collects page data; never blocks or crashes start-up.
if (process.env.NEXT_PHASE !== "phase-production-build") {
  runStartupChecks().catch(() => undefined);
}
