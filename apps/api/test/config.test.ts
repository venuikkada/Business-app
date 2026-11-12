import { afterEach, describe, expect, it } from "vitest";
import { env, resetEnvCache } from "../src/config/env.js";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
  resetEnvCache();
});

function prod(extra: Record<string, string>) {
  Object.assign(process.env, { NODE_ENV: "production", APP_ORIGIN: "https://example.in", SMS_PROVIDER: "console" }, extra);
  resetEnvCache();
  return () => env();
}

describe("production configuration", () => {
  it("refuses console SMS unless test mode is switched on explicitly", () => {
    expect(prod({})).toThrow(/console SMS is not allowed/);
    expect(prod({ ALLOW_CONSOLE_SMS: "true" })).not.toThrow();
  });
  it("demo data needs a strong DEMO_PASSWORD", () => {
    expect(prod({ ALLOW_CONSOLE_SMS: "true", SEED_DEMO_ON_START: "true" })).toThrow(/DEMO_PASSWORD/);
    expect(prod({ ALLOW_CONSOLE_SMS: "true", SEED_DEMO_ON_START: "true", DEMO_PASSWORD: "short" })).toThrow(/DEMO_PASSWORD/);
    expect(prod({ ALLOW_CONSOLE_SMS: "true", SEED_DEMO_ON_START: "true", DEMO_PASSWORD: "a-long-demo-pass-2026" })).not.toThrow();
  });
  it("refuses http APP_ORIGIN in production", () => {
    expect(prod({ ALLOW_CONSOLE_SMS: "true", APP_ORIGIN: "http://example.in" })).toThrow(/https/);
  });
});

describe("AUTO_SECRETS", () => {
  it("creates the keys once in STORAGE_DIR and reuses them on the next start", async () => {
    const { mkdtempSync, readFileSync, statSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const dir = mkdtempSync(`${tmpdir()}/autosec-`);
    for (const k of ["JWT_SECRET", "OTP_SECRET", "DATA_ENCRYPTION_KEY"]) delete process.env[k];
    const run = prod({ ALLOW_CONSOLE_SMS: "true", AUTO_SECRETS: "true", STORAGE_DIR: dir });
    const first = run();
    expect(first.DATA_ENCRYPTION_KEY).toMatch(/^[0-9a-f]{64}$/);
    expect(first.JWT_SECRET).not.toBe(first.OTP_SECRET);
    expect(statSync(`${dir}/.app-secrets.json`).mode & 0o777).toBe(0o600);
    // "Restart": env vars gone again, same keys come back from the file.
    for (const k of ["JWT_SECRET", "OTP_SECRET", "DATA_ENCRYPTION_KEY"]) delete process.env[k];
    resetEnvCache();
    expect(env().JWT_SECRET).toBe(first.JWT_SECRET);
    expect(JSON.parse(readFileSync(`${dir}/.app-secrets.json`, "utf8")).DATA_ENCRYPTION_KEY).toBe(first.DATA_ENCRYPTION_KEY);
  });
});
