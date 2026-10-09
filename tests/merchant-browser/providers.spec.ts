import { db } from "../../lib/portal/db";
import "dotenv/config";
import { test, expect } from "@playwright/test";
import { createOTP } from "@better-auth/utils/otp";
import { randomBytes } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
const origin = process.env.PAYROUTA_TEST_ORIGIN ?? "http://127.0.0.1:3000",
  orgId = "payment-demo-merchant";
test("merchant stablecoins: authenticated receive setup, future methods, business review and tenant isolation", async ({
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
  expect(
    (
      await page.request.post("/api/portal/command", {
        headers: { Origin: origin },
        data: {
          action: "step-up",
          code: await createOTP("payrouta-fictional-totp-secret").totp(),
        },
      })
    ).ok(),
  ).toBeTruthy();
  await page.goto(`/merchant/payment-methods?orgId=${orgId}`);
  await expect(
    page.getByRole("heading", { name: "Stablecoin payments", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Coming soon", { exact: true })).toHaveCount(8);
  const cryptoSection = page
    .getByRole("heading", { name: "Crypto wallet payments", exact: true })
    .locator("..");
  await expect(cryptoSection).toBeVisible();
  await page
    .getByLabel("Filter crypto network", { exact: true })
    .selectOption("stellar:testnet");
  await expect(
    cryptoSection.getByRole("cell", { name: "XLM", exact: true }),
  ).toBeVisible();
  await expect(cryptoSection.getByRole("row")).toHaveCount(2);
  await page.getByLabel("Find crypto coin", { exact: true }).fill("PEPE");
  await expect(cryptoSection.getByRole("row")).toHaveCount(1);
  await page.getByLabel("Find crypto coin", { exact: true }).fill("");
  await page
    .getByLabel("Filter crypto network", { exact: true })
    .selectOption("all");
  await page
    .getByLabel("Crypto coin and network", { exact: true })
    .selectOption("solana:devnet|native:SOL");
  await expect(
    page.getByLabel("Fresh crypto receive addresses", { exact: true }),
  ).toHaveAttribute("placeholder", "Solana wallet address");
  await page
    .getByLabel("Crypto coin and network", { exact: true })
    .selectOption("stellar:testnet|native:XLM");
  await expect(
    page.getByLabel("Fresh crypto receive addresses", { exact: true }),
  ).toHaveAttribute("placeholder", "G…");
  await page
    .getByLabel("Token and network", { exact: true })
    .selectOption(
      "eip155:84532|erc20:0x036cbd53842c5426634e7929541ec2318f3dcf7e",
    );
  await page
    .getByLabel("Fresh receive addresses (one per line)", { exact: true })
    .fill(`0x${randomBytes(20).toString("hex")}`);
  await page
    .getByRole("button", { name: "Save receive addresses", exact: true })
    .click();
  await expect(
    page.getByLabel("Fresh receive addresses (one per line)", { exact: true }),
  ).toHaveValue("");
  await expect(
    page.getByText("Testnet configured", { exact: true }).first(),
  ).toBeVisible();
  const wrong = await page.request.post("/api/merchant", {
    headers: { Origin: origin },
    data: {
      action: "stablecoins",
      orgId: "foreign-merchant",
      input: {
        network: "eip155:84532",
        identifier: "erc20:0x036cbd53842c5426634e7929541ec2318f3dcf7e",
        addresses: [`0x${"a".repeat(40)}`],
      },
    },
  });
  expect(wrong.status()).toBe(403);
  const mainnet = await page.request.post("/api/merchant", {
    headers: { Origin: origin },
    data: {
      action: "stablecoins",
      orgId,
      input: {
        network: "eip155:8453",
        identifier: "erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
        addresses: [`0x${"a".repeat(40)}`],
      },
    },
  });
  expect(mainnet.ok()).toBe(false);
  await page.goto(`/merchant/providers?orgId=${orgId}`);
  await expect(
    page.getByRole("heading", {
      name: "Business profile",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Apply to/ })).toHaveCount(0);
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations).toEqual([]);
});

test("merchant creates a multistablecoin checkout; a lost response retrieves the same link", async ({
  page,
  context,
}) => {
  await page.request.post("/api/auth/sign-in/email", {
    headers: { Origin: origin },
    data: { email: "owner@harbor.example", password: "PayRouta-Local-2026!" },
  });
  await page.request.post("/api/auth/two-factor/verify-totp", {
    headers: { Origin: origin },
    data: {
      code: await createOTP("payrouta-fictional-totp-secret").totp(),
      trustDevice: false,
    },
  });
  await page.request.post("/api/portal/command", {
    headers: { Origin: origin },
    data: {
      action: "step-up",
      code: await createOTP("payrouta-fictional-totp-secret").totp(),
    },
  });
  await page.goto(`/merchant/payment-methods?orgId=${orgId}`);
  await expect(
    page.getByRole("heading", { name: "Supported stablecoins", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "Mainnet only", exact: true }),
  ).toHaveCount(2);
  const reference = "Browser stablecoin invoice " + Date.now();
  await page.getByLabel("Checkout reference", { exact: true }).fill(reference);
  await page
    .getByLabel("Payer country (two-letter code)", { exact: true })
    .fill("NG");
  await page
    .getByLabel("USDC on Base Sepolia amount", { exact: true })
    .fill("1.000001");
  await page
    .getByLabel("EURC on Base Sepolia amount", { exact: true })
    .fill("2.000002");
  let drop = true;
  await page.route("**/api/merchant", async (route) => {
    if (
      drop &&
      route.request().postDataJSON()?.action === "stablecoin-checkout"
    ) {
      drop = false;
      const result = await route.fetch();
      expect(result.ok()).toBeTruthy();
      await route.abort("failed");
    } else await route.continue();
  });
  await page
    .getByRole("button", { name: "Create checkout link", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Retry checkout creation", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Retry checkout creation", exact: true })
    .click();
  const link = page.getByRole("link", {
    name: "Open customer checkout",
    exact: true,
  });
  await expect(link).toBeVisible();
  const intents = await db.paymentIntent.findMany({
    where: { orgId, reference },
  });
  expect(intents).toHaveLength(1);
  expect(
    await db.checkoutSession.count({ where: { intentId: intents[0].id } }),
  ).toBe(1);
  const customer = await context.newPage();
  await customer.goto((await link.getAttribute("href"))!);
  const picker = customer.getByRole("combobox", {
    name: "Token and network",
    exact: true,
  });
  await expect(picker).toBeVisible();
  const eurcOption = await picker
    .locator("option")
    .filter({ hasText: "EURC" })
    .getAttribute("value");
  await picker.selectOption(eurcOption!);
  await expect(
    customer.getByText("2.000002", { exact: false }).first(),
  ).toBeVisible();
  const forbidden = await page.request.post("/api/merchant", {
    headers: { Origin: origin },
    data: {
      action: "stablecoin-checkout",
      orgId: "foreign-merchant",
      input: {
        key: "foreign-key",
        environment: "sandbox",
        payerCountry: "NG",
        reference: "Unauthorized checkout",
        options: [],
      },
    },
  });
  expect(forbidden.status()).toBe(403);
  const mismatch = await page.request.post("/api/merchant", {
    headers: { Origin: origin },
    data: {
      action: "stablecoin-checkout",
      orgId,
      input: {
        key: "mainnet-in-sandbox",
        environment: "sandbox",
        payerCountry: "NG",
        reference: "Wrong environment",
        options: [
          {
            network: "eip155:1",
            identifier: "erc20:0xdac17f958d2ee523a2206206994597c13d831ec7",
            amount: "1",
          },
        ],
      },
    },
  });
  expect(mismatch.status()).toBe(409);
  await customer.close();
});
