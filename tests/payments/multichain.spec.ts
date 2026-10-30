import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test("customer selects a merchant quote and the network locks when instructions are issued", async ({
  page,
}) => {
  let selected = "base",
    attempt = false;
  const choices = [
    {
      id: "base",
      network: "eip155:84532",
      symbol: "USDC",
      identifier: "erc20:0x036cbd53842c5426634e7929541ec2318f3dcf7e",
      amount: "1.000000",
      available: true,
    },
    {
      id: "solana",
      network: "solana:devnet",
      symbol: "EURC",
      identifier: "spl:HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr",
      amount: "0.900000",
      available: true,
    },
    {
      id: "stellar",
      network: "stellar:testnet",
      symbol: "USDC",
      identifier:
        "stellar:USDC.GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      amount: "1.0000000",
      available: false,
    },
  ];
  const calls: unknown[] = [];
  await page.route("**/api/checkout/multichain-ui", async (route) => {
    const q = route.request().postDataJSON();
    if (q) calls.push(q);
    if (q?.action === "choose-network") selected = q.optionId;
    if (q?.action === "confirm") attempt = true;
    const choice = choices.find((c) => c.id === selected)!;
    const result =
      q?.action === "exchange"
        ? { ok: true }
        : q?.action === "pay-options"
          ? {
              locked: attempt,
              settle: null,
              chains: choices
                .filter((c) => c.available)
                .map((c) => ({
                  id: c.network,
                  name: c.network === "solana:devnet" ? "Solana Devnet" : "Base Sepolia",
                  tokens: [{ key: `direct:${c.id}`, symbol: c.symbol, route: "direct", method: "stablecoin", optionId: c.id, amount: c.amount }],
                })),
            }
        : q?.action === "methods"
          ? {
              methods: [
                {
                  method: "stablecoin",
                  label: "Stablecoins",
                  status: "AVAILABLE",
                },
                { method: "card", label: "Cards", status: "COMING_SOON" },
              ],
            }
          : q?.action === "select"
            ? { routeId: "quote" }
            : q?.action === "choose-network"
              ? { optionId: selected }
              : q?.action === "confirm"
                ? { attemptId: "attempt" }
                : {
                    merchant: "Fictional multichain store",
                    reference: "Quoted invoice",
                    ...choice,
                    state: attempt ? "Processing" : "Open",
                    sandbox: true,
                    expiresAt: new Date(Date.now() + 60000).toISOString(),
                    returnUrl: "/",
                    settlement: [],
                    paymentOptions: choices,
                    selectedOption: selected,
                    chainLocked: attempt,
                    ...(attempt
                      ? {
                          attemptId: "attempt",
                          attemptState: "Requires action",
                          action: {
                            kind: "deposit",
                            ...choice,
                            address:
                              "BPFLoaderUpgradeab1e11111111111111111111111",
                          },
                        }
                      : {}),
                  };
    await route.fulfill({ json: result });
  });
  await page.goto("/checkout/multichain-ui#" + "a".repeat(43));
  await page.getByLabel("Network", { exact: true }).selectOption("solana:devnet");
  await page.getByLabel("Token", { exact: true }).selectOption("direct:solana");
  await expect(page.getByText(/You send exactly 0\.90 EURC on Solana Devnet/)).toBeVisible();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "0.90 EURC", exact: true }),
  ).toBeVisible();
  // Instructions are issued: nothing left to choose.
  await expect(page.getByLabel("Network", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Token mint", { exact: true })).toBeVisible();
  await expect(page.getByText(/also needs test SOL/)).toBeVisible();
  expect(
    calls.some((c) => (c as { action: string }).action === "choose-network"),
  ).toBe(true);
  await expect(page.getByText("Coming soon", { exact: true })).toHaveCount(7);
  const violations = (
    await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()
  ).violations;
  expect(violations).toEqual([]);
});
test("Stellar checkout shows issuer and XLM fee and hides wallet payment after detection", async ({
  page,
}) => {
  let pending = false;
  await page.route("**/api/checkout/stellar-ui", async (route) => {
    const q = route.request().postDataJSON();
    await route.fulfill({
      json:
        q?.action === "exchange"
          ? { ok: true }
          : {
              merchant: "Fictional Stellar store",
              reference: "Stellar invoice",
              amount: "1.0000000",
              symbol: "USDC",
              network: "stellar:testnet",
              state: "Processing",
              attemptId: "attempt",
              attemptState: pending ? "Pending" : "Requires action",
              sandbox: true,
              expiresAt: new Date(Date.now() + 60000).toISOString(),
              returnUrl: "/",
              settlement: [],
              action: {
                kind: "deposit",
                amount: "1.0000000",
                symbol: "USDC",
                network: "stellar:testnet",
                identifier:
                  "stellar:USDC.GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
                address:
                  "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
              },
            },
    });
  });
  await page.goto("/checkout/stellar-ui#" + "b".repeat(43));
  await expect(
    page.getByText("Token and issuer", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/also needs test XLM/)).toBeVisible();
  pending = true;
  await expect(
    page.getByRole("heading", { name: "Payment detected" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Pay with wallet", exact: true }),
  ).toHaveCount(0);
});

test("expired instructions retain status recovery and merchant resolution without a new transfer", async ({
  page,
}) => {
  let checks = 0;
  await page.route("**/api/checkout/expired-ui", async (route) => {
    const body = route.request().postDataJSON();
    if (body?.action === "refresh") checks++;
    await route.fulfill({
      json:
        body?.action === "exchange"
          ? { ok: true }
          : body?.action === "refresh"
            ? { queued: true }
            : {
                merchant: "Fictional store",
                reference: "Expired test",
                amount: "1.000000",
                symbol: "USDC",
                network: "solana:devnet",
                state: "Processing",
                attemptId: "attempt",
                attemptState: "Requires action",
                sandbox: true,
                expiresAt: new Date(Date.now() - 60000).toISOString(),
                returnUrl: "/merchant",
                settlement: [],
              },
    });
  });
  await page.goto("/checkout/expired-ui#" + "c".repeat(43));
  await expect(
    page.getByRole("heading", { name: "Checkout expired", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Payment window ended", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Pay with wallet", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Check payment status", exact: true })
    .click();
  await expect(page.getByText(/Status check requested/)).toBeVisible();
  expect(checks).toBe(1);
  await expect(
    page.getByRole("link", {
      name: "Return to merchant for a new checkout",
      exact: true,
    }),
  ).toHaveAttribute("href", "/merchant");
});
