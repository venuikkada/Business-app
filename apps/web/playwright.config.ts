import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests run against a real server and database.
 * Locally:  pnpm build && pnpm test:e2e   (uses .env.local)
 * CI:       the workflow builds, migrates and starts the app first.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "en-IN",
    timezoneId: "Asia/Kolkata",
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : undefined,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, testIgnore: /mobile\.spec\.ts/ },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /mobile\.spec\.ts/ },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: "npx next start -p 3000", url: "http://localhost:3000/api/v1/health", reuseExistingServer: true, timeout: 120_000 },
});
