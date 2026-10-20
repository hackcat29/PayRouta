import "dotenv/config";
import { test, expect } from "@playwright/test";
import { createOTP } from "@better-auth/utils/otp";
import AxeBuilder from "@axe-core/playwright";
const origin = process.env.PAYROUTA_TEST_ORIGIN ?? "http://127.0.0.1:3000";
test("merchant workspace: auth, environment isolation, payment table and mobile accessibility", async ({
  page,
}) => {
  const login = () =>
    page.request.post("/api/auth/sign-in/email", {
      headers: { Origin: origin },
      data: { email: "owner@harbor.example", password: "PayRouta-Local-2026!" },
    });
  let signIn = await login();
  // The suite performs four sign-ins from one IP. Honor the production
  // three-per-ten-second auth limit instead of disabling it for tests.
  if (signIn.status() === 429) {
    const retryAfter = Number(signIn.headers()["retry-after"]);
    await new Promise((resolve) =>
      setTimeout(
        resolve,
        (Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(retryAfter + 1, 60)
          : 11) * 1000,
      ),
    );
    signIn = await login();
  }
  expect(signIn.ok(), await signIn.text()).toBeTruthy();
  const verified = await page.request.post("/api/auth/two-factor/verify-totp", {
    headers: { Origin: origin },
    data: {
      code: await createOTP("payrouta-fictional-totp-secret").totp(),
      trustDevice: false,
    },
  });
  expect(verified.ok(), await verified.text()).toBeTruthy();
  const stepUp = await page.request.post("/api/portal/command", {
    headers: { Origin: origin },
    data: {
      action: "step-up",
      code: await createOTP("payrouta-fictional-totp-secret").totp(),
    },
  });
  expect(stepUp.ok(), await stepUp.text()).toBeTruthy();
  await page.goto("/merchant/overview?orgId=payment-demo-merchant");
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Payments received", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Recent payments", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Operational journal totals")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Payment methods", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Developers", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Settings", exact: true }),
  ).toBeVisible();
  const testMode = page.getByRole("switch", { name: "Test mode" });
  await expect(testMode).toHaveAttribute("aria-checked", "true");
  await testMode.click();
  await expect(
    page.getByRole("heading", { name: "No live access yet" }),
  ).toBeVisible();
  await expect(testMode).toHaveAttribute("aria-checked", "false");
  await testMode.click();
  await expect(page.getByText("You're viewing test data.", { exact: false })).toBeVisible();
  await page.getByRole("link", { name: "Transactions", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Transactions", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "Amount", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/merchant-payments-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "Filter", exact: true }),
  ).toBeVisible();
  const a11y = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(a11y.violations).toEqual([]);
  await page.screenshot({
    path: "test-results/merchant-payments-mobile.png",
    fullPage: true,
  });
  // On a phone the sidebar is a drawer.
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("link", { name: "Business setup", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Your business", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Legal name", { exact: true })
    .fill("Fictional Test Merchant");
  await page
    .getByLabel("Search operating country", { exact: true })
    .fill("Nigeria");
  await page
    .getByLabel("Operating country", { exact: true })
    .selectOption("NG");
  await page
    .getByLabel(/Website or social page/)
    .fill("https://merchant.example.test");
  await page
    .getByLabel("Business activity", { exact: true })
    .fill("Neighborhood retail sales and local checkout totals.");
  await page
    .getByLabel("Business contact email", { exact: true })
    .fill("business@example.test");
  await page
    .getByLabel("Technical contact email", { exact: true })
    .fill("technical@example.test");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "How customers pay", exact: true }),
  ).toBeVisible();
  await page.getByRole("checkbox", { name: "Stablecoin", exact: true }).check();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Currencies and markets", exact: true }),
  ).toBeVisible();
  // Bank and identity details are collected (encrypted) in Activate payments,
  // never in the business setup wizard.
  await expect(
    page.getByLabel(/Account number|IBAN|Settlement bank/),
  ).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Activate payments" }).first()).toBeVisible();
  await page
    .getByLabel("Search currencies you expect to be paid in", { exact: true })
    .fill("NGN");
  await page
    .getByLabel("Currencies you expect to be paid in", { exact: true })
    .selectOption("NGN");
  await page
    .getByLabel("Search payer countries", { exact: true })
    .fill("Nigeria");
  await page.getByLabel("Payer countries", { exact: true }).selectOption("NG");
  await page
    .getByRole("radio", { name: "Under $10,000 per month", exact: true })
    .check();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Verify your business", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Verification documents" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Team", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Team", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("link", { name: "Developers", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "API keys", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Create key", exact: true }).click();
  const secretInput = page.getByRole("textbox", {
    name: "Copy this secret now. It will not be shown again.",
  });
  await expect(secretInput).toBeVisible();
  const secret = await secretInput.inputValue();
  await page.getByRole("button", { name: "Hide secret" }).click();
  const row = page
    .getByRole("row")
    .filter({ hasText: secret.slice(0, 22) });
  await row.getByRole("button", { name: "Revoke", exact: true }).click();
  await expect(row).toContainText("Revoked");
  const revoked = await page.request.get("/api/v1/payments", {
    headers: {
      Authorization: `Bearer ${secret}`,
      "PayRouta-Environment": "sandbox",
    },
  });
  expect(revoked.status()).toBe(401);
  await page.getByRole("button", { name: "Open menu" }).focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("switch", { name: "Test mode" })).toBeFocused();
});
