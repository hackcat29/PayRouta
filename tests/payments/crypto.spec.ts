import { test, expect } from "@playwright/test";
test("mixed checkout switches stablecoin and crypto categories and locks the selected payment instructions", async ({
  page,
}) => {
  const choices = [
    {
      id: "eth",
      method: "crypto-app",
      network: "eip155:84532",
      symbol: "ETH",
      identifier: "native:ETH",
      amount: "0.004000000000000000",
      available: true,
    },
    {
      id: "usdc",
      method: "stablecoin",
      network: "eip155:84532",
      symbol: "USDC",
      identifier: "erc20:0x036cbd53842c5426634e7929541ec2318f3dcf7e",
      amount: "12.500000",
      available: true,
    },
  ];
  let selected = choices[0],
    active = false;
  const selectedMethods: string[] = [];
  await page.route("**/api/checkout/mixed-methods", async (route) => {
    const q = route.request().postDataJSON();
    if (q?.action === "choose-network")
      selected = choices.find((o) => o.id === q.optionId)!;
    if (q?.action === "select") selectedMethods.push(q.method);
    if (q?.action === "confirm") active = true;
    await route.fulfill({
      json:
        q?.action === "exchange"
          ? { ok: true }
          : q?.action === "choose-network"
            ? { optionId: selected.id }
            : q?.action === "methods"
              ? {
                  methods: [
                    {
                      method: "stablecoin",
                      label: "Stablecoins",
                      status: "AVAILABLE",
                    },
                    {
                      method: "crypto-app",
                      label: "Crypto wallet",
                      status: "AVAILABLE",
                    },
                  ],
                }
              : q?.action === "select"
                ? { routeId: "mixed-route" }
                : q?.action === "confirm"
                  ? { attemptId: "mixed-attempt" }
                  : {
                      merchant: "Fictional mixed invoice",
                      reference: "Same USD invoice",
                      ...selected,
                      state: active ? "Processing" : "Open",
                      sandbox: true,
                      cryptoQuote: { usdAmount: "10.00", source: "CoinGecko" },
                      expiresAt: new Date(Date.now() + 120000).toISOString(),
                      returnUrl: "/",
                      settlement: [],
                      selectedOption: selected.id,
                      paymentOptions: choices,
                      chainLocked: active,
                      ...(active
                        ? {
                            attemptId: "mixed-attempt",
                            attemptState: "Requires action",
                            action: {
                              kind: "deposit",
                              ...selected,
                              address: `0x${"a".repeat(40)}`,
                            },
                          }
                        : {}),
                    },
    });
  });
  await page.goto(`/checkout/mixed-methods#${"m".repeat(43)}`);
  await expect(
    page.getByRole("button", { name: "Crypto wallet", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Stablecoins", exact: true }).click();
  await expect(page.getByLabel("Token and network")).toHaveValue("usdc");
  await expect(
    page.getByRole("button", { name: "Continue with stablecoins" }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Crypto wallet", exact: true })
    .click();
  await expect(page.getByLabel("Token and network")).toHaveValue("eth");
  await page.getByRole("button", { name: "Stablecoins", exact: true }).click();
  await expect(page.getByLabel("Token and network")).toHaveValue("usdc");
  await page.getByRole("button", { name: "Continue with stablecoins" }).click();
  await expect(
    page.getByRole("heading", { name: "Pay 12.50 USDC" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Pay with wallet", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Crypto wallet", exact: true }),
  ).toBeDisabled();
  await expect(page.getByLabel("Token and network")).toBeDisabled();
  expect(selectedMethods).toEqual(["stablecoin"]);
  await expect(page.getByText("USDT0", { exact: true })).toHaveCount(0);
});
test("paid crypto-only checkout retains visible stablecoin category without creating a second payment", async ({
  page,
}) => {
  await page.route("**/api/checkout/paid-crypto-only", (route) =>
    route.fulfill({
      json:
        route.request().postDataJSON()?.action === "exchange"
          ? { ok: true }
          : {
              merchant: "Fictional paid invoice",
              reference: "Paid ETH",
              amount: "0.00004",
              symbol: "ETH",
              method: "crypto-app",
              network: "eip155:84532",
              sandbox: true,
              state: "Confirmed",
              attemptId: "paid",
              attemptState: "Confirmed",
              expiresAt: new Date(Date.now() - 60000).toISOString(),
              returnUrl: "/",
              settlement: ["Completed"],
              paymentMethods: [
                {
                  method: "stablecoin",
                  label: "Stablecoins",
                  status: "NOT_OFFERED",
                },
                {
                  method: "crypto-app",
                  label: "Crypto wallet",
                  status: "LOCKED",
                },
              ],
            },
    }),
  );
  await page.goto(`/checkout/paid-crypto-only#${"p".repeat(43)}`);
  await expect(
    page.getByRole("heading", { name: "Payment received" }),
  ).toBeVisible();
  await expect(page.getByText("Stablecoins", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Not offered for this checkout", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Pay with wallet", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Checkout expired" }),
  ).toHaveCount(0);
});
import AxeBuilder from "@axe-core/playwright";
test("customers choose MetaMask when Phantom owns window.ethereum", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const win = window as unknown as Window & {
      ethereum: unknown;
      chosenWalletCalls: {
        wallet: string;
        method: string;
        params?: unknown[];
      }[];
    };
    win.chosenWalletCalls = [];
    const makeWallet = (name: string) => ({
      request: async (q: { method: string; params?: unknown[] }) => {
        win.chosenWalletCalls.push({ wallet: name, ...q });
        return q.method === "eth_chainId"
          ? "0x14a34"
          : q.method === "eth_requestAccounts"
            ? [`0x${"b".repeat(40)}`]
            : `0x${"c".repeat(64)}`;
      },
    });
    const phantom = makeWallet("Phantom"),
      metamask = makeWallet("MetaMask");
    win.ethereum = phantom;
    window.addEventListener("eip6963:requestProvider", () => {
      for (const [name, provider, uuid] of [
        ["Phantom", phantom, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
        ["MetaMask", metamask, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],
      ] as const)
        window.dispatchEvent(
          new CustomEvent("eip6963:announceProvider", {
            detail: {
              info: { name, uuid, rdns: "example.wallet", icon: "" },
              provider,
            },
          }),
        );
    });
  });
  await page.route("**/api/checkout/multi-wallet", (route) =>
    route.fulfill({
      json:
        route.request().postDataJSON()?.action === "exchange"
          ? { ok: true }
          : {
              merchant: "Fictional multi-wallet invoice",
              reference: "Test ETH",
              amount: "0.000000000000000001",
              symbol: "ETH",
              method: "crypto-app",
              network: "eip155:84532",
              sandbox: true,
              state: "Processing",
              attemptId: "attempt",
              attemptState: "Requires action",
              expiresAt: new Date(Date.now() + 120000).toISOString(),
              returnUrl: "/merchant",
              settlement: [],
              action: {
                kind: "deposit",
                address: `0x${"a".repeat(40)}`,
                network: "eip155:84532",
                identifier: "native:ETH",
                amount: "0.000000000000000001",
                symbol: "ETH",
              },
            },
    }),
  );
  await page.goto(`/checkout/multi-wallet#${"a".repeat(43)}`);
  const choice = page.getByLabel("Choose your wallet", { exact: true });
  await expect(choice).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Pay with wallet", exact: true }),
  ).toBeDisabled();
  await choice.selectOption({ label: "MetaMask" });
  await page
    .getByRole("button", { name: "Pay with wallet", exact: true })
    .click();
  await expect(page.getByText(/Transaction sent:/)).toBeVisible();
  const calls = await page.evaluate(
    () =>
      (
        window as unknown as {
          chosenWalletCalls: {
            wallet: string;
            method: string;
            params?: { to: string; value: string }[];
          }[];
        }
      ).chosenWalletCalls,
  );
  expect(calls.length).toBeGreaterThan(0);
  expect(calls.every((q) => q.wallet === "MetaMask")).toBe(true);
  expect(
    calls.find((q) => q.method === "eth_sendTransaction")?.params?.[0],
  ).toMatchObject({ to: `0x${"a".repeat(40)}`, value: "0x1" });
});
test("an on-time detected payment keeps waiting for finality after the quote deadline", async ({
  page,
}) => {
  await page.route("**/api/checkout/paid-after-countdown", (route) =>
    route.fulfill({
      json:
        route.request().postDataJSON()?.action === "exchange"
          ? { ok: true }
          : {
              merchant: "Fictional paid invoice",
              reference: "Test ETH",
              amount: "0.001",
              symbol: "ETH",
              method: "crypto-app",
              network: "eip155:84532",
              sandbox: true,
              state: "Processing",
              attemptId: "paid",
              attemptState: "Pending",
              cryptoQuote: { usdAmount: "0.10", source: "CoinGecko" },
              expiresAt: new Date(Date.now() - 60000).toISOString(),
              returnUrl: "/merchant",
              settlement: [],
            },
    }),
  );
  await page.goto(`/checkout/paid-after-countdown#${"b".repeat(43)}`);
  await expect(
    page.getByRole("heading", { name: "Payment detected", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Your transfer is visible on the network. Do not send again.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Checkout expired", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Payment window ended", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText(
      /Your transfer was detected\. Verification continues after the quote deadline/,
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Pay with wallet", exact: true }),
  ).toHaveCount(0);
});
test("a failed access exchange retains the full checkout link for recovery", async ({
  page,
}) => {
  const token = "r".repeat(43);
  await page.route("**/api/checkout/exchange-retry", (route) =>
    route.fulfill({ status: 503, json: { error: "SERVICE_UNAVAILABLE" } }),
  );
  await page.goto(`/checkout/exchange-retry#${token}`);
  await expect(
    page.getByRole("heading", { name: "Open your original checkout link" }),
  ).toBeVisible();
  await expect(page).toHaveURL(
    new RegExp(`/checkout/exchange-retry#${token}$`),
  );
});
test("external wallet links include a fresh access token and open in a browser with no checkout cookie", async ({
  page,
  browser,
}) => {
  const expiresAt = new Date(Date.now() + 120000).toISOString();
  let authorized = false;
  const state = {
    merchant: "Fictional wallet handoff",
    reference: "Same USD invoice",
    amount: "0.00004",
    symbol: "ETH",
    method: "crypto-app",
    network: "eip155:84532",
    sandbox: true,
    state: "Open",
    expiresAt,
    returnUrl: "/merchant",
    settlement: [],
  };
  await page.route("**/api/checkout/wallet-source", async (route) => {
    const q = route.request().postDataJSON();
    await route.fulfill({
      json:
        q?.action === "wallet-link"
          ? {
              checkoutPath: `/checkout/wallet-target#${"t".repeat(43)}`,
              expiresAt,
            }
          : q?.action === "exchange"
            ? { ok: true }
            : q?.action === "methods"
              ? { methods: [] }
              : state,
    });
  });
  await page.goto(`/checkout/wallet-source#${"s".repeat(43)}`);
  await expect(page.getByRole("timer")).toBeVisible();
  await expect(page).toHaveURL(/\/checkout\/wallet-source$/);
  await page
    .getByText("Open in an external wallet browser", { exact: true })
    .click();
  await page
    .getByRole("button", { name: "Copy link for wallet browser" })
    .click();
  const link = await page
    .getByLabel("Wallet browser link", { exact: true })
    .inputValue();
  expect(link).toContain(`/checkout/wallet-target#${"t".repeat(43)}`);
  const external = await browser.newContext();
  try {
    expect(await external.cookies()).toEqual([]);
    await external.route("**/api/checkout/wallet-target", async (route) => {
      const q = route.request().postDataJSON();
      if (q?.action === "exchange") authorized = q.token === "t".repeat(43);
      await route.fulfill({
        status: authorized ? 200 : 401,
        json: !authorized
          ? { error: "CHECKOUT_EXPIRED_OR_UNAUTHORIZED" }
          : q?.action === "exchange"
            ? { ok: true }
            : q?.action === "methods"
              ? { methods: [] }
              : state,
      });
    });
    const target = await external.newPage();
    await target.goto(link);
    await expect(
      target.getByText("Fictional wallet handoff", { exact: true }),
    ).toBeVisible();
    await expect(target.getByRole("timer")).toBeVisible();
    expect(authorized).toBe(true);
  } finally {
    await external.close();
  }
});
test("a checkout without browser credentials explains recovery without exposing an internal error", async ({
  page,
}) => {
  await page.route("**/api/checkout/missing-wallet-access", (route) =>
    route.fulfill({
      status: 401,
      json: { error: "CHECKOUT_EXPIRED_OR_UNAUTHORIZED" },
    }),
  );
  await page.goto("/checkout/missing-wallet-access");
  await expect(
    page.getByRole("alert").filter({ hasText: "This checkout link" }),
  ).toContainText("Open the full checkout link from the merchant");
  await expect(
    page.getByRole("heading", { name: "Open your original checkout link" }),
  ).toBeVisible();
  await expect(
    page.getByText("CHECKOUT_EXPIRED_OR_UNAUTHORIZED", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Pay with wallet", exact: true }),
  ).toHaveCount(0);
});
test("crypto checkout selects ETH Base or exact PEPE Ethereum and sends the chosen wallet transaction", async ({
  page,
}) => {
  const choices = [
    {
      id: "base-eth",
      network: "eip155:8453",
      symbol: "ETH",
      identifier: "native:ETH",
      amount: "0.004000000000000000",
      available: true,
    },
    {
      id: "ethereum-pepe",
      network: "eip155:1",
      symbol: "PEPE",
      identifier: "erc20:0x6982508145454ce325ddbe47a25d4ec3d2311933",
      amount: "2500000.000000000000000000",
      available: true,
    },
  ];
  let selected = choices[0].id,
    attempt = false;
  const calls: unknown[] = [];
  await page.addInitScript(() => {
    const win = window as unknown as Window & {
      ethereum: {
        request: (q: {
          method: string;
          params?: unknown[];
        }) => Promise<unknown>;
      };
      walletCalls: unknown[];
    };
    win.walletCalls = [];
    win.ethereum = {
      request: async (q) => {
        win.walletCalls.push(q);
        return q.method === "eth_chainId"
          ? "0x1"
          : q.method === "eth_requestAccounts"
            ? [`0x${"b".repeat(40)}`]
            : `0x${"c".repeat(64)}`;
      },
    };
  });
  await page.route("**/api/checkout/crypto-browser", async (route) => {
    const q = route.request().postDataJSON();
    if (q) calls.push(q);
    if (q?.action === "choose-network") selected = q.optionId;
    if (q?.action === "confirm") attempt = true;
    const choice = choices.find((c) => c.id === selected)!;
    const result =
      q?.action === "exchange"
        ? { ok: true }
        : q?.action === "methods"
          ? {
              methods: [
                {
                  method: "crypto-app",
                  label: "Crypto wallet",
                  status: "AVAILABLE",
                },
                { method: "card", label: "Cards", status: "COMING_SOON" },
              ],
            }
          : q?.action === "select"
            ? { routeId: "crypto-quote" }
            : q?.action === "confirm"
              ? { attemptId: "crypto-attempt" }
              : q?.action === "choose-network"
                ? { optionId: selected }
                : {
                    merchant: "Fictional crypto checkout",
                    reference: "USD invoice",
                    ...choice,
                    method: "crypto-app",
                    cryptoQuote: { usdAmount: "10.00", source: "CoinGecko" },
                    state: attempt ? "Processing" : "Open",
                    sandbox: false,
                    expiresAt: new Date(Date.now() + 120000).toISOString(),
                    returnUrl: "/",
                    settlement: [],
                    paymentOptions: choices,
                    selectedOption: selected,
                    chainLocked: attempt,
                    ...(attempt
                      ? {
                          attemptId: "crypto-attempt",
                          attemptState: "Requires action",
                          action: {
                            kind: "deposit",
                            ...choice,
                            address: `0x${"a".repeat(40)}`,
                          },
                        }
                      : {}),
                  };
    await route.fulfill({ json: result });
  });
  await page.goto(`/checkout/crypto-browser#${"a".repeat(43)}`);
  await expect(page.getByText(/Rate by CoinGecko/)).toBeVisible();
  await expect(page.getByRole("timer")).toBeVisible();
  await page.getByLabel("Token and network").selectOption("ethereum-pepe");
  await expect(
    page.getByRole("button", { name: "Continue with crypto wallet" }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Continue with crypto wallet" })
    .click();
  await expect(
    page.getByRole("button", { name: "Pay with wallet", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(`0x${"a".repeat(40)}`, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Copy address", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Token and network")).toBeDisabled();
  expect(calls).toContainEqual({ action: "select", method: "crypto-app" });
  await page
    .getByRole("button", { name: "Pay with wallet", exact: true })
    .click();
  await expect(page.getByText(/Transaction sent:/)).toBeVisible();
  const walletCalls = await page.evaluate(
    () =>
      (
        window as unknown as Window & {
          walletCalls: {
            method: string;
            params?: { to: string; value: string; data: string }[];
          }[];
        }
      ).walletCalls,
  );
  const tx = walletCalls.find((c) => c.method === "eth_sendTransaction")!
    .params![0];
  expect(tx.to).toBe("0x6982508145454ce325ddbe47a25d4ec3d2311933");
  expect(tx.value).toBe("0x0");
  expect(tx.data).toMatch(/^0xa9059cbb/);
  const findings = await new AxeBuilder({ page }).analyze();
  expect(
    findings.violations.filter(
      (v) => v.impact === "critical" || v.impact === "serious",
    ),
  ).toEqual([]);
});
