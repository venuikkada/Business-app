import mysql from "mysql2/promise";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rm } from "node:fs/promises";
import { migrate } from "../src/db/migrate.js";

/**
 * Creates a fresh test database and an app user WITHOUT DDL rights, like production.
 * Needs a local MySQL/MariaDB admin login: TEST_DB_ADMIN_USER / TEST_DB_ADMIN_PASSWORD
 * (default: root with no password, e.g. a local dev MariaDB).
 */
export default async function setup() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const host = process.env.DB_HOST ?? "127.0.0.1";
  const port = Number(process.env.DB_PORT ?? 3306);
  const name = process.env.TEST_DB_NAME ?? "bizapp_test";
  const adminUser = process.env.TEST_DB_ADMIN_USER ?? "root";
  const adminPassword = process.env.TEST_DB_ADMIN_PASSWORD ?? "";
  const appUser = process.env.TEST_DB_USER ?? "bizapp_test";
  const appPassword = process.env.TEST_DB_PASSWORD ?? "bizapp_test_pw";
  if (!/^bizapp_test\w*$/.test(name)) throw new Error("Refusing to reset a database whose name does not start with bizapp_test");

  const admin = await mysql.createConnection({ host, port, user: adminUser, password: adminPassword, socketPath: process.env.TEST_DB_SOCKET });
  await admin.query(`DROP DATABASE IF EXISTS \`${name}\``);
  await admin.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  for (const h of ["localhost", "127.0.0.1", "%"]) {
    await admin.query(`CREATE USER IF NOT EXISTS ?@? IDENTIFIED BY ?`, [appUser, h, appPassword]);
    await admin.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON \`${name}\`.* TO ?@?`, [appUser, h]);
  }
  await admin.end();

  await migrate({ host, port, user: adminUser, password: adminPassword, database: name, dir: path.resolve(here, "../../../db/mysql"), log: () => {} });
  await rm(path.join(here, ".storage"), { recursive: true, force: true });
}
