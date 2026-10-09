import { test, expect } from "@playwright/test";
import { createOTP } from "@better-auth/utils/otp";
const orgId = "payment-demo-merchant";
const origin = process.env.PAYROUTA_TEST_ORIGIN ?? "http://127.0.0.1:3000";
test("billing: free sandbox, fee export and organization/environment isolation", async ({
  page,
}) => {
  expect(
    (
      await page.request.post("/api/auth/sign-in/email", {
        headers: { Origin: origin },
        data: {
          email: "owner@harbor.example",
          password: "PayRouta-Local-2026!",
        },
      })
    ).ok(),
  ).toBeTruthy();
  expect(
    (
      await page.request.post("/api/auth/two-factor/verify-totp", {
        headers: { Origin: origin },
        data: {
          code: await createOTP("payrouta-fictional-totp-secret").totp(),
          trustDevice: false,
        },
      })
    ).ok(),
  ).toBeTruthy();
  await page.goto(`/merchant/billing?orgId=${orgId}&environment=sandbox`);
  await expect(
    page.getByRole("heading", { name: "Platform fees" }),
  ).toBeVisible();
  await expect(
    page.getByText("Your sandbox is free.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Download fee details" }),
  ).toBeVisible();
  const month = new Date().toISOString().slice(0, 7);
  const csv = await page.request.get(
    `/api/merchant/billing?orgId=${orgId}&environment=sandbox&month=${month}`,
  );
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toContain("text/csv");
  expect(await csv.text()).toContain("fee_minor");
  expect(
    (
      await page.request.get(
        `/api/merchant/billing?orgId=another-merchant&environment=sandbox&month=${month}`,
      )
    ).status(),
  ).toBe(403);
  expect(
    (
      await page.request.get(
        `/api/merchant/billing?orgId=${orgId}&environment=production&month=${month}`,
      )
    ).status(),
  ).toBe(403);
  await page.getByLabel("Month", { exact: true }).fill("2026-09");
  await page.getByRole("button", { name: "View month" }).click();
  await expect(page).toHaveURL(/orgId=payment-demo-merchant/);
  await expect(
    page.getByRole("heading", { name: "2026-09", exact: true }),
  ).toBeVisible();
});
test("pricing: both method rates, caps and monthly billing are published", async ({
  page,
}) => {
  await page.goto("/pricing");
  await expect(page.getByText("0.25%", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("0.10%", { exact: true }).first()).toBeVisible();
  await expect(
    page.getByText(
      "cards, digital wallets and BNPL; capped at $2 per USD payment",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page
      .getByText("Billed monthly, separately from provider settlements.", {
        exact: false,
      })
      .first(),
  ).toBeVisible();
  await page.getByText("Standard", { exact: true }).scrollIntoViewIfNeeded();
  await expect(page.locator(".mk-plan.feature")).toHaveCSS("opacity", "1");
  await page.screenshot({
    path: "/private/tmp/payrouta-fees/pricing-cards.png",
    fullPage: false,
  });
});

test("pricing: mobile caps and billing text fit the viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/pricing");
  await page.getByText("Standard", { exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByText("0.10%", { exact: true }).first()).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await expect(page.locator(".mk-plan.feature")).toHaveCSS("opacity", "1");
  await page.screenshot({
    path: "/private/tmp/payrouta-fees/pricing-mobile.png",
  });
});
