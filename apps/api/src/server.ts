import { env } from "./config/env.js";
import { createApp } from "./app.js";
import { closePool, db } from "./db/pool.js";

async function main() {
  const e = env(); // fails fast with a clear message if a variable is missing
  try {
    await db().one("SELECT 1");
    console.log(JSON.stringify({ level: "info", msg: "database reachable", host: e.DB_HOST, db: e.DB_NAME }));
  } catch (err: any) {
    console.error(JSON.stringify({ level: "error", msg: "database NOT reachable", code: err?.code, message: err?.message }));
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
