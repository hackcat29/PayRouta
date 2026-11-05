import "dotenv/config";
import { test, expect } from "@playwright/test";
import { randomUUID, randomBytes } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { db } from "../../lib/portal/db";
import { json } from "../../lib/portal/service";
import { createIntent, createSession } from "../../lib/payments/service";
import { dispatch } from "../../lib/payments/processing";
const asset = {
  kind: "blockchain",
  network: "eip155:84532",
  identifier: "erc20:0x036cbd53842c5426634e7929541ec2318f3dcf7e",
};
test.afterAll(() => db.$disconnect());
test("stablecoin checkout: actual testnet instructions, wallet submission stays pending, reload and method gates", async ({
  page,
}) => {
  const orgId = `browser-stablecoins-${randomUUID()}`,
    address = `0x${randomBytes(20).toString("hex")}`;
  await db.organization.create({
    data: { id: orgId, name: "Fictional browser store", fictional: true },
  });
  await db.merchantConfig.create({
    data: { orgId, returnOrigin: "http://127.0.0.1:3000" },
  });
  await db.integration.create({
    data: {
      orgId,
      environment: "sandbox",
      version: 1,
      config: json({
        mode: "NATIVE",
        adapter: "erc20-deposit",
        environment: "sandbox",
        network: asset.network,
        identifier: asset.identifier,
        addresses: [address],
        publicTestnetRpc: true,
      }),
    },
  });
  const intent = await createIntent(orgId, randomUUID(), {
      reference: "Browser test",
      amount: "1.000000",
      asset,
      precision: 6,
      methods: ["stablecoin"],
      settlement: asset,
      returnUrl: "http://127.0.0.1:3000/",
    }),
    s = await createSession(orgId, intent.id);
  await page.goto(s.checkoutPath);
  await expect(page.getByText("Coming soon", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("timer", { name: "Checkout time remaining" }),
  ).toHaveText(/^[0-2]\d:[0-5]\d$/);
  // One token on offer: already chosen, with its exact amount.
  await expect(page.getByRole("button", { name: "Token: USDC on Base Sepolia" })).toBeVisible();
  await expect(page.locator(".pc-value strong")).toHaveText("1.00");
  await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeEnabled();
  await expect(
    page.getByRole("heading", { name: "1.00 USDC", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect
    .poll(() => db.paymentAttempt.count({ where: { intentId: intent.id } }))
    .toBe(1);
  const attempt = await db.paymentAttempt.findFirstOrThrow({
    where: { intentId: intent.id },
  });
  await dispatch(attempt.id);
  await expect(page.getByText(address, { exact: true })).toBeVisible();
  await expect(
    page.getByRole("img", { name: "Stablecoin transfer QR code" }),
  ).toBeVisible();
  await expect(
    page.getByText("Base Sepolia", { exact: true }).first(),
  ).toBeVisible();
  const declined = await page.request.post(`/api/checkout/${s.sessionId}`, {
    headers: { Origin: process.env.PAYROUTA_TEST_ORIGIN ?? "http://127.0.0.1:3000" },
    data: { action: "select", method: "card" },
  });
  expect(declined.status()).toBe(409);
  const submitted = `0x${"b".repeat(64)}`;
  await page.evaluate(
    ({ from, hash }) => {
      (window as Window & { ethereum?: unknown }).ethereum = {
        request: async ({ method }: { method: string }) =>
          method === "eth_chainId"
            ? "0x14a34"
            : method === "eth_requestAccounts"
              ? [from]
              : method === "eth_sendTransaction"
                ? hash
                : undefined,
      };
      window.dispatchEvent(new Event("ethereum#initialized"));
    },
    { from: `0x${"a".repeat(40)}`, hash: submitted },
  );
  await page
    .getByRole("button", { name: "Pay with wallet", exact: true })
    .click();
  await expect(
    page.getByText(
      `Transaction sent: ${submitted}. Waiting for network finality.`,
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Waiting for transfer confirmation" }),
  ).toBeDisabled();
  expect(
    (await db.paymentIntent.findUniqueOrThrow({ where: { id: intent.id } }))
      .state,
  ).toBe("Processing");
  expect(
    await db.depositClaim.count({ where: { attemptId: attempt.id } }),
  ).toBe(0);
  await page.reload();
  await expect(page.getByText(address, { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Waiting for transfer confirmation" }),
  ).toBeDisabled();
  expect(
    await page
      .locator("input[type=password], input[autocomplete=cc-number]")
      .count(),
  ).toBe(0);
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations).toEqual([]);
});
test("demo checkout is labelled as a demo and opens the any-token picker", async ({
  page,
}) => {
  await page.goto("/checkout/demo");
  await expect(page.getByText(/no money moves/i)).toBeVisible();
  await page.getByRole("button", { name: /^Checkout/ }).click();
  await expect(
    page.getByRole("heading", { name: "What do you want to pay with?" }),
  ).toBeVisible();
  await expect(
    page.locator("input[type=password], input[autocomplete=cc-number]"),
  ).toHaveCount(0);
});
