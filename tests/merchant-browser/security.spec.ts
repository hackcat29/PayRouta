// Account security in the merchant dashboard (components/portal/
// account-security.tsx, step-up.tsx, theme-toggle.tsx): a sensitive action
// asks "Confirm it's you" in place and then goes through; Security is in
// the dashboard itself; dark mode is a switch that sticks.
import "dotenv/config";
import { test, expect } from "@playwright/test";
import { createOTP } from "@better-auth/utils/otp";
import AxeBuilder from "@axe-core/playwright";
import { db } from "../../lib/portal/db";
import { randomUUID } from "node:crypto";
import { treasuryMerchant } from "../fixtures/treasury";

const origin = process.env.PAYROUTA_TEST_ORIGIN ?? "http://127.0.0.1:3000";
const otp = () => createOTP("payrouta-fictional-totp-secret").totp();
test.afterAll(() => db.$disconnect());

test("a sensitive action asks to confirm it's you in place; security and dark mode live in the dashboard", async ({ page }) => {
  const h = { Origin: origin };
  // Signed in, but not confirmed for sensitive actions.
  expect((await page.request.post("/api/auth/sign-in/email", { headers: h, data: { email: "owner@harbor.example", password: "PayRouta-Local-2026!" } })).ok()).toBeTruthy();
  expect((await page.request.post("/api/auth/two-factor/verify-totp", { headers: h, data: { code: await otp(), trustDevice: false } })).ok()).toBeTruthy();
  const { orgId } = await treasuryMerchant("owner@harbor.example", "fresh");
  const q = `?orgId=${orgId}&environment=sandbox`;

  await page.goto(`/merchant/developers/api-keys${q}`);
  const before = await db.merchantApiKey.count({ where: { orgId } });
  await page.getByRole("button", { name: /Create (API )?key/ }).first().click();
  const dialog = page.getByRole("dialog", { name: "Confirm it's you" });
  await expect(dialog).toBeVisible();
  expect((await new AxeBuilder({ page }).include(".su-dialog").withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
  await dialog.getByLabel("Code from your authenticator app").fill(await otp());
  await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  // The action carried on by itself.
  await expect.poll(() => db.merchantApiKey.count({ where: { orgId } })).toBe(before + 1);

  // Security is in the merchant dashboard, not the provider one.
  await page.goto(`/merchant/security${q}`);
  await expect(page).toHaveURL(/\/merchant\/security/);
  for (const name of ["Two-step verification", "Password", "Signed-in devices"]) await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Authenticator app" })).toBeVisible();
  await expect(page.getByText("Google Authenticator", { exact: false }).first()).toBeVisible();

  // Dark mode: on, kept after a reload, and still readable.
  const toggle = page.getByRole("switch", { name: "Dark mode" });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("switch", { name: "Dark mode" })).toHaveAttribute("aria-checked", "true");
  await page.waitForTimeout(700);
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
  await page.getByRole("switch", { name: "Dark mode" }).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", "dark");

  // Choosing how a live business settles survives the wallet options loading.
  const owner = await db.user.findUniqueOrThrow({ where: { email: "owner@harbor.example" } });
  const live = await db.organization.create({ data: { name: `Settle ${randomUUID().slice(0, 4)}`, fictional: true } });
  await db.merchantConfig.create({ data: { orgId: live.id, returnOrigin: origin, environment: "production" } });
  await db.membership.create({ data: { orgId: live.id, userId: owner.id, role: "Owner", merchantRole: "Owner" } });
  await page.goto(`/merchant/crypto-balance?orgId=${live.id}&environment=production`);
  await page.getByLabel("An address on any chain").check();
  await expect(page.getByLabel("Your address on that network")).toBeVisible();
  await page.waitForTimeout(3000);
  await expect(page.getByLabel("An address on any chain")).toBeChecked();
  await expect(page.getByLabel("Your address on that network")).toBeVisible();
});
