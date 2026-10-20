import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calculateFee,
  snapshotFees,
  configuredSchedules,
  formatFee,
  feeScheduleSchema,
  pricingVersion,
  legacyPricingVersion,
} from "../lib/payments/pricing";
import { assertPassThroughAllowed, chargeForCustomer, grossUp } from "../lib/payments/fee-bearer";

const usd = {
  orgId: "merchant",
  environment: "production",
  asset: { kind: "fiat", identifier: "USD", network: "" },
  precision: 2,
};
const snapshot = snapshotFees(usd, new Date(), "[]");
const partner = ["card", "digital-wallet", "bnpl", "bank-transfer", "direct-debit", "ussd", "mobile-money"];

test("pricing v2: 1% capped at $5 on partner methods, 1.5% uncapped where PayRouta is the only processor", () => {
  assert.equal(snapshot.version, pricingVersion);
  for (const method of partner) {
    const fee = calculateFee(snapshot, method, "100", 2);
    assert.equal(fee.amountMinor, "100");
    assert.equal(fee.partnerFeeApplies, true);
    assert.equal(calculateFee(snapshot, method, "500", 2).amountMinor, "500", "1% of $500 is exactly the cap");
    assert.equal(calculateFee(snapshot, method, "100000", 2).amountMinor, "500", "$5 cap");
  }
  for (const method of ["stablecoin", "crypto-app"]) {
    const fee = calculateFee(snapshot, method, "100", 2);
    assert.equal(fee.amountMinor, "150");
    assert.equal(fee.partnerFeeApplies, false);
    assert.equal(calculateFee(snapshot, method, "100000", 2).amountMinor, "150000", "crypto is uncapped");
  }
});

test("pricing: exact half-up rounding and no invented minimum", () => {
  assert.equal(calculateFee(snapshot, "card", "0.49", 2).amountMinor, "0");
  assert.equal(calculateFee(snapshot, "card", "0.50", 2).amountMinor, "1");
  assert.equal(calculateFee(snapshot, "stablecoin", "0.33", 2).amountMinor, "0");
  assert.equal(calculateFee(snapshot, "stablecoin", "0.34", 2).amountMinor, "1");
  assert.throws(() => calculateFee(snapshot, "cash-voucher", "100", 2));
  assert.throws(() => calculateFee(snapshot, "card", "1.001", 2));
  assert.throws(() => calculateFee(snapshot, "card", "0", 2));
  assert.equal(formatFee("1", 2), "0.01");
});

test("pricing: sandbox is free even without configured fiat/token schedules", () => {
  const free = snapshotFees({ ...usd, environment: "sandbox" }, new Date(), "malformed");
  assert.equal(calculateFee(free, "card", "1000", 2).amountMinor, "0");
  assert.equal(free.free, true);
});

test("pricing: launch currencies have standard terms and a local $5-equivalent cap", () => {
  const fiat = (identifier: string, precision: number) =>
    snapshotFees({ ...usd, asset: { ...usd.asset, identifier }, precision }, new Date(), "[]");
  assert.equal(calculateFee(fiat("NGN", 2), "bank-transfer", "185000", 2).amountMinor, "185000", "₦1,850");
  assert.equal(calculateFee(fiat("NGN", 2), "card", "5000000", 2).amountMinor, "750000", "capped at ₦7,500");
  assert.equal(calculateFee(fiat("KES", 2), "mobile-money", "2450", 2).amountMinor, "2450");
  assert.equal(calculateFee(fiat("XOF", 0), "card", "1000000", 0).amountMinor, "2800", "zero-decimal currency");
  assert.throws(() => fiat("IDR", 2), /SCHEDULE_REQUIRED/, "no cap set for this currency yet");
  assert.equal(calculateFee(fiat("JPY", 0), "card", "1000000", 0).amountMinor, "700", "capped at ¥700");
  assert.throws(() => fiat("NGN", 0), /SCHEDULE_REQUIRED/, "precision must match the currency");
  assert.throws(() => fiat("XYZ", 2), /SCHEDULE_REQUIRED/);
  assert.throws(() => feeScheduleSchema.parse({ version: "x", asset: "fiat:USD:", inputPrecision: 3, currency: "USD", billingPrecision: 3 }), /minor unit/);
});

test("pricing: negotiated rates and caps apply only to their merchant", () => {
  const raw = JSON.stringify([
    { version: "volume-merchant", asset: "fiat:USD:", inputPrecision: 2, currency: "USD", billingPrecision: 2, partnerBps: 70, partnerCapMinor: "500", orgId: "merchant" },
  ]);
  assert.equal(calculateFee(snapshotFees(usd, new Date(), raw), "card", "100", 2).amountMinor, "70");
  assert.equal(calculateFee(snapshotFees(usd, new Date(), raw), "card", "100000", 2).amountMinor, "500");
  assert.equal(calculateFee(snapshotFees({ ...usd, orgId: "other" }, new Date(), raw), "card", "100", 2).amountMinor, "100");
  // A negotiated schedule can't lift the published $5 cap, with or without its own cap.
  const lifted = JSON.stringify([{ ...JSON.parse(raw)[0], partnerBps: 100, partnerCapMinor: "900" }]);
  assert.equal(calculateFee(snapshotFees(usd, new Date(), lifted), "card", "100000", 2).amountMinor, "500");
  const { partnerCapMinor: _cap, ...uncapped } = JSON.parse(raw)[0];
  void _cap;
  assert.equal(calculateFee(snapshotFees(usd, new Date(), JSON.stringify([uncapped])), "card", "100000", 2).amountMinor, "500");
  const schedule = JSON.parse(raw)[0];
  assert.throws(() => configuredSchedules(JSON.stringify([schedule, schedule])), /DUPLICATE/);
  assert.throws(() => feeScheduleSchema.parse({ ...schedule, partnerBps: 5000 }), "typo guard");
});

test("pricing: crypto uses explicit expiring fiat valuation, never assumed parity", () => {
  const token = {
    ...usd,
    asset: { kind: "blockchain", identifier: "erc20:token", network: "eip155:1" },
    precision: 6,
  };
  const schedule = {
    version: "merchant-valuation",
    asset: "blockchain:erc20:token:eip155:1",
    inputPrecision: 6,
    currency: "USD",
    billingPrecision: 2,
    conversionNumerator: "101",
    conversionDenominator: "1000000",
    validUntil: "2026-10-07T00:00:00.000Z",
    valuationReference: "approved-quote-123",
  };
  const now = new Date("2026-10-06T12:00:00.000Z");
  assert.throws(() => snapshotFees(token, now, "[]"), /SCHEDULE_REQUIRED/);
  const terms = snapshotFees(token, now, JSON.stringify([schedule]));
  // 500 tokens at $1.01 = $505.00; 1.5% = $7.575 → 758 cents.
  assert.equal(calculateFee(terms, "stablecoin", "500", 6).amountMinor, "758");
  assert.throws(() => snapshotFees(token, new Date("2026-10-06T23:45:00.000Z"), JSON.stringify([schedule])), /VALUATION_EXPIRED/);
  const { valuationReference: _, ...missing } = schedule;
  void _;
  assert.throws(() => feeScheduleSchema.parse(missing));
});

test("pricing: v1 snapshots on existing payments keep their original rates and caps", () => {
  const v1 = {
    version: legacyPricingVersion,
    free: false,
    schedule: {
      version: legacyPricingVersion,
      asset: "fiat:USD:",
      inputPrecision: 2,
      currency: "USD",
      billingPrecision: 2,
      highCapMinor: "200",
      lowCapMinor: "100",
      highBps: 25,
      lowBps: 10,
      conversionNumerator: "1",
      conversionDenominator: "1",
    },
  };
  assert.equal(calculateFee(v1, "card", "100", 2).amountMinor, "25");
  assert.equal(calculateFee(v1, "card", "100000", 2).amountMinor, "200");
  assert.equal(calculateFee(v1, "bank-transfer", "100", 2).amountMinor, "10");
  assert.equal(calculateFee(v1, "card", "100", 2).partnerFeeApplies, false, "v1 never adds a partner fee");
});

test("fee bearer: the customer pays enough that the merchant receives the full price", () => {
  // Card on a rail with a 2.9% + 0.30 standard fee: 1% + 2.9% + 0.30 on top of 100.00.
  const card = chargeForCustomer({
    amount: "100.00",
    precision: 2,
    snapshot,
    direct: false,
    partnerFees: [{ bps: 290, fixedMinor: 30n }],
  });
  const charged = BigInt(card.amount.replace(".", ""));
  const fees = (charged * 100n * 2n + 10000n) / 20000n + (charged * 290n * 2n + 10000n) / 20000n + 30n;
  assert.ok(charged - fees >= 10000n, "merchant nets at least the price");
  assert.ok(charged - fees - 1n < 10000n, "and not a cent more than rounding needs");
  assert.equal(card.baseAmount, "100.00");
  assert.equal(card.customerFeeMinor, (charged - 10000n).toString());

  // The most expensive accepted method sets the partner part.
  const mixed = chargeForCustomer({
    amount: "100.00",
    precision: 2,
    snapshot,
    direct: false,
    partnerFees: [{ bps: 0, fixedMinor: 50n }, { bps: 290, fixedMinor: 30n }],
  });
  assert.equal(mixed.amount, card.amount);

  // Above $500 our fee is the $5 cap; only the partner part keeps growing.
  const large = chargeForCustomer({ amount: "1000.00", precision: 2, snapshot, direct: false, partnerFees: [{ bps: 290, fixedMinor: 30n }] });
  const g = BigInt(large.amount.replace(".", ""));
  assert.equal(g - 500n - ((g * 290n * 2n + 10000n) / 20000n + 30n), 100000n, "merchant nets exactly $1,000.00");

  // Crypto: 1.5% only, no partner.
  const crypto = chargeForCustomer({ amount: "100.000000", precision: 6, snapshot, direct: true, partnerFees: [] });
  assert.equal(crypto.amount, "101.522843");

  // Sandbox shows customers the standard rates.
  const sandbox = snapshotFees({ ...usd, environment: "sandbox" }, new Date(), "[]");
  assert.equal(chargeForCustomer({ amount: "100.00", precision: 2, snapshot: sandbox, direct: false, partnerFees: [] }).amount, "101.01");
  assert.equal(grossUp(0n, () => 0n), 0n);
});

test("fee bearer: card and bank surcharges are refused for merchants in the EU and UK", () => {
  assert.throws(() => assertPassThroughAllowed("DE", true), /NOT_PERMITTED/);
  assert.throws(() => assertPassThroughAllowed("GB", true), /NOT_PERMITTED/);
  assert.doesNotThrow(() => assertPassThroughAllowed("DE", false), "crypto is outside the ban");
  assert.doesNotThrow(() => assertPassThroughAllowed("NG", true));
  assert.doesNotThrow(() => assertPassThroughAllowed("US", true));
});
