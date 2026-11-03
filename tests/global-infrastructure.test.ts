import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDefaultRateBook,
  buildSplicedPostings,
  createSpliceQuote,
  decodeTripleEntryPurpose,
  encodeTripleEntryPurpose,
} from "../lib/payments/fx-splicing";
import { validatePostings } from "../lib/payments/journal";
import { localizeCheckoutMethods } from "../lib/payments/localization";
import {
  buildTaxComplianceReport,
  calculateCheckoutTax,
  validateBusinessTaxId,
} from "../lib/payments/tax";
import {
  UsageMeterStream,
  calculateMillisecondProration,
  changeSubscriptionPlan,
  createSubscription,
  scheduleSmartDunning,
} from "../lib/payments/subscriptions";
import {
  assertMerchantFulfillmentAllowed,
  createCreditIntent,
  finalizeCreditPaymentSuccess,
  recordCreditDecline,
  recordLenderDisbursal,
  resolveContinentalCreditRoute,
  submitCreditForApproval,
} from "../lib/payments/credit-intents";
import { adyenKlarnaBnplPlatform } from "../lib/treasury/platforms/adyen-klarna-bnpl";
import { mercadopagoBnplPlatform } from "../lib/treasury/platforms/mercadopago-bnpl";
import { migoBnplPlatform } from "../lib/treasury/platforms/migo-bnpl";
import { xenditBnplPlatform } from "../lib/treasury/platforms/xendit-bnpl";
import { platformModule } from "../lib/treasury/platforms/registry";
import { coverage, payouts, pillars } from "../content/claims";

test("Pillar 1: Any-to-Any FX Splicing prices in JPY, collects KES (M-Pesa), and settles in USDC or EUR without double USD conversion", () => {
  const now = new Date("2026-10-24T09:00:00.000Z");

  // European merchant prices software at ¥15,500 JPY (~$100 USD), Kenyan buyer pays in KES via M-Pesa,
  // merchant settles into USDC on Solana.
  const quoteUsdc = createSpliceQuote({
    pricingCurrency: "JPY",
    pricingAmountMinor: 15_500n, // JPY has 0 exponent
    presentmentCurrency: "KES",
    presentmentRail: "MPESA",
    settlementCurrency: "USDC",
    settlementNetwork: "solana",
    providerFeeBps: 150, // 1.50%
    platformFeeBps: 50, // 0.50%
    now,
  });

  assert.equal(quoteUsdc.forcedDoubleUsdConversion, false);
  assert.equal(quoteUsdc.routingMode, "PRICING_TO_PRESENTMENT_TO_SETTLEMENT");
  assert.equal(quoteUsdc.pricing.currency, "JPY");
  assert.equal(quoteUsdc.pricing.exponent, 0);
  assert.equal(quoteUsdc.pricing.amountMinor, "15500");

  // Presentment leg (KES via M-Pesa mobile wallet)
  assert.equal(quoteUsdc.tripleEntry.presentment.currency, "KES");
  assert.equal(quoteUsdc.tripleEntry.presentment.assetClass, "mobile-wallet");
  assert.equal(quoteUsdc.tripleEntry.presentment.exponent, 2);
  assert.ok(BigInt(quoteUsdc.tripleEntry.presentment.amountMinor) > 1_280_000n); // ~12,925.80 KES in minor units

  // Settlement leg (USDC on Solana)
  assert.equal(quoteUsdc.tripleEntry.settlement.currency, "USDC");
  assert.equal(quoteUsdc.tripleEntry.settlement.assetClass, "stablecoin");
  assert.equal(quoteUsdc.tripleEntry.settlement.network, "solana");
  assert.ok(BigInt(quoteUsdc.tripleEntry.settlement.netMinor) > 9_500n); // ~$97.95 USDC

  // System Base Currency (USD) recorded simultaneously
  assert.equal(quoteUsdc.tripleEntry.systemBase.currency, "USD");
  assert.ok(BigInt(quoteUsdc.tripleEntry.systemBase.presentmentUsdMinor) >= 9_900n);

  // Verify hops are direct (JPY -> KES, KES -> USDC) without routing through USD twice
  assert.deepEqual(
    quoteUsdc.hops.map((h) => `${h.from}->${h.to}`),
    ["JPY->KES", "KES->USDC"],
  );

  // Same flow settling directly into a local Euro (EUR) bank account
  const quoteEur = createSpliceQuote({
    pricingCurrency: "JPY",
    pricingAmountMinor: 15_500n,
    presentmentCurrency: "KES",
    presentmentRail: "MPESA",
    settlementCurrency: "EUR",
    providerFeeBps: 100,
    platformFeeBps: 25,
    now,
  });
  assert.equal(quoteEur.tripleEntry.settlement.currency, "EUR");
  assert.deepEqual(
    quoteEur.hops.map((h) => `${h.from}->${h.to}`),
    ["JPY->KES", "KES->EUR"],
  );
});

test("Pillar 1: Triple-Entry Ledger postings balance across presentment, conversion-clearing, settlement, and platform accrual", () => {
  const now = new Date("2026-10-24T09:00:00.000Z");
  const quote = createSpliceQuote({
    presentmentCurrency: "NGN",
    presentmentAmountMinor: 160_000_00n, // 160,000.00 NGN (~$100 USD)
    settlementCurrency: "USDC",
    settlementNetwork: "base",
    providerFeeBps: 100,
    platformFeeBps: 50,
    now,
  });

  const legs = buildSplicedPostings(quote);
  assert.ok(legs.presentmentLeg, "cross-currency splice must emit a presentment clearing leg");
  assert.equal(legs.presentmentLeg.asset, "NGN");
  validatePostings(legs.presentmentLeg.lines);

  assert.equal(legs.settlementLeg.asset, "USDC");
  validatePostings(legs.settlementLeg.lines);

  assert.ok(legs.platformAccrualLeg, "platform fee > 0 must emit an accrual leg");
  assert.equal(legs.platformAccrualLeg.asset, "USDC");
  validatePostings(legs.platformAccrualLeg.lines);

  // Verify lossless Triple-Entry purpose encoding and decoding
  const encoded = encodeTripleEntryPurpose("Spliced merchant settlement", quote);
  const decoded = decodeTripleEntryPurpose(encoded);
  assert.ok(decoded);
  assert.equal(decoded.quoteId, quote.quoteId);
  assert.equal(decoded.presentment, "16000000 NGN");
  assert.match(decoded.settlement, /^\d+ USDC$/);
  assert.equal(decoded.systemBaseUsd, "10000 USD");

  // Expired rate book fails closed
  const expiredBook = buildDefaultRateBook(new Date("2026-10-24T08:00:00.000Z"), 60_000);
  assert.throws(
    () =>
      createSpliceQuote({
        presentmentCurrency: "NGN",
        presentmentAmountMinor: 160_000_00n,
        settlementCurrency: "USDC",
        rateBook: expiredBook,
        now,
      }),
    /FX_RATE_EXPIRED/,
  );
});

test("Pillar 3: Localization-as-a-Service Checkout prioritizes regional payment rails by buyer country", () => {
  const allMethods = [
    { method: "card", status: "AVAILABLE" },
    { method: "bank-transfer", status: "AVAILABLE" },
    { method: "direct-debit", status: "AVAILABLE" },
    { method: "digital-wallet", status: "AVAILABLE" },
    { method: "mobile-money", status: "AVAILABLE" },
    { method: "ussd", status: "AVAILABLE" },
    { method: "bnpl", status: "AVAILABLE" },
  ];

  // Germany (DE): SEPA Direct Debit and Giropay (bank-transfer) must be prioritized first
  const deMethods = localizeCheckoutMethods(allMethods, { payerCountry: "DE", currency: "EUR" });
  assert.equal(deMethods[0]!.method, "direct-debit");
  assert.equal(deMethods[0]!.recommended, true);
  assert.match(deMethods[0]!.localizedLabel, /SEPA/);
  assert.equal(deMethods[1]!.method, "bank-transfer");
  assert.match(deMethods[1]!.localizedLabel, /Giropay/);

  // Indonesia (ID): QRIS & local e-wallets (GoPay, OVO) must be prioritized first
  const idMethods = localizeCheckoutMethods(allMethods, { payerCountry: "ID", currency: "IDR" });
  assert.equal(idMethods[0]!.method, "digital-wallet");
  assert.match(idMethods[0]!.localizedLabel, /QRIS.*GoPay.*OVO/);
  assert.deepEqual(idMethods[0]!.badges, ["QRIS", "GoPay", "OVO"]);
  assert.equal(idMethods[1]!.method, "bank-transfer");

  // United States (US): Apple Pay & Google Pay (digital-wallet) and Credit/Debit cards first
  const usMethods = localizeCheckoutMethods(allMethods, { payerCountry: "US", currency: "USD" });
  assert.equal(usMethods[0]!.method, "digital-wallet");
  assert.match(usMethods[0]!.localizedLabel, /Apple Pay & Google Pay/);
  assert.equal(usMethods[1]!.method, "card");

  // Nigeria (NG): NIBSS Instant Bank Transfer and USSD first
  const ngMethods = localizeCheckoutMethods(allMethods, { payerCountry: "NG", currency: "NGN" });
  assert.equal(ngMethods[0]!.method, "bank-transfer");
  assert.match(ngMethods[0]!.localizedLabel, /NIBSS/);
  assert.equal(ngMethods[1]!.method, "ussd");

  // Kenya (KE): M-Pesa Mobile Money first
  const keMethods = localizeCheckoutMethods(allMethods, { payerCountry: "KE", currency: "KES" });
  assert.equal(keMethods[0]!.method, "mobile-money");
  assert.match(keMethods[0]!.localizedLabel, /M-Pesa/);

  // Brazil (BR): Pix Instant Payment first
  const brMethods = localizeCheckoutMethods(allMethods, { payerCountry: "BR", currency: "BRL" });
  assert.equal(brMethods[0]!.method, "bank-transfer");
  assert.match(brMethods[0]!.localizedLabel, /Pix/);
});

test("Pillar 3: Global Tax & Compliance Engine calculates EU VAT, B2B Reverse Charge, US State Sales Tax, Canada GST/QST, and RoW VAT", () => {
  // 1. Germany B2C SaaS checkout: 19% German MwSt under EU OSS
  const deB2c = calculateCheckoutTax({
    amountMinor: 10_000n, // €100.00
    currency: "EUR",
    buyerAddress: { country: "DE", postalCode: "10115" },
    sellerCountry: "IE",
    productCategory: "saas",
    taxBehavior: "exclusive",
  });
  assert.equal(deB2c.effectiveRateBps, 1900);
  assert.equal(deB2c.taxMinor, "1900");
  assert.equal(deB2c.totalMinor, "11900");
  assert.equal(deB2c.reverseCharge, false);
  assert.equal(deB2c.filingRegime, "EU_OSS_VAT");

  // 2. Germany B2B cross-border with valid VIES VAT ID -> 0% Reverse Charge (Article 196)
  assert.equal(validateBusinessTaxId("DE", "DE123456789").valid, true);
  const deB2bReverse = calculateCheckoutTax({
    amountMinor: 10_000n,
    currency: "EUR",
    buyerAddress: { country: "DE" },
    sellerCountry: "IE",
    productCategory: "saas",
    buyerTaxId: "DE 123456789",
  });
  assert.equal(deB2bReverse.effectiveRateBps, 0);
  assert.equal(deB2bReverse.taxMinor, "0");
  assert.equal(deB2bReverse.reverseCharge, true);
  assert.equal(deB2bReverse.exemptionReason, "B2B_REVERSE_CHARGE");
  assert.match(deB2bReverse.statutoryNotice ?? "", /Article 196/);

  // 3. US State Sales Tax: NY taxes SaaS (4% state + 4.88% local = 8.88%), CA exempts SaaS but taxes physical goods
  const usNySaas = calculateCheckoutTax({
    amountMinor: 10_000n, // $100.00
    currency: "USD",
    buyerAddress: { country: "US", stateOrProvince: "NY", postalCode: "10001" },
    productCategory: "saas",
  });
  assert.equal(usNySaas.effectiveRateBps, 888);
  assert.equal(usNySaas.taxMinor, "888");
  assert.equal(usNySaas.totalMinor, "10888");
  assert.equal(usNySaas.lineItems.length, 2);

  const usCaSaas = calculateCheckoutTax({
    amountMinor: 10_000n,
    currency: "USD",
    buyerAddress: { country: "US", stateOrProvince: "CA", postalCode: "94105" },
    productCategory: "saas",
  });
  assert.equal(usCaSaas.taxMinor, "0");
  assert.equal(usCaSaas.exemptionReason, "US_SAAS_STATE_EXEMPT");

  const usCaPhysical = calculateCheckoutTax({
    amountMinor: 10_000n,
    currency: "USD",
    buyerAddress: { country: "US", stateOrProvince: "CA", postalCode: "94105" },
    productCategory: "physical",
  });
  assert.equal(usCaPhysical.effectiveRateBps, 885);
  assert.equal(usCaPhysical.taxMinor, "885");

  // 4. Canada Québec multi-component tax (5% GST + 9.98% QST)
  const caQc = calculateCheckoutTax({
    amountMinor: 10_000n,
    currency: "CAD",
    buyerAddress: { country: "CA", stateOrProvince: "QC" },
    productCategory: "saas",
  });
  assert.equal(caQc.lineItems.length, 2);
  assert.equal(caQc.taxMinor, "1498");

  // 5. Nigeria FIRS 7.5% VAT & Japan 10% JCT (tax-inclusive extraction in 0-decimal JPY)
  const ngVat = calculateCheckoutTax({
    amountMinor: 100_000_00n, // 100,000.00 NGN
    currency: "NGN",
    buyerAddress: { country: "NG", stateOrProvince: "Lagos" },
  });
  assert.equal(ngVat.effectiveRateBps, 750);
  assert.equal(ngVat.taxMinor, "750000"); // 7,500.00 NGN
  assert.equal(ngVat.filingRegime, "NG_FIRS_TAXPRO_MAX");

  const jpInclusive = calculateCheckoutTax({
    amountMinor: 11_000n, // ¥11,000 tax-inclusive
    currency: "JPY",
    buyerAddress: { country: "JP" },
    taxBehavior: "inclusive",
  });
  assert.equal(jpInclusive.subtotalMinor, "10000");
  assert.equal(jpInclusive.taxMinor, "1000");
  assert.equal(jpInclusive.totalMinor, "11000");

  // Compliance reporting summary
  const report = buildTaxComplianceReport([deB2c, deB2bReverse, usNySaas, ngVat]);
  assert.equal(report.length, 4);
});

test("Pillar 4: Subscriptions & Exact UTC Millisecond Proration across mid-cycle upgrades", () => {
  const startMs = Date.parse("2026-10-01T00:00:00.000Z");
  const starterPlan = {
    planId: "plan_starter",
    name: "Starter",
    currency: "USD",
    interval: "monthly" as const,
    unitAmountMinor: "10000", // $100.00 / seat
  };
  const enterprisePlan = {
    planId: "plan_enterprise",
    name: "Enterprise",
    currency: "USD",
    interval: "monthly" as const,
    unitAmountMinor: "30000", // $300.00 / seat
  };

  const sub = createSubscription({
    orgId: "org_1",
    customerId: "cust_1",
    customerCountry: "NG",
    plan: starterPlan,
    quantity: 2, // $200.00/mo
    nowMs: startMs,
  });

  assert.equal(sub.state, "Active");
  const totalWindowMs = sub.currentPeriodEndMs - sub.currentPeriodStartMs;
  const midpointMs = sub.currentPeriodStartMs + Math.floor(totalWindowMs / 2);

  // Upgrade at exact midpoint of the month from 2 seats of Starter ($200) to 3 seats of Enterprise ($900)
  const { subscription: updated, proration } = changeSubscriptionPlan(
    sub,
    enterprisePlan,
    3,
    midpointMs,
  );

  assert.equal(updated.plan.planId, "plan_enterprise");
  assert.equal(updated.quantity, 3);
  assert.equal(proration.unusedCreditMinor, "10000"); // $100.00 unused credit
  assert.equal(proration.newChargeMinor, "45000"); // $450.00 remaining half-month charge
  assert.equal(proration.netAdjustmentMinor, "35000"); // $350.00 net due
  assert.equal(proration.formattedNetAdjustment, "350.00");

  // Millisecond precision check: 1 millisecond before period end produces 0 or 1 minor unit, never negative
  const lastMsProration = calculateMillisecondProration({
    currentPlan: starterPlan,
    currentQuantity: 1,
    newPlan: enterprisePlan,
    newQuantity: 1,
    periodStartMs: sub.currentPeriodStartMs,
    periodEndMs: sub.currentPeriodEndMs,
    changeAtMs: sub.currentPeriodEndMs - 1,
  });
  assert.equal(lastMsProration.remainingPeriodMs, 1);
  assert.equal(lastMsProration.netAdjustmentMinor, "0");
});

test("Pillar 4: Timezone-Agnostic Millisecond Usage Metering deduplicates and prices graduated tiers across timezones", () => {
  const meter = new UsageMeterStream();
  const windowStartMs = Date.parse("2026-10-01T00:00:00.000Z");
  const windowEndMs = Date.parse("2026-11-01T00:00:00.000Z");
  const ingestAtMs = Date.parse("2026-10-15T12:05:00.000Z");

  // Events arrive from Tokyo (+09:00), Lagos (+01:00), São Paulo (-03:00), and New York (-04:00)
  const batch = meter.ingestBatch(
    [
      {
        idempotencyKey: "evt_tokyo_1",
        subscriptionId: "sub_global_1",
        metric: "api_tokens",
        quantity: 600,
        occurredAt: "2026-10-15T21:00:00.125+09:00", // 12:00:00.125Z
        region: "ap-northeast-1",
      },
      {
        idempotencyKey: "evt_tokyo_1", // Duplicate retry from edge worker!
        subscriptionId: "sub_global_1",
        metric: "api_tokens",
        quantity: 600,
        occurredAt: "2026-10-15T21:00:00.125+09:00",
        region: "ap-northeast-1",
      },
      {
        idempotencyKey: "evt_lagos_1",
        subscriptionId: "sub_global_1",
        metric: "api_tokens",
        quantity: 900,
        occurredAt: "2026-10-15T13:00:00.500+01:00", // 12:00:00.500Z
        region: "af-south-1",
      },
      {
        idempotencyKey: "evt_saopaulo_1",
        subscriptionId: "sub_global_1",
        metric: "api_tokens",
        quantity: 1200,
        occurredAt: "2026-10-15T09:00:00.999-03:00", // 12:00:00.999Z
        region: "sa-east-1",
      },
    ],
    ingestAtMs,
  );

  assert.equal(batch.accepted, 3);
  assert.equal(batch.duplicatesSkipped, 1);

  // Total raw units = 600 + 900 + 1200 = 2700 units.
  // Included units = 200 -> Billable units = 2500.
  // Graduated tiers:
  //   Tier 0 (0..1000): 1000 units @ 10 cents = 10,000 minor
  //   Tier 1 (1000..null): 1500 units @ 5 cents = 7,500 minor
  //   Total = 17,500 minor ($175.00)
  const summary = meter.aggregateWindow({
    subscriptionId: "sub_global_1",
    metric: "api_tokens",
    windowStartMs,
    windowEndMs,
    pricing: {
      model: "tiered-graduated",
      currency: "USD",
      includedUnits: 200,
      tiers: [
        { upToUnits: 1000, unitPriceMinor: 10 },
        { upToUnits: null, unitPriceMinor: 5 },
      ],
    },
  });

  assert.equal(summary.eventCount, 3);
  assert.equal(summary.deduplicatedCount, 1);
  assert.equal(summary.rawTotalUnits, "2700");
  assert.equal(summary.billableUnits, "2500");
  assert.equal(summary.amountMinor, "17500");
  assert.equal(summary.formattedAmount, "175.00");
  assert.equal(summary.tierBreakdown.length, 2);
});

test("Pillar 4: Global Smart Dunning syncs insufficient_funds retries to regional paydays and cascades transient errors", () => {
  // Failure occurs on October 10, 2026 at 10:00 UTC
  const failedAtMs = Date.parse("2026-10-10T10:00:00.000Z");

  // 1. Nigeria (NG) insufficient_funds -> waits until monthly payday window (Oct 25, 2026 is Sunday -> adjusted to Friday Oct 23, 2026!)
  const ngDecision = scheduleSmartDunning({
    declineCode: "insufficient_funds",
    customerCountry: "NG",
    attemptNumber: 1,
    failedAtMs,
  });
  assert.equal(ngDecision.category, "INSUFFICIENT_FUNDS");
  assert.equal(ngDecision.strategy, "REGIONAL_PAYDAY_SYNC");
  assert.equal(ngDecision.paydaySynced, true);
  assert.equal(ngDecision.paydayCalendarPattern, "MONTHLY_25TH_TO_MONTH_END");
  assert.ok(ngDecision.nextRetryAtUtcIso?.startsWith("2026-10-23T08:00:00"));

  // 2. United States (US) insufficient_funds on Oct 10 -> syncs to semi-monthly 15th payday (Thursday Oct 15, 2026)
  const usDecision = scheduleSmartDunning({
    declineCode: "insufficient_funds",
    customerCountry: "US",
    attemptNumber: 1,
    failedAtMs,
  });
  assert.equal(usDecision.strategy, "REGIONAL_PAYDAY_SYNC");
  assert.equal(usDecision.paydayCalendarPattern, "SEMI_MONTHLY_15TH_AND_MONTH_END");
  assert.ok(usDecision.nextRetryAtUtcIso?.startsWith("2026-10-15T14:00:00"));

  // 3. Transient network timeout -> immediate 30-second exponential backoff + cross-acquirer cascade
  const transientDecision = scheduleSmartDunning({
    declineCode: "network_timeout",
    customerCountry: "DE",
    attemptNumber: 1,
    failedAtMs,
  });
  assert.equal(transientDecision.category, "TRANSIENT_NETWORK");
  assert.equal(transientDecision.strategy, "IMMEDIATE_EXPONENTIAL_CASCADE");
  assert.equal(transientDecision.cascadeToSecondaryAcquirer, true);
  assert.equal(transientDecision.delaySeconds, 30);

  // 4. Hard permanent decline (stolen_card) -> immediate halt, zero retries
  const hardDecision = scheduleSmartDunning({
    declineCode: "stolen_card",
    customerCountry: "GB",
    attemptNumber: 1,
    failedAtMs,
  });
  assert.equal(hardDecision.category, "HARD_PERMANENT_DECLINE");
  assert.equal(hardDecision.shouldRetry, false);
  assert.equal(hardDecision.nextRetryAtMs, null);
  assert.equal(hardDecision.nextSubscriptionState, "PastDueActionRequired");
});

test("Global BNPL Backdoor Switch: maps every continent to its self-serve BNPL switch and Open Banking / Card Scheme backdoor", () => {
  // North America has no BNPL switch since Stripe was removed.
  assert.throws(() => resolveContinentalCreditRoute("US"), /UNSUPPORTED_CREDIT_COUNTRY:US/);

  // 2. Europe (UK, DE, FR, NL, SE): Adyen / Klarna + Tink Open Banking PSD2 Overdraft
  const eu = resolveContinentalCreditRoute("DE");
  assert.equal(eu.continent, "EUROPE");
  assert.equal(eu.platformModuleId, "adyen-klarna-bnpl");
  assert.ok(eu.coreNetworks.includes("Klarna (Pay in 3 / Financing)"));
  assert.match(eu.openBankingOrCardBackdoor, /Tink/);

  // 3. Latin America (BR, MX, CO, AR): Mercado Pago Developers + Belvo Open Finance
  const latam = resolveContinentalCreditRoute("BR");
  assert.equal(latam.continent, "LATIN_AMERICA");
  assert.equal(latam.platformModuleId, "mercadopago-bnpl");
  assert.ok(latam.coreNetworks.includes("Mercado Crédito"));
  assert.match(latam.openBankingOrCardBackdoor, /Belvo/);

  // 4. Africa (NG, KE, GH, ZA): Migo Cloud Lending API + Mono Open Banking Wallet Relay
  const africa = resolveContinentalCreditRoute("NG");
  assert.equal(africa.continent, "AFRICA");
  assert.equal(africa.platformModuleId, "migo-bnpl");
  assert.ok(africa.coreNetworks.includes("Migo Credit"));
  assert.match(africa.openBankingOrCardBackdoor, /Mono/);

  // 5. Asia-Pacific (IN, SG, ID, MY, AU): Xendit BNPL Switch + Setu India UPI Credit Line
  const apac = resolveContinentalCreditRoute("ID");
  assert.equal(apac.continent, "ASIA_PACIFIC");
  assert.equal(apac.platformModuleId, "xendit-bnpl");
  assert.ok(apac.coreNetworks.includes("Kredivo"));
  assert.match(apac.openBankingOrCardBackdoor, /Setu/);
});

test("Global Credit Intent & 4-Stage Asynchronous Disbursal State Machine: blocks merchant fulfillment until lender disburses 100% of principal", () => {
  // Stage 1: [ checkout.initiated ]
  const initiated = createCreditIntent({
    amount: 250000,
    currency: "NGN",
    customer: {
      phone: "+2348031234567",
      bvn_hash: "22113344556",
      country: "NG",
    },
    credit_type: "bnpl",
  });

  assert.equal(initiated.state, "checkout.initiated");
  assert.equal(initiated.principalAmountMinor, "25000000"); // ₦250,000.00 in kobo
  assert.equal(initiated.route.platformModuleId, "migo-bnpl");
  assert.equal(initiated.customer.identityScheme, "BVN_HASH");
  assert.equal(initiated.fulfillmentAllowed, false);
  assert.throws(
    () => assertMerchantFulfillmentAllowed(initiated),
    /FULFILLMENT_BLOCKED_AWAITING_LENDER_DISBURSAL/,
  );

  // Stage 2: [ credit.pending_approval ]
  const pendingApproval = submitCreditForApproval(initiated, {
    offerId: "af-migo-30d",
    lenderApplicationRef: "migo_app_9001",
  });
  assert.equal(pendingApproval.state, "credit.pending_approval");
  assert.equal(pendingApproval.fulfillmentAllowed, false);
  assert.throws(
    () => assertMerchantFulfillmentAllowed(pendingApproval),
    /FULFILLMENT_BLOCKED_AWAITING_LENDER_DISBURSAL/,
  );

  // Partial disbursal from lender is strictly rejected
  assert.throws(
    () =>
      recordLenderDisbursal(pendingApproval, {
        lenderDisbursementRef: "migo_disb_bad",
        disbursedPrincipalMinor: 20_000_000n,
      }),
    /LENDER_PARTIAL_DISBURSAL_REJECTED/,
  );

  // Stage 3: [ credit.disbursed ] (Lender disburses 100% of principal)
  const disbursed = recordLenderDisbursal(pendingApproval, {
    lenderDisbursementRef: "migo_disb_9001",
    disbursedPrincipalMinor: 25_000_000n,
  });
  assert.equal(disbursed.state, "credit.disbursed");
  assert.equal(disbursed.fulfillmentAllowed, false, "still blocked until internal ledger books the settlement");

  // Stage 4: [ payment.succeeded ] (Internal ledger booked -> merchant shipping unlocked!)
  const succeeded = finalizeCreditPaymentSuccess(disbursed);
  assert.equal(succeeded.state, "payment.succeeded");
  assert.equal(succeeded.fulfillmentAllowed, true);
  assert.ok(succeeded.ledgerPostings);
  validatePostings(succeeded.ledgerPostings);

  const clearance = assertMerchantFulfillmentAllowed(succeeded);
  assert.equal(clearance.allowed, true);
  assert.equal(clearance.lenderDisbursementRef, "migo_disb_9001");
  assert.match(clearance.fulfillmentToken, /^ship_/);

  // Verify decline branch reopens fallback checkout
  const declined = recordCreditDecline(pendingApproval, { reason: "credit_score_below_threshold" });
  assert.equal(declined.state, "credit.declined");
  assert.equal(declined.fulfillmentAllowed, false);
  assert.equal(declined.fallbackCheckoutOpen, true);
});

test("Continental BNPL Platform Adapters: Adyen/Klarna, Mercado Pago, Migo, and Xendit quote plans and execute credit checkouts", async () => {
  // 2. Europe (Adyen Klarna + Tink Overdraft)
  const euAdapter = adyenKlarnaBnplPlatform.create(
    { environment: "sandbox", baseUrl: "https://checkout-test.adyen.com", merchantAccount: "PayRoutaEU", apiKeyRef: "k" },
    {
      credentials: { get: async () => "adyen_key_1" },
      http: async () => ({
        status: 200,
        headers: {},
        body: JSON.stringify({
          id: "CS_EU_1",
          url: "https://checkoutshopper-test.adyen.com/checkoutshopper/sessions/CS_EU_1",
          status: "completed",
          accountHolderId: "ah_eu1",
          amount: { value: 15000, currency: "EUR" },
        }),
      }),
    },
  );
  const euOffers = await euAdapter.creditOffers!({ amount: "150.00", precision: 2, currency: "EUR", payerCountry: "DE" });
  assert.ok(euOffers.some((o) => o.id === "eu-klarna-pay3"));
  assert.ok(euOffers.some((o) => o.id === "eu-tink-psd2-overdraft"));

  // 3. LatAm (Mercado Pago + Belvo Open Finance)
  const latamAdapter = mercadopagoBnplPlatform.create(
    { environment: "sandbox", baseUrl: "https://api.mercadopago.com", accessTokenRef: "k" },
    {
      credentials: { get: async () => "APP_USR_test" },
      http: async () => ({
        status: 200,
        headers: {},
        body: JSON.stringify({
          id: "pref_br_1",
          init_point: "https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=pref_br_1",
        }),
      }),
    },
  );
  const latamOffers = await latamAdapter.creditOffers!({ amount: "500.00", precision: 2, currency: "BRL", payerCountry: "BR" });
  assert.ok(latamOffers.some((o) => o.id === "latam-mp-credito-3"));
  assert.ok(latamOffers.some((o) => o.id === "latam-belvo-openfinance"));

  // 4. Africa (Migo Cloud Lending + Mono Open Banking Wallet Relay)
  const migoAdapter = migoBnplPlatform.create(
    { environment: "sandbox", baseUrl: "https://api.migo.money", apiKeyRef: "k" },
    {
      credentials: { get: async () => "migo_test_key" },
      http: async () => ({
        status: 200,
        headers: {},
        body: JSON.stringify({
          applicationId: "migo_app_1",
          approvalUrl: "https://checkout.migo.money/approve/migo_app_1",
          status: "disbursed",
          merchantId: "m_ng_1",
          amountMinor: "25000000",
          currency: "NGN",
        }),
      }),
    },
  );
  const afOffers = await migoAdapter.creditOffers!({ amount: "250000.00", precision: 2, currency: "NGN", payerCountry: "NG" });
  assert.ok(afOffers.some((o) => o.id === "af-migo-30d"));
  assert.ok(afOffers.some((o) => o.id === "af-mono-wallet-relay"));

  // 5. Asia-Pacific (Xendit BNPL Switch + Setu India UPI Credit Line)
  const apacAdapter = xenditBnplPlatform.create(
    { environment: "sandbox", baseUrl: "https://api.xendit.co", secretKeyRef: "k" },
    {
      credentials: { get: async () => "xnd_development_1" },
      http: async () => ({
        status: 200,
        headers: {},
        body: JSON.stringify({
          id: "pl_id_1",
          checkout_url: "https://checkout.xendit.co/paylater/pl_id_1",
        }),
      }),
    },
  );
  const idOffers = await apacAdapter.creditOffers!({ amount: "500000.00", precision: 2, currency: "IDR", payerCountry: "ID" });
  assert.ok(idOffers.some((o) => o.id === "apac-kredivo-akulaku-30d"));
  const inOffers = await apacAdapter.creditOffers!({ amount: "5000.00", precision: 2, currency: "INR", payerCountry: "IN" });
  assert.ok(inOffers.some((o) => o.id === "apac-setu-upi-credit-30d"));
});

test("Marketing Claims, Ops Platform Registry & UI/UX State Consistency", () => {
  // 1. All coverage regions report credit as "testing" (not "planned")
  for (const row of coverage) {
    assert.equal(row.cells.credit, "testing", `Expected ${row.region} credit state to be testing`);
  }

  // 2. Stablecoin settlement from card and bank payments is promoted to "testing"
  const stablePayout = payouts.find((p) => p.destination === "Stablecoins from card and bank payments");
  assert.ok(stablePayout);
  assert.equal(stablePayout.availability, "testing");

  // 3. Credit pillar is promoted to "testing"
  const creditPillar = pillars.find((p) => p.id === "credit");
  assert.ok(creditPillar);
  assert.equal(creditPillar.availability, "testing");

  // 4. All 11 production Ops Treasury platform modules resolve cleanly (including the 4 continental BNPL switches)
  const opsProviderIds = [
    "paystack-split",
    "flutterwave-split",
    "monnify-split",
    "bridge-split",
    "yellowcard-split",
    "dlocal",
    "tink",
    "adyen-klarna-bnpl",
    "mercadopago-bnpl",
    "migo-bnpl",
    "xendit-bnpl",
  ];
  for (const id of opsProviderIds) {
    const mod = platformModule(id);
    assert.equal(mod.manifest.id, id);
    assert.ok(mod.manifest.name.length > 0);
  }
});
