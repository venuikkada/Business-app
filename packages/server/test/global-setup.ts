/**
 * Creates a throw-away database, applies all migrations as the owner and
 * enables the two application roles. Configure with:
 *   TEST_DB_ADMIN_URL   superuser/owner URL (default postgres://postgres:postgres@localhost:5432/postgres)
 *   CBA_APP_PASSWORD / CBA_PLATFORM_PASSWORD  role passwords (roles are cluster-wide,
 *   so the defaults match the local development setup in docs/DEPLOYMENT.md)
 * Refuses to run against a non-local server unless ALLOW_REMOTE_TEST_DB=1, because
 * it changes the passwords of the cluster-wide application roles.
 */
import pg from "pg";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { migrate } from "../src/migrate";

const admin = process.env.TEST_DB_ADMIN_URL ?? "postgres://postgres:postgres@localhost:5432/postgres";
const appPw = process.env.CBA_APP_PASSWORD ?? "cba_app_dev_password";
const platformPw = process.env.CBA_PLATFORM_PASSWORD ?? "cba_platform_dev_password";
const dbName = `cba_test_${process.pid}_${Date.now()}`;

export async function setup() {
  const host = new URL(admin).hostname;
  if (!["localhost", "127.0.0.1", "::1", "postgres"].includes(host) && process.env.ALLOW_REMOTE_TEST_DB !== "1") {
    throw new Error(`Refusing to run integration tests against ${host}. Use a local/CI database.`);
  }
  const c = new pg.Client({ connectionString: admin });
  await c.connect();
  await c.query(`create database ${dbName}`);
  await c.end();
  const u = new URL(admin);
  u.pathname = `/${dbName}`;
  const ownerUrl = u.toString();
  await migrate(ownerUrl, () => undefined);
  const o = new pg.Client({ connectionString: ownerUrl });
  await o.connect();
  await o.query(`alter role cba_app with login nobypassrls password '${appPw.replace(/'/g, "''")}'`);
  await o.query(`alter role cba_platform with login nobypassrls password '${platformPw.replace(/'/g, "''")}'`);
  await o.end();
  const appUrl = new URL(ownerUrl);
  appUrl.username = "cba_app";
  appUrl.password = appPw;
  const platUrl = new URL(ownerUrl);
  platUrl.username = "cba_platform";
  platUrl.password = platformPw;
  writeFileSync(
    path.join(__dirname, ".test-env.json"),
    JSON.stringify({ DATABASE_URL: appUrl.toString(), PLATFORM_DATABASE_URL: platUrl.toString(), OWNER_URL: ownerUrl }),
  );
}

export async function teardown() {
  if (process.env.KEEP_TEST_DB) return;
  const c = new pg.Client({ connectionString: admin });
  await c.connect();
  await c.query(`drop database if exists ${dbName} with (force)`);
  await c.end();
}
