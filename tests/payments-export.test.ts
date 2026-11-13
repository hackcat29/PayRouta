// The merchant's payments CSV reads like a statement: plain columns an
// accountant can use without asking what anything means.
import { test } from "node:test";
import assert from "node:assert/strict";
import { decimal, exportColumns, exportCsv, type ExportPayment } from "../lib/merchant/payments-export";
import { destinations } from "../lib/intents/oneclick";

const usdcBase = destinations.find((d) => d.network === "eip155:8453" && d.symbol === "USDC")!;
const now = new Date("2026-11-13T12:00:00Z");
const base: Omit<ExportPayment, "id" | "reference" | "amount" | "state"> = {
  asset: { kind: "blockchain", network: "eip155:8453", identifier: "erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" },
  precision: 6,
  selectedMethod: "stablecoin",
  createdAt: new Date("2026-11-12T19:00:23Z"),
  expiresAt: new Date("2026-11-12T19:30:00Z"),
};
// A CSV line split into its cells (the export quotes every cell).
const cells = (line: string) => [...line.matchAll(/"((?:[^"]|"")*)"/g)].map((m) => m[1].replaceAll('""', '"'));
const parse = (csv: string) => {
  const [head, ...rows] = csv.trim().split("\r\n").map(cells);
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
};

test("payments CSV: plain column names", () => {
  const csv = exportCsv([], { swaps: [], fees: [], refunds: [], claims: [] }, now);
  assert.deepEqual(cells(csv.split("\r\n")[0]), [...exportColumns]);
});

test("payments CSV: a NEAR Intents payment shows what the customer paid with, the fee withheld and what the merchant received", () => {
  // WooCommerce order #16, paid on mainnet on 12 November 2026.
  const [row] = parse(
    exportCsv(
      [{ ...base, id: "pay_16", reference: "16", amount: "2.000929", state: "Confirmed" }],
      {
        swaps: [
          {
            intentId: "pay_16",
            status: "SUCCESS",
            originSymbol: "ETH",
            originChain: "base",
            amountInFormatted: "0.001005322573809397",
            amountOut: "1970915",
            appFeeMinor: "30014",
            destinationAsset: usdcBase.assetId,
            depositAddress: "0x041bc4514C6FE3D2Da21F1EC025cf4e764381287",
            createdAt: new Date("2026-11-12T19:00:50Z"),
          },
        ],
        fees: [],
        refunds: [],
        claims: [],
      },
      now,
    ),
  );
  assert.deepEqual(row, {
    "Date (UTC)": "2026-11-12 19:00:23",
    "Payment ID": "pay_16",
    "Order reference": "16",
    Status: "Paid",
    "Invoice amount": "2.000929",
    Currency: "USDC",
    Network: "Base",
    "Paid with": "0.001005322573809397 ETH on Base",
    "PayRouta fee": "0.030014",
    "Fee collected": "Withheld at source",
    "Merchant received": "1.970915",
    Refunded: "",
    "Transaction link": "https://explorer.near-intents.org/transactions/0x041bc4514C6FE3D2Da21F1EC025cf4e764381287",
  });
});

test("payments CSV: a direct stablecoin payment links its transaction; a card payment's fee is on the statement", () => {
  const rows = parse(
    exportCsv(
      [
        { ...base, id: "pay_direct", reference: "A-1", amount: "40.000000", state: "Confirmed" },
        { ...base, id: "pay_card", reference: "A-2", amount: "10.00", precision: 2, state: "Confirmed", selectedMethod: "card", asset: { kind: "fiat", identifier: "USD" } },
      ],
      {
        swaps: [],
        fees: [{ intentId: "pay_card", amountMinor: "30", precision: 2, currency: "USD", collection: "invoice" }],
        refunds: [{ intentId: "pay_card", text: "10.00 USD" }],
        claims: [{ intentId: "pay_direct", network: "eip155:8453", txHash: "0x" + "ab".repeat(32) }],
      },
      now,
    ),
  );
  const direct = rows.find((r) => r["Payment ID"] === "pay_direct")!;
  assert.equal(direct["Paid with"], "40.000000 USDC on Base");
  assert.equal(direct["Merchant received"], "40.000000");
  assert.match(direct["Transaction link"], /^https:\/\/basescan\.org\/tx\/0x(ab){32}$/);
  const card = rows.find((r) => r["Payment ID"] === "pay_card")!;
  assert.equal(card.Currency, "USD");
  assert.equal(card.Network, "");
  assert.equal(card["Paid with"], "Card");
  assert.equal(card["PayRouta fee"], "0.30");
  assert.equal(card["Fee collected"], "On the monthly statement");
  assert.equal(card.Refunded, "10.00 USD");
});

test("payments CSV: unpaid checkouts say so, and a formula in a reference is defused", () => {
  const rows = parse(
    exportCsv(
      [
        { ...base, id: "pay_old", reference: "=HYPERLINK(\"x\")", amount: "5.00", state: "Open" },
        { ...base, id: "pay_new", reference: "B-2", amount: "5.00", state: "Requires action", expiresAt: new Date("2026-11-13T12:30:00Z") },
      ],
      { swaps: [], fees: [], refunds: [], claims: [] },
      now,
    ),
  );
  const old = rows.find((r) => r["Payment ID"] === "pay_old")!;
  assert.equal(old.Status, "Expired, unpaid");
  assert.equal(old["Paid with"], "");
  assert.equal(old["Merchant received"], "");
  assert.equal(old["Order reference"], "'=HYPERLINK(\"x\")", "spreadsheets show it as text");
  assert.equal(rows.find((r) => r["Payment ID"] === "pay_new")!.Status, "Awaiting payment");
});

test("payments CSV: amounts keep their precision, with at least two decimal places", () => {
  assert.equal(decimal("1970915", 6), "1.970915");
  assert.equal(decimal("25000000", 6), "25.00");
  assert.equal(decimal("30", 2), "0.30");
  assert.equal(decimal("7", 0), "7");
  assert.equal(decimal("5", 6), "0.000005");
});
