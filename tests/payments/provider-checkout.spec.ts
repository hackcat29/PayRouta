import { test, expect } from "@playwright/test";
test("future provider methods remain disabled even if an older availability response offers them", async ({
  page,
}) => {
  const attempts: unknown[] = [];
  await page.route("**/api/checkout/legacy", async (route) => {
    const raw = route.request().postDataJSON();
    if (raw) attempts.push(raw);
    const result =
      raw?.action === "exchange"
        ? { ok: true }
        : raw?.action === "pay-options"
          ? { locked: false, settle: null, chains: [] }
        : raw?.action === "methods"
          ? {
              methods: [
                {
                  method: "stablecoin",
                  label: "Stablecoins",
                  status: "UNAVAILABLE",
                },
                { method: "card", label: "Card", status: "AVAILABLE" },
                {
                  method: "digital-wallet",
                  label: "Digital wallet",
                  status: "AVAILABLE",
                },
              ],
            }
          : {
              merchant: "Test store",
              reference: "Legacy invoice",
              amount: "1.000000",
              state: "Open",
              symbol: "USDC",
              network: "eip155:84532",
              sandbox: true,
              expiresAt: new Date(Date.now() + 60000).toISOString(),
              returnUrl: "/",
              settlement: [],
            };
    await route.fulfill({ json: result });
  });
  await page.goto("/checkout/legacy#" + "a".repeat(43));
  await expect(page.getByText("Coming soon", { exact: true })).toHaveCount(7);
  await expect(page.getByText(/can't take crypto payments for this checkout/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue", exact: true })).toHaveCount(0);
  await expect(page.locator("input")).toHaveCount(0);
  expect(
    attempts.some(
      (x: unknown) => (x as { action?: string }).action === "select",
    ),
  ).toBe(false);
});
