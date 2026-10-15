import { test, expect, type Page } from "@playwright/test";

const uid = Date.now().toString(36);
const email = `owner-${uid}@example.test`;
const password = "E2ePassw0rd123";

async function pick(page: Page, label: string, query: string, option: string | RegExp) {
  const box = page.getByRole("combobox", { name: label });
  await box.click();
  await box.fill(query);
  await page.getByRole("option", { name: option }).first().click();
}

test.describe.configure({ mode: "serial" });

test("owner signs up, sets up a business and completes the quote-to-cash journey", async ({ page, request }) => {
  // 1. Register
  await page.goto("/register");
  await page.getByLabel("Your name").fill("E2E Owner");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Create free account" }).click();
  await page.waitForURL("**/onboarding");

  // 2. Business setup wizard
  await page.getByLabel("Business name").fill(`E2E Computers ${uid}`);
  await page.getByLabel("State").selectOption("29");
  await page.getByLabel("City").fill("Bengaluru");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByText("Registered (regular)").click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Create my business" }).click();
  await page.waitForURL("**/dashboard**");
  await expect(page.getByText("Get started in 3 steps")).toBeVisible();

  // 3. Customer
  await page.goto("/parties/new");
  await page.getByLabel("Name").first().fill("Lakshmi Traders");
  await page.getByLabel("Mobile").fill("9845012345");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForURL(/\/parties\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "Lakshmi Traders" })).toBeVisible();

  // 4. Product with opening stock
  await page.goto("/products/new");
  await page.getByLabel("Name").first().fill("Wireless Keyboard");
  await page.getByLabel("SKU / item code").fill(`KB-${uid}`);
  await page.getByLabel("Selling price (₹)").fill("1000");
  await page.getByLabel("Purchase / cost price (₹)").fill("600");
  await page.getByLabel("Opening stock").fill("10");
  await page.getByRole("button", { name: "Save product" }).click();
  await page.waitForURL(/\/products\/[0-9a-f-]{36}$/);
  await expect(page.getByText("10 pcs").first()).toBeVisible();
  const productUrl = page.url();

  // 5. Quotation
  await page.goto("/documents/new?type=quotation");
  await pick(page, "Customer", "Lakshmi", /Lakshmi Traders/);
  await pick(page, "Item 1", "Wireless", /Wireless Keyboard/);
  await page.getByLabel("Quantity").fill("2");
  await expect(page.getByText("₹2,360.00").first()).toBeVisible(); // 2 × 1000 + 18% GST
  await page.getByRole("button", { name: "Save & send" }).click();
  await page.waitForURL(/\/documents\/quotation\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: /QT\/\d\d-\d\d\/0001/ })).toBeVisible();

  // 6. Convert to invoice without retyping, then issue
  await page.getByRole("button", { name: "→ Tax invoice" }).click();
  await page.waitForURL(/\/documents\/invoice\/[0-9a-f-]{36}\/edit$/);
  await expect(page.getByText("₹2,360.00").first()).toBeVisible();
  await page.getByRole("button", { name: /Save & issue/ }).click();
  await page.waitForURL(/\/documents\/invoice\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: /INV\/\d\d-\d\d\/0001/ })).toBeVisible();
  await expect(page.getByText("Issued").first()).toBeVisible();
  const invoiceUrl = page.url();
  const invoiceId = invoiceUrl.split("/").pop()!;

  // 7. Partial payment
  await page.getByRole("link", { name: "Record payment" }).click();
  await page.getByLabel("Amount (₹)").fill("1000");
  await page.getByLabel(/Adjust against INV/).fill("1000");
  await page.getByRole("button", { name: "Save receipt" }).click();
  await page.waitForURL(/\/payments\/[0-9a-f-]{36}$/);
  await page.goto(invoiceUrl);
  await expect(page.getByText("Partially paid").first()).toBeVisible();
  await expect(page.getByText("₹1,360.00").first()).toBeVisible();

  // 8. PDF downloads
  const pdf = await page.request.get(`/api/v1/documents/${invoiceId}/pdf`);
  expect(pdf.status()).toBe(200);
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");

  // 9. Stock went down exactly once (10 → 8)
  await page.goto(productUrl);
  await expect(page.getByText("8 pcs").first()).toBeVisible();

  // 10. Customer balance and dashboard
  await page.goto("/outstanding");
  await expect(page.getByText("Lakshmi Traders")).toBeVisible();

  // 11. CSRF: cookie-authenticated writes without the header are refused
  const csrf = await page.request.post("/api/v1/parties", { data: { name: "Nope" } });
  expect(csrf.status()).toBe(403);

  // 12. Sign out
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await page.waitForURL("**/login");
  await page.goto("/dashboard");
  await page.waitForURL("**/login");

  // Unauthenticated API access is refused.
  const anon = await request.get("/api/v1/parties");
  expect(anon.status()).toBe(401);
});

test("another business cannot open the first business's invoice", async ({ page }) => {
  await page.goto("/register");
  await page.getByLabel("Your name").fill("Other Owner");
  await page.getByLabel("Email").fill(`other-${uid}@example.test`);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Create free account" }).click();
  await page.waitForURL("**/onboarding");
  await page.getByLabel("Business name").fill(`Other Shop ${uid}`);
  await page.getByLabel("State").selectOption("27");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Create my business" }).click();
  await page.waitForURL("**/dashboard**");
  const list = await page.request.get("/api/v1/documents?type=invoice");
  expect(((await list.json()) as { total: number }).total).toBe(0);
  const parties = await page.request.get("/api/v1/parties?q=Lakshmi");
  expect(((await parties.json()) as { total: number }).total).toBe(0);
});
