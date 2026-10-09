import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calculateFee,
  snapshotFees,
  configuredSchedules,
  formatFee,
  feeScheduleSchema,
  pricingVersion,
} from "../lib/payments/pricing";
const usd = {
  orgId: "merchant",
  environment: "production",
  asset: { kind: "fiat", identifier: "USD", network: "" },
  precision: 2,
};
const snapshot = snapshotFees(usd, new Date(), "[]");
test("pricing: all nine methods map to the approved rate and cap", () => {
  for (const method of ["card", "digital-wallet", "bnpl"]) {
    assert.equal(calculateFee(snapshot, method, "100", 2).amountMinor, "25");
    assert.equal(
      calculateFee(snapshot, method, "100000", 2).amountMinor,
      "200",
    );
  }
  for (const method of [
    "bank-transfer",
    "direct-debit",
    "ussd",
    "mobile-money",
    "stablecoin",
    "crypto-app",
  ]) {
    assert.equal(calculateFee(snapshot, method, "100", 2).amountMinor, "10");
    assert.equal(
      calculateFee(snapshot, method, "100000", 2).amountMinor,
      "100",
    );
  }
});
test("pricing: exact half-up rounding and no invented minimum", () => {
  assert.equal(calculateFee(snapshot, "card", "1.99", 2).amountMinor, "0");
  assert.equal(calculateFee(snapshot, "card", "2", 2).amountMinor, "1");
  assert.equal(
    calculateFee(snapshot, "bank-transfer", "5", 2).amountMinor,
    "1",
  );
  assert.equal(
    calculateFee(snapshot, "card", "999999999999999999999", 2).amountMinor,
    "200",
  );
  assert.throws(() => calculateFee(snapshot, "cash-voucher", "100", 2));
  assert.throws(() => calculateFee(snapshot, "card", "1.001", 2));
  assert.throws(() => calculateFee(snapshot, "card", "0", 2));
  assert.equal(formatFee("1", 2), "0.01");
});
test("pricing: sandbox is free even without configured fiat/token schedules", () => {
  const free = snapshotFees(
    { ...usd, environment: "sandbox" },
    new Date(),
    "malformed",
  );
  assert.equal(calculateFee(free, "card", "1000", 2).amountMinor, "0");
  assert.equal(free.free, true);
});
test("pricing: non-USD caps and precision require explicit schedules", () => {
  const eur = { ...usd, asset: { ...usd.asset, identifier: "EUR" } };
  assert.throws(() => snapshotFees(eur, new Date(), "[]"), /SCHEDULE_REQUIRED/);
  assert.throws(() => snapshotFees({ ...usd, precision: 0 }, new Date(), "[]"));
  const schedule = {
    version: "approved-eur",
    asset: "fiat:EUR:",
    inputPrecision: 2,
    currency: "EUR",
    billingPrecision: 2,
    highCapMinor: "180",
    lowCapMinor: "90",
  };
  const terms = snapshotFees(eur, new Date(), JSON.stringify([schedule]));
  assert.equal(calculateFee(terms, "card", "100000", 2).amountMinor, "180");
  assert.throws(
    () => configuredSchedules(JSON.stringify([schedule, schedule])),
    /DUPLICATE/,
  );
});
test("pricing: crypto uses explicit expiring fiat valuation, never assumed parity", () => {
  const token = {
    ...usd,
    asset: {
      kind: "blockchain",
      identifier: "erc20:token",
      network: "eip155:1",
    },
    precision: 6,
  };
  const schedule = {
    version: "merchant-valuation",
    asset: "blockchain:erc20:token:eip155:1",
    inputPrecision: 6,
    currency: "USD",
    billingPrecision: 2,
    highCapMinor: "200",
    lowCapMinor: "100",
    conversionNumerator: "101",
    conversionDenominator: "1000000",
    validUntil: "2026-10-07T00:00:00.000Z",
    valuationReference: "approved-quote-123",
  };
  const now = new Date("2026-10-06T12:00:00.000Z");
  const terms = snapshotFees(token, now, JSON.stringify([schedule]));
  assert.equal(calculateFee(terms, "stablecoin", "500", 6).amountMinor, "51");
  assert.equal(calculateFee(terms, "crypto-app", "5000", 6).amountMinor, "100");
  assert.throws(
    () =>
      snapshotFees(
        token,
        new Date("2026-10-06T23:45:00.000Z"),
        JSON.stringify([schedule]),
      ),
    /VALUATION_EXPIRED/,
  );
  const { valuationReference: _, ...missing } = schedule;
  void _;
  assert.throws(() => feeScheduleSchema.parse(missing));
});
test("pricing: merchant-specific negotiated terms cannot leak to another merchant", () => {
  const s = {
    version: "volume-merchant",
    asset: "fiat:USD:",
    inputPrecision: 2,
    currency: "USD",
    billingPrecision: 2,
    highCapMinor: "200",
    lowCapMinor: "100",
    highBps: 10,
    lowBps: 5,
    orgId: "merchant",
  };
  const raw = JSON.stringify([s]);
  assert.equal(
    calculateFee(snapshotFees(usd, new Date(), raw), "card", "100", 2)
      .amountMinor,
    "10",
  );
  assert.equal(
    calculateFee(
      snapshotFees({ ...usd, orgId: "other" }, new Date(), raw),
      "card",
      "100",
      2,
    ).amountMinor,
    "25",
  );
  const unchanged = calculateFee(snapshot, "card", "100", 2);
  assert.equal(unchanged.version, pricingVersion);
  assert.equal(unchanged.amountMinor, "25");
});

test("pricing: zero- and three-decimal currencies retain their native minor units", () => {
  const schedule = (currency: string, precision: number) => ({
    version: "approved-currency",
    asset: `fiat:${currency}:`,
    inputPrecision: precision,
    currency,
    billingPrecision: precision,
    highCapMinor: "300",
    lowCapMinor: "150",
  });
  const terms = (currency: string, precision: number) =>
    snapshotFees(
      { ...usd, asset: { ...usd.asset, identifier: currency }, precision },
      new Date(),
      JSON.stringify([schedule(currency, precision)]),
    );
  assert.equal(
    calculateFee(terms("JPY", 0), "card", "10000", 0).amountMinor,
    "25",
  );
  assert.equal(
    calculateFee(terms("KWD", 3), "bank-transfer", "100", 3).amountMinor,
    "100",
  );
  assert.equal(formatFee("100", 3), "0.100");
  assert.throws(
    () => feeScheduleSchema.parse(schedule("USD", 3)),
    /minor unit/,
  );
});
