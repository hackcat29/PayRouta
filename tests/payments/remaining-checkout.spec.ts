import { test, expect } from "@playwright/test";
test("wallet refusal and absent wallet show actionable messages without confirming payment", async ({
  page,
}) => {
  const address = `0x${"a".repeat(40)}`;
  await page.route("**/api/checkout/wallet-test", async (route) => {
    const q = route.request().postDataJSON();
    const result =
      q?.action === "exchange"
        ? { ok: true }
        : q?.action === "methods"
          ? {
              methods: [
                {
                  method: "stablecoin",
                  label: "Stablecoins",
                  status: "AVAILABLE",
                },
              ],
            }
          : {
              merchant: "Test merchant",
              reference: "Wallet refusal",
              amount: "1.000000",
              state: "Processing",
              attemptId: "test",
              attemptState: "Requires action",
              symbol: "USDC",
              network: "eip155:84532",
              sandbox: true,
              expiresAt: new Date(Date.now() + 60000).toISOString(),
              returnUrl: "/",
              settlement: [],
              action: {
                kind: "deposit",
                text: "Send 1 test USDC",
                address,
                network: "eip155:84532",
                identifier: "erc20:0x036cbd53842c5426634e7929541ec2318f3dcf7e",
                amount: "1.000000",
                symbol: "USDC",
              },
            };
    await route.fulfill({ json: result });
  });
  await page.goto("/checkout/wallet-test#" + "a".repeat(43));
  await page
    .getByRole("button", { name: "Pay with wallet", exact: true })
    .click();
  await expect(
    page.getByText(
      "Open this checkout in your wallet browser, or send using the address below",
    ),
  ).toBeVisible();
  await page.evaluate(() => {
    (window as Window & { ethereum?: unknown }).ethereum = {
      request: async ({ method }: { method: string }) => {
        if (method === "eth_chainId") return "0x14a34";
        throw Object.assign(new Error("rejected"), { code: 4001 });
      },
    };
    window.dispatchEvent(new Event("ethereum#initialized"));
  });
  await page
    .getByRole("button", { name: "Pay with wallet", exact: true })
    .click();
  await expect(
    page.getByText("Payment was cancelled in your wallet."),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Payment received" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Pay with wallet", exact: true }),
  ).toBeEnabled();
});

test("detected transfer hides payment controls while finality is pending, including after invoice expiry", async ({
  page,
}) => {
  await page.route("**/api/checkout/detected", async (route) => {
    const q = route.request().postDataJSON();
    await route.fulfill({
      json:
        q?.action === "exchange"
          ? { ok: true }
          : q?.action === "methods"
            ? { methods: [] }
            : {
                merchant: "Test merchant",
                reference: "Detected",
                amount: "1.000000",
                state: "Processing",
                attemptId: "detected",
                attemptState: "Pending",
                symbol: "USDC",
                network: "eip155:84532",
                sandbox: true,
                expiresAt: new Date(0).toISOString(),
                returnUrl: "/",
                settlement: [],
              },
    });
  });
  await page.goto("/checkout/detected#" + "a".repeat(43));
  await expect(
    page.getByRole("heading", { name: "Payment detected" }),
  ).toBeVisible();
  await expect(
    page.getByText("Do not send again.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Pay with wallet" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Payment received" }),
  ).toHaveCount(0);
});
