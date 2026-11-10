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
    page.getByRole("heading", { name: "Stablecoins", exact: true }),
  ).toBeVisible();
  // Every way to pay is listed with its state for this account. Test mode
  // offers stablecoins; any token, any chain settles in live mode.
  const overview = page.getByRole("heading", { name: "Ways customers pay", exact: true }).locator("../..");
  for (const name of ["Cards", "Digital wallets", "Bank transfer", "Mobile money", "USSD", "Pay with credit", "Stablecoins"])
    await expect(overview.getByText(name, { exact: true })).toBeVisible();
  // Receive addresses are open in test mode, where they are the only crypto route.
  const cryptoSection = page
    .getByRole("heading", { name: "Other coins: ETH, SOL, XLM and more", exact: true })
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
    page.getByLabel("Coin addresses, one per line", { exact: true }),
  ).toHaveAttribute("placeholder", "Solana wallet address");
  await page
    .getByLabel("Crypto coin and network", { exact: true })
    .selectOption("stellar:testnet|native:XLM");
  await expect(
    page.getByLabel("Coin addresses, one per line", { exact: true }),
  ).toHaveAttribute("placeholder", "G…");
  await page
    .getByLabel("Token and network", { exact: true })
    .selectOption(
      "eip155:84532|erc20:0x036cbd53842c5426634e7929541ec2318f3dcf7e",
    );
  await page
    .getByLabel("Stablecoin addresses, one per line", { exact: true })
    .fill(`0x${randomBytes(20).toString("hex")}`);
  await page
    .getByRole("button", { name: "Save stablecoin addresses", exact: true })
    .click();
  await expect(
    page.getByLabel("Stablecoin addresses, one per line", { exact: true }),
  ).toHaveValue("");
  await expect(
    page.getByText("Ready", { exact: true }).first(),
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

test("merchant creates a payment link; every customer who pays gets their own checkout", async ({
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
  await page.goto(`/merchant/payment-methods?orgId=${orgId}`);
  await expect(page.getByRole("heading", { name: "Ways customers pay", exact: true })).toBeVisible();
  // USDT has no test network, so test mode doesn't offer it.
  await expect(page.getByLabel("Token and network", { exact: true }).getByRole("option", { name: /^USDT on/ })).toHaveCount(0);

  await page.goto(`/merchant/payment-links?orgId=${orgId}&create=1`);
  const title = "Browser link " + Date.now();
  await page.getByLabel("What it's for", { exact: true }).fill(title);
  await page.getByLabel("Amount", { exact: true }).fill("3");
  await page.getByRole("combobox", { name: "Currency", exact: true }).selectOption("USD");
  // Methods that aren't on for this account can't be chosen.
  await expect(page.getByRole("checkbox", { name: /Card/ })).toBeDisabled();
  await page.getByRole("checkbox", { name: /Stablecoins/ }).check();
  await page.getByRole("button", { name: "Create link", exact: true }).click();
  const url = await page.locator(".ms-link-created code").innerText();
  expect(url).toMatch(/\/pay\/[A-Za-z0-9]{10}$/);

  // Opening the link creates nothing; pressing Pay creates one checkout.
  const link = await db.paymentLink.findFirstOrThrow({ where: { orgId, title } });
  const customer = await context.newPage();
  await customer.goto(url);
  expect((await db.paymentLink.findUniqueOrThrow({ where: { id: link.id } })).checkouts).toBe(0);
  await customer.getByRole("button", { name: "Pay $3", exact: true }).click();
  await customer.waitForURL(/\/checkout\//);
  await expect(customer.getByRole("button", { name: /^Token:/ })).toBeVisible();
  expect((await db.paymentLink.findUniqueOrThrow({ where: { id: link.id } })).checkouts).toBe(1);

  // Another merchant's workspace, and methods that aren't on, are refused.
  const forbidden = await page.request.post("/api/merchant", {
    headers: { Origin: origin },
    data: {
      action: "payment-link",
      orgId: "foreign-merchant",
      input: { title: "x", amount: "1", currency: "USD", country: "NG", crypto: true },
    },
  });
  expect(forbidden.status()).toBe(403);
  const notOn = await page.request.post("/api/merchant", {
    headers: { Origin: origin },
    data: {
      action: "payment-link",
      orgId,
      input: { title: "Card link", amount: "1", currency: "USD", country: "NG", methods: ["card"] },
    },
  });
  expect(notOn.status()).toBe(409);
  await customer.close();
});
