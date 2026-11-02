import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
// A token the merchant doesn't take directly, paid from the customer's own
// wallet: the price shows before anything is chosen, the wallet's address
// is the refund address, the wallet sends the quoted amount to the swap's
// deposit address, and the checkout follows the swap to a receipt.
test("a swap is priced up front, paid from a connected wallet, and ends on a receipt", async ({ page }) => {
  const arbUsdc = "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near";
  const usdcContract = "0xaf88d065e77c8cc2239327c5edb3a432268e5831";
  const deposit = `0x${"d".repeat(40)}`;
  const from = `0x${"c".repeat(40)}`;
  const usdc = { network: "eip155:8453", identifier: "erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", symbol: "USDC", amount: "40.000000" };
  let attempt = false,
    swap = "PENDING_DEPOSIT",
    confirmed = false;
  const calls: Record<string, unknown>[] = [];
  await page.addInitScript(
    ({ from, deposit }) => {
      const sent: unknown[] = [];
      (window as unknown as { sent: unknown[] }).sent = sent;
      const provider = {
        request: async ({ method, params }: { method: string; params?: unknown[] }) => {
          if (method === "eth_requestAccounts") return [from];
          if (method === "eth_chainId") return "0xa4b1";
          if (method === "eth_sendTransaction") {
            sent.push(params![0]);
            return `0x${"e".repeat(64)}`;
          }
          void deposit;
          return null;
        },
      };
      window.addEventListener("eip6963:requestProvider", () =>
        window.dispatchEvent(
          new CustomEvent("eip6963:announceProvider", {
            detail: Object.freeze({ info: { uuid: "6f1c2b9e-3d4a-4e5f-8a7b-1c2d3e4f5a6b", name: "Test Wallet", icon: "data:,", rdns: "test.wallet" }, provider }),
          }),
        ),
      );
    },
    { from, deposit },
  );
  await page.route("**/api/checkout/swap-wallet", async (route) => {
    const q = route.request().postDataJSON();
    if (q) calls.push(q);
    if (q?.action === "confirm") attempt = true;
    const payment = {
      chain: "arb",
      chainName: "Arbitrum",
      symbol: "USDC",
      send: "40.18",
      depositAddress: deposit,
      depositMemo: null,
      refundTo: from,
      deadline: new Date(Date.now() + 1200000).toISOString(),
      status: swap,
      timeEstimate: 45,
      ...(swap === "SUCCESS" ? { explorerUrl: "https://arbiscan.io/tx/0xabc" } : {}),
      ...(swap === "PENDING_DEPOSIT"
        ? { transfer: { family: "evm", chainId: 42161, chainName: "Arbitrum", token: usdcContract, amount: "40180000", decimals: 6, to: deposit } }
        : {}),
    };
    const json =
      q?.action === "exchange"
        ? { ok: true }
        : q?.action === "pay-options"
          ? {
              locked: attempt,
              settle: { symbol: "USDC", amount: "40.000000" },
              chains: [
                {
                  id: "arb",
                  name: "Arbitrum",
                  tokens: [
                    { key: `swap:${arbUsdc}`, symbol: "USDC", route: "swap", method: "stablecoin", optionId: "usdc", assetId: arbUsdc, approx: "40.0161", price: 0.999597, contract: usdcContract, wallet: { family: "evm", chainId: 42161 } },
                  ],
                },
                {
                  id: "tron",
                  name: "Tron",
                  tokens: [{ key: "swap:tron-usdt", symbol: "USDT", route: "swap", method: "stablecoin", optionId: "usdc", assetId: "tron-usdt", approx: "40", price: 1 }],
                },
              ],
            }
          : q?.action === "methods"
            ? { methods: [{ method: "stablecoin", label: "Stablecoins", status: "AVAILABLE" }] }
            : q?.action === "select"
              ? { routeId: "route" }
              : q?.action === "confirm"
                ? { attemptId: "attempt" }
                : q?.action === "cross-chain-options"
                  ? { available: true, intents: true, assets: [] }
                  : q?.action === "cross-chain-quote"
                    ? payment
                    : q?.action === "cross-chain-status"
                      ? { payment: attempt && calls.some((c) => c.action === "cross-chain-quote") ? payment : null }
                      : {
                          merchant: "Fictional swap store",
                          reference: "Order 12",
                          ...usdc,
                          state: confirmed ? "Confirmed" : attempt ? "Processing" : "Open",
                          sandbox: false,
                          expiresAt: new Date(Date.now() + 1800000).toISOString(),
                          returnUrl: "/",
                          settlement: [],
                          ...(attempt
                            ? {
                                attemptId: "attempt",
                                attemptState: confirmed ? "Confirmed" : "Requires action",
                                action: { kind: "intents", provider: "NEAR Intents", text: "Pay", address: "shop.near", ...usdc },
                              }
                            : {}),
                        };
    await route.fulfill({ json });
  });
  await page.goto(`/checkout/swap-wallet#${"s".repeat(43)}`);
  // Priced before anything is chosen: about 40.0161 USDC on Arbitrum.
  await expect(page.getByRole("button", { name: "Token: USDC on Arbitrum" })).toBeVisible();
  await expect(page.locator(".pc-value strong")).toHaveText("≈ 40.0161");
  await page.getByText("Details", { exact: true }).click();
  await expect(page.locator(".pc-lines")).toContainText("Merchant receives40.00 USDC");
  await expect(page.locator(".pc-lines")).toContainText("Swapped by NEAR Intents");
  await expect(page.locator(".pc-lines")).toContainText("Paid in ETH by your wallet");
  // The list finds a token by a pasted contract address.
  await page.getByRole("button", { name: /^Token:/ }).click();
  await page.getByLabel("Search tokens").fill(usdcContract.slice(0, 12));
  await expect(page.locator(".tp-row")).toHaveCount(1);
  await expect(page.locator(".tp-row")).toContainText("≈ 40.0161");
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
  await page.locator(".tp-row").click();

  await page.getByRole("button", { name: "Connect wallet", exact: true }).click();
  await expect(page.getByText(`Test Wallet · 0xcccc…cccc`)).toBeVisible();
  await page.getByRole("button", { name: "Pay ≈ 40.0161 USDC", exact: true }).click();
  // The wallet sent exactly the quoted USDC to the deposit address.
  await expect(page.getByRole("heading", { name: "Pay with USDC on Arbitrum" })).toBeVisible();
  const sent = await page.evaluate(() => (window as unknown as { sent: { to: string; data: string; value: string; from: string }[] }).sent);
  expect(sent).toEqual([
    {
      from,
      to: usdcContract,
      value: "0x0",
      data: `0xa9059cbb${"d".repeat(40).padStart(64, "0")}${(40180000).toString(16).padStart(64, "0")}`,
    },
  ]);
  expect(calls.filter((c) => c.action === "cross-chain-quote")).toEqual([{ action: "cross-chain-quote", originAsset: arbUsdc, refundTo: from }]);
  // Progress: sent, then swapping, with NEAR Intents' estimate.
  await expect(page.locator(".sc-steps li.active")).toHaveText(/Transfer sent/);
  swap = "PROCESSING";
  await expect(page.locator(".sc-steps li.active")).toHaveText(/Swapping/, { timeout: 10000 });
  await expect(page.getByText("Usually under a minute")).toBeVisible();
  swap = "SUCCESS";
  confirmed = true;
  // The receipt, which returns to the merchant on its own unless asked not to.
  await expect(page.getByRole("heading", { name: "Payment received" })).toBeVisible({ timeout: 10000 });
  await expect(page.locator(".sc-receipt")).toContainText("Paid withUSDC on Arbitrum");
  await page.getByRole("button", { name: "Stay here" }).click();
  await expect(page.getByText(/Back to Fictional swap store in/)).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Return to merchant" })).toBeVisible();
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
});

test("a confirmed payment returns the customer to the merchant on its own", async ({ page }) => {
  await page.route("**/api/checkout/auto-return", (route) =>
    route.fulfill({
      json: route.request().postDataJSON()?.action === "exchange"
        ? { ok: true }
        : {
            merchant: "Fictional return store",
            reference: "Order 3",
            network: "eip155:8453",
            identifier: "erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
            symbol: "USDC",
            amount: "5.000000",
            state: "Confirmed",
            attemptId: "a",
            attemptState: "Confirmed",
            sandbox: false,
            expiresAt: new Date(Date.now() + 600000).toISOString(),
            returnUrl: "/pricing",
            settlement: ["Settled"],
            transaction: { hash: `0x${"f".repeat(64)}`, url: `https://basescan.org/tx/0x${"f".repeat(64)}` },
          },
    }),
  );
  await page.goto(`/checkout/auto-return#${"r".repeat(43)}`);
  await expect(page.getByRole("heading", { name: "Payment received" })).toBeVisible();
  await expect(page.getByRole("link", { name: "View on explorer" })).toHaveAttribute("href", `https://basescan.org/tx/0x${"f".repeat(64)}`);
  await expect(page.locator(".sc-receipt")).toContainText("Amount5.00 USDC");
  await page.waitForURL("**/pricing", { timeout: 15000 });
});
