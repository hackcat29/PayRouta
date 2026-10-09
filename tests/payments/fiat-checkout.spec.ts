import "dotenv/config";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { db } from "../../lib/portal/db";
import { dispatch, poll } from "../../lib/payments/processing";
import { fiatCheckout, treasuryMerchant } from "../fixtures/treasury";

test.afterAll(() => db.$disconnect());

// The card / bank checkout through PayRouta's platform rails, with the launch
// scope enforced exactly as the running server enforces it.
test("fiat checkout: choose a method, pay, complete the test payment, see success", async ({ page }) => {
  const live = await treasuryMerchant("owner@harbor.example", "live");
  const s = await fiatCheckout(live.orgId);
  await page.goto(s.checkoutPath);
  await expect(page.getByText("Test mode · no real money moves")).toBeVisible();
  await expect(page.getByText(live.name, { exact: true })).toBeVisible();
  await expect(page.getByRole("radio", { name: /Card/ })).toBeChecked();
  await expect(page.getByRole("radio", { name: /Bank transfer/ })).toBeVisible();
  await expect(page.getByText(/Stripe|Paystack|Sandbox Platform/)).toHaveCount(0);
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
  await page.getByRole("radio", { name: /Bank transfer/ }).check();
  await page.getByRole("button", { name: "Pay £86.40" }).click();
  await expect(page.getByRole("heading", { name: "Preparing your payment" })).toBeVisible();
  // The worker's job, run here: send the payment to the platform rail.
  const intentId = (await db.checkoutSession.findUniqueOrThrow({ where: { id: s.sessionId } })).intentId;
  const attempt = await db.paymentAttempt.findFirstOrThrow({ where: { intentId } });
  expect(attempt.profileId).toMatch(/^platform:/);
  await dispatch(attempt.id);
  await page.getByRole("button", { name: /Complete test payment/ }).click();
  await expect(page.getByRole("heading", { name: /Confirming your payment|Payment successful/ })).toBeVisible();
  await poll(attempt.id);
  await expect(page.getByRole("heading", { name: "Payment successful" })).toBeVisible({ timeout: 20000 });
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
});
