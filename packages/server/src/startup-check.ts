import { appTx, platformTx } from "./db";

/**
 * Logs one structured line per check when the server starts, so hosting
 * dashboards that only show JSON log lines (e.g. Hostinger) can report whether
 * configuration and database access are healthy. Never logs secret values —
 * only variable names and database error messages.
 */
const REQUIRED = ["DATABASE_URL", "PLATFORM_DATABASE_URL", "APP_SECRET", "APP_URL"] as const;

function log(level: "INFO" | "WARN" | "ERROR", message: string) {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), level, message }));
}

function describe(e: unknown): string {
  const err = e as { code?: string; message?: string };
  return [err.code, err.message].filter(Boolean).join(" ").slice(0, 300) || "unknown error";
}

export async function runStartupChecks(): Promise<void> {
  const missing = REQUIRED.filter((k) => !process.env[k]);
  if (missing.length) log("ERROR", `startup: missing environment variables: ${missing.join(", ")}`);
  else log("INFO", "startup: required environment variables present");
  if (process.env.NODE_ENV === "production" && !process.env.SMTP_URL) log("WARN", "startup: SMTP_URL not set — verification and password-reset emails will not be sent");

  if (process.env.DATABASE_URL) {
    try {
      const r = await appTx({}, (db) =>
        db.one<{ has_jobs: boolean; plans: number }>(
          "select to_regprocedure('app.daily_maintenance(date)') is not null as has_jobs, (select count(*)::int from plans) as plans",
        ),
      );
      log("INFO", `startup: database ok (app role); plans=${r.plans}`);
      if (!r.has_jobs) log("WARN", "startup: migration 0007 (daily jobs, share links) is not applied");
    } catch (e) {
      log("ERROR", `startup: database connection failed (app role): ${describe(e)}`);
    }
  }
  if (process.env.PLATFORM_DATABASE_URL) {
    try {
      await platformTx({}, (db) => db.one("select 1 as ok"));
      log("INFO", "startup: database ok (platform role)");
    } catch (e) {
      log("ERROR", `startup: database connection failed (platform role): ${describe(e)}`);
    }
  }
}
