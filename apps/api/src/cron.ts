import { env } from "./config/env.js";
import { closePool } from "./db/pool.js";
import { runJobs } from "./modules/jobs/runner.js";

/**
 * Hostinger cron (every minute):  node /home/<user>/<app>/dist/cron.js
 * Processes due jobs for up to ~50 seconds, then exits.
 */
env();
runJobs()
  .then((s) => console.log(JSON.stringify({ level: "info", msg: "cron run", ...s })))
  .catch((err) => {
    console.error(JSON.stringify({ level: "error", msg: "cron failed", message: err?.message }));
    process.exitCode = 1;
  })
  .finally(() => closePool());
