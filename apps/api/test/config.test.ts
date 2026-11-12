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
