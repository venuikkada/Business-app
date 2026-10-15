import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { afterAll } from "vitest";
import { closePools } from "../src/db";

const cfg = JSON.parse(readFileSync(path.join(__dirname, ".test-env.json"), "utf8"));
process.env.DATABASE_URL = cfg.DATABASE_URL;
process.env.PLATFORM_DATABASE_URL = cfg.PLATFORM_DATABASE_URL;
process.env.TEST_OWNER_URL = cfg.OWNER_URL;
process.env.APP_SECRET = "test-secret-test-secret-test-secret-0123";
process.env.STORAGE_LOCAL_DIR = path.join(__dirname, ".storage");

afterAll(async () => {
  await closePools();
});
