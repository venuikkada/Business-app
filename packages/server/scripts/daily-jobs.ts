/**
 * Run once a day (e.g. 06:00 IST via cron, a Vercel Cron hitting
 * /api/cron/daily, or GitHub Actions). Safe to run repeatedly.
 *   PLATFORM_DATABASE_URL=... pnpm jobs:daily
 */
import { runDailyJobs } from "../src/platform";
import { closePools } from "../src";

runDailyJobs()
  .then((r) => console.log(JSON.stringify(r)))
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => closePools());
