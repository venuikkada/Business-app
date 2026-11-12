import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

/**
 * All secrets come from environment variables (set them in hPanel → Node.js →
 * Environment variables). Nothing secret is ever committed to Git.
 */
const hex64 = z.string().regex(/^[0-9a-f]{64}$/i, "must be 64 hex characters (32 bytes)");

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().default(3000),
    APP_ORIGIN: z.string().url().default("http://localhost:5173"),
    TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(1),

    // "localhost" can resolve to IPv6 (::1) in Node, which Hostinger MySQL users may not be allowed from.
    DB_HOST: z.string().default("127.0.0.1").transform((h) => (h === "localhost" ? "127.0.0.1" : h)),
    DB_PORT: z.coerce.number().int().default(3306),
    DB_USER: z.string().min(1),
    DB_PASSWORD: z.string().default(""),
    DB_NAME: z.string().min(1),
    DB_CONNECTION_LIMIT: z.coerce.number().int().min(1).max(50).default(8),

    JWT_SECRET: z.string().min(32),
    OTP_SECRET: z.string().min(32),
    DATA_ENCRYPTION_KEY: hex64,
    CRON_SECRET: z.string().min(32),

    SMS_PROVIDER: z.enum(["console", "msg91"]).default("console"),
    /** Test mode on a real server before SMS is set up: OTPs go to the server log only. */
    ALLOW_CONSOLE_SMS: z.enum(["true", "false"]).default("false"),
    /** "true" = load the fictional demo data at start (needs DEMO_PASSWORD, 12+ chars). Test servers only. */
    SEED_DEMO_ON_START: z.enum(["true", "false"]).default("false"),
    DEMO_PASSWORD: z.string().optional(),
    MSG91_AUTH_KEY: z.string().optional(),
    MSG91_OTP_TEMPLATE_ID: z.string().optional(),
    /** Safety cap on OTP SMS per day for the whole platform (protects your SMS credit from bots). */
    OTP_GLOBAL_DAILY_LIMIT: z.coerce.number().int().min(10).default(3000),

    STORAGE_DIR: z.string().default("./storage"),
    /** "true" = apply new db/mysql migrations when the server starts (handy on Hostinger without SSH). */
    MIGRATE_ON_START: z.enum(["true", "false"]).default("false"),
    PUBLIC_DIR: z.string().optional(),
    COOKIE_SECURE: z.enum(["true", "false"]).optional(),
  })
  .superRefine((e, ctx) => {
    if (e.NODE_ENV === "production") {
      if (e.SMS_PROVIDER === "console" && e.ALLOW_CONSOLE_SMS !== "true")
        ctx.addIssue({ code: "custom", path: ["SMS_PROVIDER"], message: "console SMS is not allowed in production (set ALLOW_CONSOLE_SMS=true only on a test server)" });
      if (!e.APP_ORIGIN.startsWith("https://"))
        ctx.addIssue({ code: "custom", path: ["APP_ORIGIN"], message: "must be https in production" });
    }
    if (e.SEED_DEMO_ON_START === "true" && (!e.DEMO_PASSWORD || e.DEMO_PASSWORD.length < 12))
      ctx.addIssue({ code: "custom", path: ["DEMO_PASSWORD"], message: "DEMO_PASSWORD (12+ characters) is required with SEED_DEMO_ON_START" });
    if (e.SMS_PROVIDER === "msg91" && (!e.MSG91_AUTH_KEY || !e.MSG91_OTP_TEMPLATE_ID))
      ctx.addIssue({ code: "custom", path: ["MSG91_AUTH_KEY"], message: "MSG91_AUTH_KEY and MSG91_OTP_TEMPLATE_ID are required" });
  });

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

const AUTO_KEYS = ["JWT_SECRET", "OTP_SECRET", "DATA_ENCRYPTION_KEY"] as const;

/**
 * AUTO_SECRETS=true: missing JWT_SECRET / OTP_SECRET / DATA_ENCRYPTION_KEY are created once on
 * the server and kept in STORAGE_DIR/.app-secrets.json (owner-only permissions), so the keys
 * never have to pass through anyone's chat or laptop. Variables that ARE set always win.
 * Back this file up: without DATA_ENCRYPTION_KEY the encrypted backups cannot be opened.
 */
export function loadAutoSecrets(): void {
  if (process.env.AUTO_SECRETS !== "true" || !process.env.STORAGE_DIR) return;
  if (AUTO_KEYS.every((k) => process.env[k])) return;
  const dir = path.resolve(process.env.STORAGE_DIR);
  const file = path.join(dir, ".app-secrets.json");
  const read = (): Record<string, string> => {
    try {
      return JSON.parse(readFileSync(file, "utf8"));
    } catch {
      return {};
    }
  };
  let data = read();
  if (!AUTO_KEYS.every((k) => data[k])) {
    const fresh: Record<string, string> = { ...data };
    for (const k of AUTO_KEYS) fresh[k] ??= randomBytes(32).toString("hex");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    try {
      // "wx": only one process creates the file; the others read what it wrote.
      writeFileSync(file, JSON.stringify(fresh), { mode: 0o600, flag: Object.keys(data).length ? "w" : "wx" });
    } catch (e: any) {
      if (e?.code !== "EEXIST") throw e;
    }
    data = read();
  }
  for (const k of AUTO_KEYS) if (!process.env[k] && data[k]) process.env[k] = data[k];
}

export function env(): Env {
  if (cached) return cached;
  loadAutoSecrets();
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join("\n")}`);
  }
  cached = parsed.data;
  return cached;
}

export const isProd = () => env().NODE_ENV === "production";
/** True while OTPs are not really sent by SMS (development or a test server). */
export const smsTestMode = () => env().SMS_PROVIDER === "console";
export const cookieSecure = () => (env().COOKIE_SECURE ? env().COOKIE_SECURE === "true" : isProd());

/** Tests change process.env between files; this clears the cache. */
export function resetEnvCache() {
  cached = null;
}
