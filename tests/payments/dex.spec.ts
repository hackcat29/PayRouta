import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
// Paying with any token by its contract address (lib/intents/dex.ts): the
// customer pastes the address, the token loads with its price, and the
// wallet swaps it into USDC and only then pays exactly the checkout's USDC.
// A swap that fails pays nothing.
const degen = "0x4ed4e862860bed51a9570b96d89af5e1b0efefed";
const usdc = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const diamond = "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE";
const receive = `0x${"a".repeat(40)}`;
const from = `0x${"c".repeat(40)}`;

async function checkout(page: Page, swapOk: boolean) {
  let attempt = false;
  const calls: Record<string, unknown>[] = [];
  await page.addInitScript(
    ({ from, swapOk, usdc }) => {
      const sent: { to: string; data: string }[] = [];
      (window as unknown as { sent: typeof sent }).sent = sent;
      const provider = {
        request: async ({ method, params }: { method: string; params?: { to: string; data: string }[] | string[] }) => {
          if (method === "eth_requestAccounts") return [from];
          if (method === "eth_chainId") return "0x2105";
          if (method === "eth_call") {
            const call = params![0] as { to: string; data: string };
            // No allowance yet; 40.30 USDC after the swap.
            return call.to.toLowerCase() === usdc && call.data.startsWith("0x70a08231") ? `0x${(40300000).toString(16)}` : "0x0";
          }
          if (method === "eth_sendTransaction") {
            const tx = params![0] as { to: string; data: string };
            sent.push({ to: tx.to, data: tx.data });
            return `0x${String(sent.length).repeat(64)}`;
          }
          if (method === "eth_getTransactionReceipt") {
            const hash = String(params![0]);
            return { status: hash === `0x${"2".repeat(64)}` && !swapOk ? "0x0" : "0x1" };
          }
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
    { from, swapOk, usdc },
  );
  const asset = { network: "eip155:8453", identifier: `erc20:${usdc}`, symbol: "USDC", amount: "40.000000" };
  await page.route("**/api/checkout/dex-pay", async (route) => {
    const q = route.request().postDataJSON();
    if (q) calls.push(q);
    if (q?.action === "confirm") attempt = true;
    const json =
      q?.action === "exchange"
        ? { ok: true }
        : q?.action === "pay-options"
          ? {
              locked: attempt,
              settle: null,
              chains: [{ id: "base", name: "Base", tokens: [{ key: "direct:usdc", symbol: "USDC", route: "direct", method: "stablecoin", optionId: "usdc", amount: "40.000000", network: "eip155:8453", contract: usdc, wallet: { family: "evm", chainId: 8453 } }] }],
            }
          : q?.action === "token-lookup"
            ? { tokens: [{ chain: "base", chainName: "Base", address: degen, symbol: "DEGEN", name: "Degen", decimals: 18, price: 0.001 }] }
            : q?.action === "methods"
              ? { methods: [{ method: "stablecoin", label: "Stablecoins", status: "AVAILABLE" }] }
              : q?.action === "select"
                ? { routeId: "route" }
                : q?.action === "confirm"
                  ? { attemptId: "attempt" }
                  : q?.action === "dex-evm"
                    ? {
                        chainId: 8453,
                        chainName: "Base",
                        sell: { token: degen, amount: "41600000000000000000000", decimals: 18, symbol: "DEGEN" },
                        swap: { to: diamond, data: "0xabcdef", value: "0x0" },
                        pay: { token: usdc, amount: "40000000", to: receive, decimals: 6 },
                      }
                    : q?.action === "cross-chain-options" || q?.action === "cross-chain-status"
                      ? { available: false, assets: [], payment: null }
                      : {
                          merchant: "Fictional token store",
                          reference: "Order 21",
                          ...asset,
                          cryptoQuote: { usdAmount: "40.00", source: "CoinGecko" },
                          state: attempt ? "Processing" : "Open",
                          sandbox: false,
                          expiresAt: new Date(Date.now() + 1800000).toISOString(),
                          returnUrl: "/",
                          settlement: [],
                          ...(attempt ? { attemptId: "attempt", attemptState: "Requires action", action: { kind: "deposit", ...asset, address: receive } } : {}),
                        };
    await route.fulfill({ json });
  });
  await page.goto(`/checkout/dex-pay#${"d".repeat(43)}`);
  await page.getByRole("button", { name: /^Token:/ }).click();
  await page.getByLabel("Search tokens").fill(degen);
  // The pasted address loads the token, priced in this checkout's USD.
  await expect(page.getByRole("button", { name: /^DEGEN\s*Base/ })).toContainText("≈ 40000");
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: /^DEGEN\s*Base/ }).click();
  await page.getByText("Details", { exact: true }).click();
  await expect(page.locator(".pc-lines")).toContainText("Swapped to USDC in your wallet, then paid");
  await page.getByRole("button", { name: "Connect wallet", exact: true }).click();
  await page.getByRole("button", { name: "Pay ≈ 40000 DEGEN", exact: true }).click();
  return calls;
}
const sent = (page: Page) => page.evaluate(() => (window as unknown as { sent: { to: string; data: string }[] }).sent);

test("a token found by its address pays: approve, swap into USDC, then exactly the USDC payment", async ({ page }) => {
  const calls = await checkout(page, true);
  await expect(page.getByRole("heading", { name: "Pay with DEGEN on Base" })).toBeVisible();
  await expect(page.locator(".sc-steps li.active")).toContainText("Confirming on Base");
  const txs = await sent(page);
  expect(txs.map((t) => t.to.toLowerCase())).toEqual([degen, diamond.toLowerCase(), usdc]);
  // The approval is for LI.FI's contract, the swap goes to it, and the
  // payment is exactly 40 USDC to the merchant.
  expect(txs[0].data.startsWith(`0x095ea7b3${diamond.slice(2).toLowerCase().padStart(64, "0")}`)).toBe(true);
  expect(txs[2].data).toBe(`0xa9059cbb${receive.slice(2).padStart(64, "0")}${(40000000).toString(16).padStart(64, "0")}`);
  expect(calls).toContainEqual({ action: "dex-evm", payer: from, chain: "base", address: degen });
});

test("a swap that fails pays nothing", async ({ page }) => {
  await checkout(page, false);
  await expect(page.getByRole("alert").filter({ hasText: "The swap didn't go through, so nothing was paid." })).toBeVisible();
  const txs = await sent(page);
  // The approval and the swap; never the USDC payment.
  expect(txs.map((t) => t.to.toLowerCase())).toEqual([degen, diamond.toLowerCase()]);
});
