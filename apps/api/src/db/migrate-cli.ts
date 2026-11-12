import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "./migrate.js";

// Usage: DB_* env vars (MIGRATION_DB_USER/PASSWORD override for a higher-privilege user).
const here = path.dirname(fileURLToPath(import.meta.url));
// Bundled build: dist/migrations. Source checkout: <repo>/db/mysql.
const dir =
  process.env.MIGRATIONS_DIR ??
  (existsSync(path.join(here, "migrations")) ? path.join(here, "migrations") : path.resolve(here, "../../../../db/mysql"));

migrate({
  host: process.env.DB_HOST ?? "127.0.0.1",
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.MIGRATION_DB_USER ?? process.env.DB_USER ?? "root",
  password: process.env.MIGRATION_DB_PASSWORD ?? process.env.DB_PASSWORD ?? "",
  database: process.env.DB_NAME ?? "bizapp",
  dir,
})
  .then((applied) => {
    console.log(applied.length ? `done (${applied.length} applied)` : "database is up to date");
  })
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
