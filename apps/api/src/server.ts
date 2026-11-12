import { env } from "./config/env.js";
import { createApp } from "./app.js";
import { closePool, db } from "./db/pool.js";
import { migrate } from "./db/migrate.js";
import { seedDemo } from "./dev/seed.js";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

async function main() {
  const e = env(); // fails fast with a clear message if a variable is missing
  if (e.MIGRATE_ON_START === "true") {
    const dir = fileURLToPath(new URL("./migrations", import.meta.url));
    if (!existsSync(dir)) throw new Error(`MIGRATE_ON_START: migrations folder not found at ${dir}`);
    const applied = await migrate({
      host: e.DB_HOST, port: e.DB_PORT, database: e.DB_NAME, dir,
      // MIGRATION_DB_* are only needed when the app's own user lacks CREATE/ALTER rights.
      user: process.env.MIGRATION_DB_USER ?? e.DB_USER,
      password: process.env.MIGRATION_DB_PASSWORD ?? e.DB_PASSWORD,
      log: (m) => console.log(JSON.stringify({ level: "info", msg: `migrate: ${m}` })),
    });
    console.log(JSON.stringify({ level: "info", msg: "migrations checked", applied }));
  }
  try {
    await db().one("SELECT 1");
    console.log(JSON.stringify({ level: "info", msg: "database reachable", host: e.DB_HOST, db: e.DB_NAME }));
  } catch (err: any) {
    console.error(JSON.stringify({ level: "error", msg: "database NOT reachable", code: err?.code, message: err?.message }));
  }
  if (e.SEED_DEMO_ON_START === "true") {
    await seedDemo((m) => console.log(JSON.stringify({ level: "info", msg: m.trim() }))).catch((err) =>
      console.error(JSON.stringify({ level: "error", msg: "demo seed failed", message: err?.message })),
    );
  }
  if (e.SMS_PROVIDER === "console" && e.NODE_ENV === "production") {
    console.warn(JSON.stringify({ level: "warn", msg: "TEST MODE: OTPs are written to this log, not sent by SMS" }));
  }
  const server = createApp().listen(e.PORT, () => {
    console.log(JSON.stringify({ level: "info", msg: "listening", port: e.PORT, env: e.NODE_ENV }));
  });
  // No request may run longer than 120 s.
  server.requestTimeout = 120_000;
  server.headersTimeout = 30_000;
  const stop = () => server.close(() => closePool().finally(() => process.exit(0)));
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

main().catch((err) => {
  console.error(err?.message ?? err);
  process.exit(1);
});
