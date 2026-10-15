/**
 * Server configuration. All secrets come from environment variables and are
 * only ever read on the server. Nothing here is bundled into browser or
 * Android code.
 */
function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") throw new Error(`Missing required environment variable ${name}`);
  return v;
}

export const env = {
  get nodeEnv() {
    return process.env.NODE_ENV ?? "development";
  },
  get isProd() {
    return process.env.NODE_ENV === "production";
  },
  /** Connection string for the RLS-restricted tenant role (cba_app). */
  get databaseUrl() {
    return req("DATABASE_URL");
  },
  /** Connection string for the super-admin role (cba_platform). */
  get platformDatabaseUrl() {
    return req("PLATFORM_DATABASE_URL", process.env.DATABASE_URL);
  },
  /** 32+ byte secret used for encrypting TOTP secrets and signing tokens. */
  get appSecret() {
    const s = req("APP_SECRET", process.env.NODE_ENV === "production" ? undefined : "dev-only-insecure-secret-change-me-0123456789");
    if (process.env.NODE_ENV === "production" && s.length < 32) throw new Error("APP_SECRET must be at least 32 characters");
    return s;
  },
  get appUrl() {
    return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  },
  get adminUrl() {
    return (process.env.ADMIN_URL ?? "http://localhost:3001").replace(/\/$/, "");
  },
  get storageDriver(): "local" | "s3" {
    return process.env.STORAGE_DRIVER === "s3" ? "s3" : "local";
  },
  get storageLocalDir() {
    return process.env.STORAGE_LOCAL_DIR ?? "./storage";
  },
  get razorpayKeyId() {
    return process.env.RAZORPAY_KEY_ID ?? "";
  },
  get razorpayKeySecret() {
    return process.env.RAZORPAY_KEY_SECRET ?? "";
  },
  get razorpayWebhookSecret() {
    return process.env.RAZORPAY_WEBHOOK_SECRET ?? "";
  },
  get mailFrom() {
    return process.env.MAIL_FROM ?? "CRAZY BUSINESS APP <no-reply@localhost>";
  },
  get smtpUrl() {
    return process.env.SMTP_URL ?? "";
  },
  get cronSecret() {
    return process.env.CRON_SECRET ?? "";
  },
};
