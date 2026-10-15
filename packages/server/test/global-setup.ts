/**
 * Creates a throw-away database, applies all migrations as the owner and
 * enables the two application roles. Configure with:
 *   TEST_DB_ADMIN_URL   superuser/owner URL (default postgres://postgres:postgres@localhost:5432/postgres)
 *   TEST_ROLE_PASSWORD  password set on cba_app / cba_platform for tests
 */
import pg from "pg";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { migrate } from "../src/migrate";

const admin = process.env.TEST_DB_ADMIN_URL ?? "postgres://postgres:postgres@localhost:5432/postgres";
const rolePw = process.env.TEST_ROLE_PASSWORD ?? "cba_test_role_password";
const dbName = `cba_test_${process.pid}_${Date.now()}`;

export async function setup() {
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
  await o.query(`alter role cba_app with login nobypassrls password '${rolePw}'`);
  await o.query(`alter role cba_platform with login nobypassrls password '${rolePw}'`);
  await o.end();
  const appUrl = new URL(ownerUrl);
  appUrl.username = "cba_app";
  appUrl.password = rolePw;
  const platUrl = new URL(ownerUrl);
  platUrl.username = "cba_platform";
  platUrl.password = rolePw;
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
