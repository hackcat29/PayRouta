import "dotenv/config";
import { test, expect, type Page } from "@playwright/test";
import { createOTP } from "@better-auth/utils/otp";
import AxeBuilder from "@axe-core/playwright";
import { db } from "../../lib/portal/db";
import { treasuryMerchant } from "../fixtures/treasury";

const origin = process.env.PAYROUTA_TEST_ORIGIN ?? "http://127.0.0.1:3000";
const otp = () => createOTP("payrouta-fictional-totp-secret").totp();

async function signIn(page: Page, email: string) {
  const h = { Origin: origin };
  expect((await page.request.post("/api/auth/sign-in/email", { headers: h, data: { email, password: "PayRouta-Local-2026!" } })).ok()).toBeTruthy();
  expect((await page.request.post("/api/auth/two-factor/verify-totp", { headers: h, data: { code: await otp(), trustDevice: false } })).ok()).toBeTruthy();
  expect((await page.request.post("/api/portal/command", { headers: h, data: { action: "step-up", code: await otp() } })).ok()).toBeTruthy();
}
async function accessible(page: Page) {
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(axe.violations).toEqual([]);
}

test.afterAll(() => db.$disconnect());

test("merchant treasury: activation, balances, disputes and refunds, only in PayRouta's words", async ({ page }) => {
  const fresh = await treasuryMerchant("owner@harbor.example", "fresh");
  const submitted = await treasuryMerchant("owner@harbor.example", "submitted");
  const live = await treasuryMerchant("owner@harbor.example", "live");
  await signIn(page, "owner@harbor.example");
  const q = (org: string) => `?orgId=${org}&environment=sandbox`;

  // A new merchant is prompted to activate: its details and the terms, then
  // what each way of getting paid still needs.
  await page.goto(`/merchant/overview${q(fresh.orgId)}`);
  await expect(page.getByRole("link", { name: "Start activation" })).toBeVisible();
  await page.goto(`/merchant/activation${q(fresh.orgId)}`);
  for (const heading of ["Your details", "Merchant terms", "Crypto and stablecoins", "Cards, bank transfers and mobile money"])
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  await expect(page.getByRole("button", { name: "Submit for review" })).toBeDisabled();
  await accessible(page);

  // A submitted merchant sees where its review is.
  await page.goto(`/merchant/activation${q(submitted.orgId)}`);
  await expect(page.getByRole("list", { name: "Review progress" })).toBeVisible();
  await expect(page.getByText("Submitted", { exact: true }).first()).toBeVisible();

  // Balances: what can be paid out and what is reserved.
  await page.goto(`/merchant/balances${q(live.orgId)}`);
  await expect(page.getByText("Available to pay out")).toBeVisible();
  // £64.50 paid, 10% reserve held, £10.00 on hold for the open dispute.
  await expect(page.getByText("£48.05")).toBeVisible();
  await expect(page.getByRole("button", { name: "Pay out now" })).toBeVisible();
  await accessible(page);

  // Disputes: respond with evidence, once.
  await page.goto(`/merchant/disputes${q(live.orgId)}`);
  await expect(page.getByText("Needs attention")).toBeVisible();
  await page.getByRole("link", { name: "Response needed" }).click();
  await page.getByRole("button", { name: "Respond" }).click();
  await page.getByLabel(/What did the customer buy/).fill("Handmade linen shirt, size M, sent by courier on 2 October");
  await page.getByLabel("Tracking number").fill("JD0001");
  await accessible(page);
  await page.getByRole("button", { name: "Send evidence" }).click();
  await expect(page.getByText(/Sent \d/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Respond" })).toHaveCount(0);

  // A payment's money panel and a partial refund.
  await page.goto(`/merchant/payments/${live.intentId}${q(live.orgId)}`);
  await expect(page.getByText("PayRouta fee")).toBeVisible();
  await page.getByRole("button", { name: "Refund payment" }).click();
  await page.getByLabel(/Amount/).fill("5.00");
  await page.getByRole("button", { name: "Refund", exact: true }).click();
  await expect(page.getByText(/Refund started/)).toBeVisible();
  // The worker sends it to the provider; until then it shows as processing.
  await expect(page.getByText(/^(Refund processing|Refunded)$/)).toBeVisible();
  await accessible(page);

  // No provider names reach the merchant.
  for (const path of ["balances", "disputes", "activation"]) {
    await page.goto(`/merchant/${path}${q(live.orgId)}`);
    await expect(page.locator(".ms-body")).not.toContainText(/Stripe|Paystack|Flutterwave|dLocal|Tink|Sandbox Platform/);
  }
});

test("operations treasury: underwriting queue, readiness check and risk view", async ({ page }) => {
  const submitted = await treasuryMerchant("owner@harbor.example", "submitted");
  await signIn(page, "ops@payrouta.example");
  await page.goto("/ops/treasury/underwriting");
  await expect(page.getByRole("heading", { name: "Waiting for a decision" })).toBeVisible();
  await accessible(page);
  await page.goto(`/ops/treasury/merchants?q=${encodeURIComponent(submitted.name)}`);
  await page.getByRole("link", { name: submitted.name }).click();
  await expect(page.getByRole("heading", { name: submitted.name })).toBeVisible();
  await page.getByLabel(/Reason/).fill("Documents look complete; starting the review");
  await page.getByRole("button", { name: "Start review" }).click();
  await expect(page.getByRole("button", { name: "Approve and go live" })).toBeVisible();
  // Not ready to approve: no approved sub-account yet.
  await page.getByLabel("Decision note").fill("Checking readiness before approval");
  await page.getByRole("button", { name: "Check readiness" }).click();
  await expect(page.getByText(/platform sub account not approved/i)).toBeVisible();
  await accessible(page);
  await page.goto("/ops/treasury/risk");
  await expect(page.getByRole("heading", { name: "Open disputes" })).toBeVisible();
  await accessible(page);
});
