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
    page.getByText("Test payments are free", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Fee details" }),
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
  await page.getByRole("button", { name: "View", exact: true }).click();
  await expect(page).toHaveURL(/orgId=payment-demo-merchant/);
  await expect(page).toHaveURL(/month=2026-09/);
  await expect(page.getByLabel("Month", { exact: true })).toHaveValue("2026-09");
});
test("pricing: both rates, the cap and who pays fees are published", async ({
  page,
}) => {
  await page.goto("/pricing");
  await expect(page.getByText("1.5%", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("1%", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/max \$5/).first()).toBeVisible();
  await expect(
    page.getByText("Who pays the fees", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Failed payments, backup retries, test mode" })).toBeVisible();
  await expect(page.getByText("$0", { exact: true })).toBeVisible();
});

test("pricing: mobile rates fit the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/pricing");
  await expect(page.getByText("1.5%", { exact: true }).first()).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
