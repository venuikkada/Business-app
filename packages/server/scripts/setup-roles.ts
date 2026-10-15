/**
 * Enables login for the application roles created by the migrations and sets
 * their passwords. Run once per environment as the schema owner:
 *   MIGRATION_DATABASE_URL=... CBA_APP_PASSWORD=... CBA_PLATFORM_PASSWORD=... pnpm db:setup-roles
 */
import pg from "pg";

const url = process.env.MIGRATION_DATABASE_URL;
const appPw = process.env.CBA_APP_PASSWORD;
const platformPw = process.env.CBA_PLATFORM_PASSWORD;
if (!url || !appPw || !platformPw) {
  console.error("Set MIGRATION_DATABASE_URL, CBA_APP_PASSWORD and CBA_PLATFORM_PASSWORD.");
  process.exit(1);
}
if (appPw.length < 16 || platformPw.length < 16) {
  console.error("Use passwords of at least 16 characters.");
  process.exit(1);
}
const c = new pg.Client({ connectionString: url });
await c.connect();
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
await c.query(`alter role cba_app with login nobypassrls password ${lit(appPw)}`);
await c.query(`alter role cba_platform with login nobypassrls password ${lit(platformPw)}`);
await c.end();
console.log("Roles cba_app and cba_platform can now log in.");
