import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
// The checkout asks one question, what the customer pays with. A token the
// merchant doesn't take directly is swapped by NEAR Intents: the customer
// gives a refund address once, and the quote follows as soon as payment
// instructions exist, without choosing again.
test("paying with a token the merchant doesn't take directly goes straight to a swap quote", async ({ page }) => {
  let attempt = false;
  const calls: { action?: string; originAsset?: string; refundTo?: string; method?: string }[] = [];
  const tronUsdt = "nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near";
  const usdc = { network: "eip155:8453", identifier: "erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", symbol: "USDC", amount: "40.000000" };
  await page.route("**/api/checkout/pay-with", async (route) => {
    const q = route.request().postDataJSON();
    if (q) calls.push(q);
    if (q?.action === "confirm") attempt = true;
    const json =
      q?.action === "exchange"
        ? { ok: true }
        : q?.action === "pay-options"
          ? {
              locked: attempt,
              settle: { symbol: "USDC", amount: "40.000000" },
              chains: [
                { id: "base", name: "Base", tokens: [{ key: "swap:base-usdc", symbol: "USDC", route: "swap", method: "stablecoin", optionId: "usdc", assetId: "nep141:base-usdc" }] },
                { id: "tron", name: "Tron", tokens: [{ key: `swap:${tronUsdt}`, symbol: "USDT", route: "swap", method: "stablecoin", optionId: "usdc", assetId: tronUsdt }] },
              ],
            }
          : q?.action === "methods"
            ? { methods: [{ method: "stablecoin", label: "Stablecoins", status: "AVAILABLE" }] }
            : q?.action === "select"
              ? { routeId: "route" }
              : q?.action === "confirm"
                ? { attemptId: "attempt" }
                : q?.action === "cross-chain-options"
                  ? { available: true, intents: true, assets: [{ assetId: tronUsdt, chain: "tron", chainName: "Tron", symbol: "USDT" }] }
                  : q?.action === "cross-chain-status"
                    ? { payment: null }
                    : q?.action === "cross-chain-quote"
                      ? {
                          chain: "tron",
                          chainName: "Tron",
                          symbol: "USDT",
                          send: "40.18",
                          depositAddress: "TDepositAddress1111111111111111111",
                          depositMemo: null,
                          refundTo: q.refundTo,
                          deadline: new Date(Date.now() + 1200000).toISOString(),
                          status: "PENDING_DEPOSIT",
                        }
                      : {
                          merchant: "Fictional intents store",
                          reference: "Order 7",
                          ...usdc,
                          state: attempt ? "Processing" : "Open",
                          sandbox: false,
                          expiresAt: new Date(Date.now() + 1800000).toISOString(),
                          returnUrl: "/",
                          settlement: [],
                          ...(attempt
                            ? {
                                attemptId: "attempt",
                                attemptState: "Requires action",
                                action: { kind: "intents", provider: "NEAR Intents", text: "Pay", address: "shop.near", ...usdc },
                              }
                            : {}),
                        };
    await route.fulfill({ json });
  });
  await page.goto(`/checkout/pay-with#${"w".repeat(43)}`);
  await page.getByLabel("Network", { exact: true }).selectOption("tron");
  await page.getByLabel("Token", { exact: true }).selectOption(`swap:${tronUsdt}`);
  // A swap needs somewhere to refund to.
  await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeDisabled();
  await page.getByLabel("Refund address on Tron").fill("TRefundAddress000000000000000000");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Pay with USDT on Tron" })).toBeVisible();
  await expect(page.getByText("TDepositAddress1111111111111111111", { exact: true })).toBeVisible();
  await expect(page.getByText(/Send exactly/)).toContainText("40.18 USDT");
  // Nothing to choose again: the quote used what the customer already said.
  await expect(page.getByLabel("Network", { exact: true })).toHaveCount(0);
  expect(calls.find((c) => c.action === "select")?.method).toBe("stablecoin");
  expect(calls.filter((c) => c.action === "cross-chain-quote")).toEqual([
    { action: "cross-chain-quote", originAsset: tronUsdt, refundTo: "TRefundAddress000000000000000000" },
  ]);
  const violations = (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations;
  expect(violations).toEqual([]);
});
