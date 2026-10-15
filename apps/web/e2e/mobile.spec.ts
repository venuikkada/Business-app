import { test, expect } from "@playwright/test";

test("demo dashboard works on a phone with bottom navigation and no horizontal scroll", async ({ page }) => {
  test.skip(!process.env.E2E_DEMO_EMAIL && !process.env.CI_DEMO, "needs seeded demo account");
  await page.goto("/login");
  await page.getByLabel("Email").fill(process.env.E2E_DEMO_EMAIL ?? "demo@crazybusiness.example");
  await page.getByLabel("Password").fill(process.env.E2E_DEMO_PASSWORD ?? "DemoPassw0rd2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard**");
  const nav = page.getByRole("navigation", { name: "Bottom" });
  await expect(nav).toBeVisible();
  for (const label of ["Home", "Sales", "Inventory", "Customers", "More"]) await expect(nav.getByText(label)).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await nav.getByText("Sales").click();
  await page.waitForURL("**/documents/invoice");
  await expect(page.getByRole("heading", { name: "Invoices" })).toBeVisible();
});
