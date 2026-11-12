/**
 * Fictional demo data for testing (NOT real businesses or people).
 *   DB_* env vars must point at a migrated database.   pnpm --filter @biz/api seed
 */
import { closePool } from "../src/db/pool.js";
import { seedDemo } from "../src/dev/seed.js";

seedDemo()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => closePool());
