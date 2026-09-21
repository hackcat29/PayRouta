import "dotenv/config";
import { test, expect } from "@playwright/test";
import { createOTP } from "@better-auth/utils/otp";
import AxeBuilder from "@axe-core/playwright";
const origin = "http://127.0.0.1:3000";
test("merchant workspace: auth, environment isolation, payment table and mobile accessibility", async ({
  page,
}) => {
  const signIn = await page.request.post("/api/auth/sign-in/email", {
    headers: { Origin: origin },
    data: { email: "owner@harbor.example", password: "PayRouta-Local-2026!" },
  });
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
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Environment", { exact: true })
    .selectOption("production");
  await page.getByRole("button", { name: "Switch", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "No live access yet" }),
  ).toBeVisible();
  await page.getByLabel("Environment", { exact: true }).selectOption("sandbox");
  await page.getByRole("button", { name: "Switch", exact: true }).click();
  await page.getByRole("link", { name: "Payments", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Payments", exact: true }),
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
  await page.getByRole("link", { name: "Onboarding", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Verification documents" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Team", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Team", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "API keys", exact: true }).click();
  await page.getByRole("button", { name: "Create key", exact: true }).click();
  const secretInput = page.getByRole("textbox", {
    name: "Copy this secret now. It will not be shown again.",
  });
  await expect(secretInput).toBeVisible();
  const secret = await secretInput.inputValue();
  await page.getByRole("button", { name: "Hide secret" }).click();
  const row = page
    .getByRole("listitem")
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
  await page.getByLabel("Environment", { exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Switch", exact: true }),
  ).toBeFocused();
});
