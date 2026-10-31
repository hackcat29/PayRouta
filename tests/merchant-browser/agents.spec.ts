import "dotenv/config";
import { test, expect } from "@playwright/test";
import { createOTP } from "@better-auth/utils/otp";
import AxeBuilder from "@axe-core/playwright";
const origin = process.env.PAYROUTA_TEST_ORIGIN ?? "http://127.0.0.1:3000";
const code = () => createOTP("payrouta-fictional-totp-secret").totp();

test("agent keys: a merchant gives an agent a key with limits, then revokes it", async ({ page }) => {
  const login = () =>
    page.request.post("/api/auth/sign-in/email", {
      headers: { Origin: origin },
      data: { email: "owner@harbor.example", password: "PayRouta-Local-2026!" },
    });
  let signIn = await login();
  if (signIn.status() === 429) {
    const retryAfter = Number(signIn.headers()["retry-after"]);
    await new Promise((r) => setTimeout(r, (Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter + 1, 60) : 11) * 1000));
    signIn = await login();
  }
  expect(signIn.ok(), await signIn.text()).toBeTruthy();
  expect((await page.request.post("/api/auth/two-factor/verify-totp", { headers: { Origin: origin }, data: { code: await code(), trustDevice: false } })).ok()).toBeTruthy();
  expect((await page.request.post("/api/portal/command", { headers: { Origin: origin }, data: { action: "step-up", code: await code() } })).ok()).toBeTruthy();

  await page.goto("/merchant/developers/agents?orgId=payment-demo-merchant");
  await expect(page.getByRole("heading", { name: "Agent keys", exact: true }).first()).toBeVisible();
  const name = `Procurement ${Date.now()}`;
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Budget (USD)", { exact: true }).fill("500");
  await page.getByLabel("Budget period", { exact: true }).selectOption("week");
  await page.getByLabel("Most per payment (USD)", { exact: true }).fill("100");
  await page.getByRole("button", { name: /Create (test|live) key/ }).click();
  await expect(page.getByLabel(/Copy this key now/)).toHaveValue(/^pra_(sandbox|production)_[\w-]{43}$/);
  const row = page.getByRole("row").filter({ hasText: name });
  await expect(row).toContainText("$0.00 of $500.00 / week");
  await expect(row).toContainText("$100.00");
  await expect(row).toContainText("Any");
  const violations = (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations;
  expect(violations).toEqual([]);
  await row.getByRole("button", { name: "Revoke" }).click();
  await expect(row).toContainText("Revoked");
});
