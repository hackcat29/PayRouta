import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenAssets, validStablecoinAmount } from "../lib/blockchain/assets";
import { chain } from "../lib/blockchain/chains";
import { stablecoinCheckoutTerms } from "../lib/merchant/stablecoin-checkout";
import { responseContract, openapi } from "../lib/merchant/contracts";
import { calculateFee, snapshotFees } from "../lib/payments/pricing";
for (const token of tokenAssets)
  test(`${token.symbol} ${token.network}: merchant terms, exact amounts and asset-specific fee snapshot`, () => {
    const environment = chain(token.network)!.testnet
      ? "sandbox"
      : "production";
    const input = {
      environment,
      key: "test-idempotency",
      reference: "Fictional checkout",
      payerCountry: "NG",
      options: [
        {
          network: token.network,
          identifier: token.identifier,
          amount: "1." + "0".repeat(token.decimals - 1) + "1",
        },
      ],
    };
    const terms = stablecoinCheckoutTerms(input, "https://merchant.example");
    assert.equal(terms.amount, input.options[0].amount);
    assert.equal(terms.precision, token.decimals);
    assert.deepEqual(terms.asset, terms.settlement);
    assert.deepEqual(terms.methods, ["stablecoin"]);
    assert.equal(terms.returnUrl, "https://merchant.example/");
    assert.throws(
      () =>
        stablecoinCheckoutTerms(
          { ...input, options: [input.options[0], input.options[0]] },
          "https://merchant.example",
        ),
      /DUPLICATE/,
    );
    for (const amount of [
      "0",
      "-1",
      "1e3",
      "1." + "0".repeat(token.decimals) + "1",
    ])
      assert.throws(() =>
        stablecoinCheckoutTerms(
          { ...input, options: [{ ...input.options[0], amount }] },
          "https://merchant.example",
        ),
      );
    const bits =
      chain(token.network)!.family === "evm"
        ? 256n
        : chain(token.network)!.family === "solana"
          ? 64n
          : 63n;
    const asDecimal = (minor: bigint) => {
      const s = minor.toString().padStart(token.decimals + 1, "0");
      return s.slice(0, -token.decimals) + "." + s.slice(-token.decimals);
    };
    assert.equal(
      validStablecoinAmount(
        token.network,
        token.identifier,
        asDecimal(2n ** bits - 1n),
      ),
      true,
    );
    assert.equal(
      validStablecoinAmount(
        token.network,
        token.identifier,
        asDecimal(2n ** bits),
      ),
      false,
    );
    const feeInput = {
      orgId: "fictional-unit-test",
      environment,
      asset: terms.asset,
      precision: terms.precision,
    };
    if (environment === "sandbox") {
      assert.equal(
        calculateFee(
          snapshotFees(feeInput),
          "stablecoin",
          "1000",
          terms.precision,
        ).amountMinor,
        "0",
      );
    } else {
      assert.throws(
        () => snapshotFees(feeInput, new Date("2026-10-07T00:00:00Z"), "[]"),
        /FEE_SCHEDULE_REQUIRED/,
      );
      // Explicit fictional valuation; EURC intentionally differs from USD-backed tokens.
      const numerator = token.symbol === "EURC" ? "110" : "100";
      const raw = JSON.stringify([
        {
          version: "fictional-qualified-test",
          asset: `blockchain:${token.identifier}:${token.network}`,
          inputPrecision: token.decimals,
          currency: "USD",
          billingPrecision: 2,
          conversionNumerator: numerator,
          conversionDenominator: String(10 ** token.decimals),
          validUntil: "2026-10-08T00:00:00Z",
          valuationReference: "fictional-regression-valuation",
        },
      ]);
      const snapshot = snapshotFees(
        feeInput,
        new Date("2026-10-07T00:00:00Z"),
        raw,
      );
      // 1.5%, uncapped: PayRouta is the only processor for stablecoins.
      assert.equal(
        calculateFee(snapshot, "stablecoin", "500", token.decimals).amountMinor,
        token.symbol === "EURC" ? "825" : "750",
      );
      assert.equal(
        calculateFee(snapshot, "stablecoin", "2000", token.decimals)
          .amountMinor,
        token.symbol === "EURC" ? "3300" : "3000",
      );
    }
  });
test("configuration contract and OpenAPI describe additional live assets and per-token execution readiness", () => {
  const configuration = {
    environment: "production",
    country: "NG",
    returnOrigin: "https://merchant.example",
    applicationState: "Approved",
    executionPaused: false,
    permittedMethods: ["stablecoin"],
    limits: [],
    liveScope: {
      status: "Approved",
      reviewCurrent: true,
      merchantCountry: "NG",
      payerCountries: ["NG"],
      methods: ["stablecoin"],
      asset: "primary",
      additionalAssets: [
        {
          asset: "usdt",
          maximumMinor: "1000000",
          dailyMaximumMinor: "10000000",
        },
      ],
      settlementAsset: "primary",
      maximumMinor: "1000000",
      dailyMaximumMinor: "10000000",
      nextReviewAt: "2026-10-08T00:00:00Z",
    },
    comingSoonMethods: [],
    liveExecutionEnabled: true,
    cryptoAssets: [],
    stablecoinAssets: [
      {
        network: "eip155:1",
        identifier: "usdt",
        symbol: "USDT",
        decimals: 6,
        configured: true,
        executionEnabled: true,
        reason: null,
      },
    ],
  };
  assert.deepEqual(
    responseContract("GET configuration").parse(configuration),
    configuration,
  );
  const schema = JSON.stringify(openapi().paths["/configuration"]);
  assert.ok(schema.includes("additionalAssets"));
  assert.ok(schema.includes("stablecoinAssets"));
});
