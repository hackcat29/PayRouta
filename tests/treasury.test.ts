import test from "node:test";
import assert from "node:assert/strict";
import { custodyBlocker } from "../lib/treasury/custody";
import { canTransition, permits } from "../lib/treasury/merchant-account";
import { merchantTerms, termsBlockers } from "../lib/treasury/terms";
import { validatePostings } from "../lib/payments/journal";
import { platformFees } from "../lib/treasury/execution";
import { snapshotFees } from "../lib/payments/pricing";
import { maskedSummary, verificationDetailsSchema } from "../lib/treasury/verification";
import { accountNameMatches, paystackReference, paystackSplitPlatform } from "../lib/treasury/platforms/paystack-split";
import { flutterwaveOption, flutterwaveSplitPlatform } from "../lib/treasury/platforms/flutterwave-split";
import { monnifyReference, monnifySplitPlatform } from "../lib/treasury/platforms/monnify-split";
import { bridgeFiatRail, bridgeSnapshot, bridgeSplitPlatform } from "../lib/treasury/platforms/bridge-split";
import { yellowcardSignature, yellowcardSplitPlatform } from "../lib/treasury/platforms/yellowcard-split";
import { dlocalPlatform, dlocalSignature, dlocalSnapshot } from "../lib/treasury/platforms/dlocal";
import { tinkPlatform, tinkRecipient } from "../lib/treasury/platforms/tink";
import { platformModule } from "../lib/treasury/platforms/registry";
import { createHmac } from "node:crypto";
import type { PlatformModule } from "../lib/treasury/platforms/contract";

const terms = {
  reserve: { basisPoints: 1000, holdDays: 90 },
  payout: { schedule: "daily", delayDays: 2 },
  taxMode: "merchant-seller",
  limits: { currency: "USD", maximumMinor: "500000", dailyMaximumMinor: "5000000" },
} as const;

test("custody: platform accounts cover listed merchant countries; PayRouta-held needs a licence", () => {
  const base = { merchantCountries: ["US", "GB"], licensedCountries: [] as string[] };
  assert.equal(custodyBlocker({ ...base, custody: "partner-held", merchantCountry: "US" }), null);
  assert.equal(
    custodyBlocker({ ...base, custody: "partner-held", merchantCountry: "NG" }),
    "PLATFORM_ACCOUNT_COUNTRY_NOT_COVERED",
  );
  assert.equal(
    custodyBlocker({ ...base, custody: "payrouta-held", merchantCountry: "US" }),
    "PAYROUTA_LICENCE_REQUIRED",
  );
  assert.equal(
    custodyBlocker({ ...base, licensedCountries: ["US"], custody: "payrouta-held", merchantCountry: "US" }),
    null,
  );
});

test("merchant account: only reviewed paths, and Closed is final", () => {
  assert.ok(canTransition("Submitted", "Underwriting"));
  assert.ok(canTransition("Underwriting", "Live"));
  assert.ok(canTransition("Restricted", "Live"));
  assert.ok(!canTransition("Submitted", "Live"), "underwriting cannot be skipped");
  assert.ok(!canTransition("Live", "Closed"), "funds must be wound down via Offboarding");
  assert.ok(!canTransition("Returned", "Underwriting"), "a returned merchant resubmits itself");
  for (const to of ["Submitted", "Underwriting", "Live", "Restricted", "Offboarding"] as const)
    assert.ok(!canTransition("Closed", to));
});

test("merchant account: restricted merchants can refund but not take payments or be paid out", () => {
  assert.ok(permits("Live", "pay-in") && permits("Live", "payout"));
  assert.ok(permits("Restricted", "refund"));
  assert.ok(!permits("Restricted", "pay-in") && !permits("Restricted", "payout"));
  assert.ok(permits("Offboarding", "payout") && !permits("Offboarding", "pay-in"));
  assert.ok(!permits("Underwriting", "pay-in") && !permits("Closed", "refund"));
});

test("terms: reserves, limits and tier minimums", () => {
  const parsed = merchantTerms.parse(terms);
  assert.deepEqual(termsBlockers("high", parsed), []);
  assert.deepEqual(
    termsBlockers("high", { ...parsed, reserve: { basisPoints: 500, holdDays: 90 } }),
    ["RESERVE_BELOW_TIER_MINIMUM"],
  );
  assert.deepEqual(termsBlockers("low", { ...parsed, taxMode: "payrouta-mor" }), ["MOR_NOT_AVAILABLE"]);
  assert.equal(merchantTerms.safeParse({ ...terms, reserve: { basisPoints: 1000, holdDays: 0 } }).success, false);
  assert.equal(
    merchantTerms.safeParse({ ...terms, limits: { ...terms.limits, maximumMinor: "9000000" } }).success,
    false,
  );
});

test("journal: merchant-funds accounts balance like any other book", () => {
  validatePostings([
    { account: "funds-clearing", debit: "1000", credit: "0" },
    { account: "merchant-pending", debit: "0", credit: "970" },
    { account: "fee-collected", debit: "0", credit: "30" },
  ]);
  assert.throws(
    () =>
      validatePostings([
        { account: "funds-clearing", debit: "1000", credit: "0" },
        { account: "merchant-pending", debit: "0", credit: "999" },
      ]),
    /UNBALANCED_JOURNAL/,
  );
});

// ---------------------------------------------------------------------------
type Call = { method: string; path: string; headers: Record<string, string>; body?: string };

const details = {
  businessPhone: "+14155550100",
  representative: {
    dateOfBirth: "1985-04-12",
    phone: "+14155550101",
    address: { line1: "1 Market St", city: "San Francisco", region: "CA", postalCode: "94105", country: "US" },
    idNumber: "000000000",
  },
  owners: [
    {
      dateOfBirth: "1979-01-30",
      address: { line1: "2 Market St", city: "San Francisco", region: "CA", postalCode: "94105", country: "US" },
      idNumber: "000000001",
    },
  ],
  payoutAccount: {
    country: "US",
    currency: "USD",
    holderName: "Harbor Inc",
    holderType: "company" as const,
    accountNumber: "000123456789",
    routingNumber: "110000000",
  },
};
const profile = {
  legalName: "Harbor Inc",
  businessType: "company" as const,
  country: "US",
  registrationNumber: "DE-1234567",
  taxId: "000000000",
  website: "https://harbor.example",
  productDescription: "Digital design templates sold as downloads",
  supportEmail: "support@harbor.example",
  address: { line1: "1 Market St", city: "San Francisco", region: "CA", postalCode: "94105", country: "US" },
  representative: { givenName: "Ada", familyName: "Okafor", email: "ada@harbor.example", title: "CEO" },
  owners: [{ givenName: "Bo", familyName: "Chen", country: "US", ownershipPercent: 60 }],
};
const agreement = { acceptedAt: new Date("2026-10-09T10:00:00Z"), ip: "203.0.113.7", userAgent: "Mozilla/5.0" };

test("verification details: validated, and only a masked summary is ever shown", () => {
  const parsed = verificationDetailsSchema.parse(details);
  const summary = maskedSummary(parsed);
  assert.equal(summary.payoutAccount?.accountLast4, "6789");
  assert.equal(summary.representative.idNumberLast4, "0000");
  assert.ok(!JSON.stringify(summary).includes("000123456789"));
  assert.ok(!JSON.stringify(summary).includes("1985"));
  assert.equal(verificationDetailsSchema.safeParse({ ...details, businessPhone: "4155550100" }).success, false);
  assert.equal(
    verificationDetailsSchema.safeParse({ ...details, representative: { ...details.representative, dateOfBirth: "2024-01-01" } }).success,
    false,
  );
});

test("platform fees: 1% plus the partner's standard fee where PayRouta pays the partner", () => {
  const usd = { kind: "fiat", identifier: "USD", network: "" };
  const feeSnapshot = snapshotFees({ orgId: "o", environment: "production", asset: usd, precision: 2 });
  const intent = { feeSnapshot, selectedMethod: "card", amount: "40.00", precision: 2, asset: usd };
  const dlocal = {
    provider: "dlocal",
    config: { standardFees: { card: { bps: 290, fixedMinor: { USD: "30" }, source: "dlocal.com/pricing" } } },
  };
  // 1% of 40.00 = 0.40; a standard 2.9% + 0.30 = 1.46.
  assert.deepEqual(platformFees(intent as never, dlocal), { payroutaMinor: 40n, partnerMinor: 146n, totalMinor: 186n });
  // Paystack takes its own fee from the merchant's share: only PayRouta's 1% is withheld.
  assert.deepEqual(platformFees(intent as never, { provider: "paystack-split", config: {} }), {
    payroutaMinor: 40n,
    partnerMinor: 0n,
    totalMinor: 40n,
  });
  assert.throws(() => platformFees(intent as never, { provider: "dlocal", config: {} }), /PARTNER_STANDARD_FEE_REQUIRED/);
  const sandbox = snapshotFees({ orgId: "o", environment: "sandbox", asset: usd, precision: 2 });
  assert.equal(platformFees({ ...intent, feeSnapshot: sandbox } as never, dlocal).totalMinor, 0n);
  assert.throws(
    () => platformFees({ ...intent, asset: { ...usd, identifier: "GBP" } } as never, dlocal),
    /PLATFORM_FEE_CURRENCY_MISMATCH/,
  );
  assert.throws(
    () => platformFees({ ...intent, amount: "0.30" } as never, dlocal),
    /PLATFORM_FEE_EXCEEDS_PAYMENT/,
  );
});

// ---------------------------------------------------------------------------
// Paystack subaccounts (split settlement), against a fake Paystack transport.
function fakePaystack(routes: Record<string, unknown>, key = "sk_test_123") {
  const calls: Call[] = [];
  const adapter = paystackSplitPlatform.create(
    { environment: "sandbox", secretKeyRef: "ref" },
    {
      credentials: { get: async () => key },
      http: async (_base, o) => {
        calls.push({ method: o.method, path: o.path, headers: o.headers as Record<string, string>, body: o.body as string | undefined });
        const hit = Object.entries(routes).find(([p]) => `${o.method} ${o.path}`.startsWith(p));
        return hit
          ? { status: 200, headers: {}, body: JSON.stringify({ status: true, data: hit[1] }) }
          : { status: 404, headers: {}, body: "{}" };
      },
    },
  );
  return { adapter, calls };
}
const ngProfile = { ...profile, legalName: "Adaeze Foods Limited", tradingName: "Adaeze Foods", country: "NG", owners: [] };
const ngDetails = {
  ...details,
  businessPhone: "+2348012345678",
  owners: [],
  payoutAccount: { country: "NG", currency: "NGN", holderName: "Adaeze Foods Limited", holderType: "company" as const, accountNumber: "0123456789", routingNumber: "058" },
};

test("paystack split: subaccount only after the bank confirms the account is the merchant's", async () => {
  const ok = fakePaystack({
    "GET /bank/resolve": { account_name: "ADAEZE FOODS LTD" },
    "POST /subaccount": { subaccount_code: "ACCT_abc123", active: true },
  });
  const created = await ok.adapter.createAccount({ linkId: "l1", environment: "sandbox", profile: ngProfile, details: ngDetails, agreement });
  assert.equal(created.providerAccountId, "ACCT_abc123");
  assert.equal(created.snapshot.state, "Approved");
  const body = JSON.parse(ok.calls[1].body!);
  assert.equal(body.settlement_bank, "058");
  assert.equal(body.account_number, "0123456789");
  assert.equal(body.percentage_charge, 0, "PayRouta's share is set per payment");
  assert.equal(body.business_name, "Adaeze Foods");

  const someoneElse = fakePaystack({ "GET /bank/resolve": { account_name: "JOHN DOE" } });
  await assert.rejects(
    someoneElse.adapter.createAccount({ linkId: "l2", environment: "sandbox", profile: ngProfile, details: ngDetails, agreement }),
    /PAYOUT_ACCOUNT_NAME_MISMATCH/,
  );
  assert.equal(someoneElse.calls.length, 1, "no subaccount is created");
  await assert.rejects(
    ok.adapter.createAccount({
      linkId: "l3",
      environment: "sandbox",
      profile: ngProfile,
      details: { ...ngDetails, payoutAccount: { ...ngDetails.payoutAccount, currency: "USD" } },
      agreement,
    }),
    /PAYOUT_ACCOUNT_NOT_SUPPORTED/,
  );
  assert.ok(accountNameMatches("Adaeze Foods Limited", "ADAEZE FOODS LTD"));
  assert.ok(!accountNameMatches("Adaeze Foods Limited", "ADAEZE MOTORS"));
});

test("paystack split: PayRouta's fee as the transaction charge; the merchant bears Paystack's fee", async () => {
  const { adapter, calls } = fakePaystack({
    "POST /transaction/initialize": { authorization_url: "https://checkout.paystack.com/abc", reference: "x" },
  });
  const input = {
    providerAccountId: "ACCT_abc123",
    attemptKey: "attempt:7f1c",
    amount: "5000.00",
    precision: 2,
    currency: "NGN",
    method: "bank-transfer" as const,
    feeMinor: 2500n,
    reference: "order-1",
    returnUrl: "https://payrouta.example/checkout/s?returned=1",
    cancelUrl: "https://payrouta.example/checkout/s",
    payerEmail: "buyer@example.com",
  };
  const r = await adapter.createPayment(input);
  assert.equal(r.state, "Requires action");
  assert.equal(r.reference, "attempt-7f1c");
  const body = JSON.parse(calls[0].body!);
  assert.equal(body.subaccount, "ACCT_abc123");
  assert.equal(body.transaction_charge, 2500);
  assert.equal(body.bearer, "subaccount");
  assert.deepEqual(body.channels, ["bank_transfer"]);
  assert.equal(body.amount, "500000");
  await assert.rejects(adapter.createPayment({ ...input, payerEmail: undefined }), /PROVIDER_CUSTOMER_DETAILS_REQUIRED/);
  assert.equal(paystackReference("attempt:a/b"), "attempt-a-b");
});

test("paystack split: verification checks the subaccount and reads the merchant's settled share", async () => {
  const txn = (sub: string) => ({
    id: 42,
    status: "success",
    amount: 500000,
    currency: "NGN",
    paid_at: "2026-10-09T10:00:00.000Z",
    subaccount: { subaccount_code: sub },
    fees_split: { paystack: 7500, integration: 2500, subaccount: 490000 },
  });
  const ok = fakePaystack({ "GET /transaction/verify/attempt-1": txn("ACCT_abc123") });
  assert.equal((await ok.adapter.paymentStatus({ reference: "attempt-1", providerAccountId: "ACCT_abc123" }))?.state, "Confirmed");
  assert.deepEqual(await ok.adapter.fundsAvailability({ reference: "attempt-1", providerAccountId: "ACCT_abc123", feeMinor: 2500n }), {
    paymentRef: "42",
    netMinor: 490000n,
    availableAt: new Date("2026-10-10T10:00:00.000Z"),
  });
  const other = fakePaystack({ "GET /transaction/verify/attempt-1": txn("ACCT_other1") });
  await assert.rejects(
    other.adapter.paymentStatus({ reference: "attempt-1", providerAccountId: "ACCT_abc123" }),
    /PLATFORM_DESTINATION_MISMATCH/,
  );
  const live = fakePaystack({}, "sk_live_1");
  await assert.rejects(live.adapter.accountStatus("ACCT_abc123"), /PAYSTACK_KEY_ENVIRONMENT_MISMATCH/);
});

// ---------------------------------------------------------------------------
// Shared fake transport for the remaining platform modules.
function fake(mod: PlatformModule, config: Record<string, unknown>, keys: Record<string, string>, routes: Record<string, unknown>) {
  const calls: Call[] = [];
  const adapter = mod.create(mod.configSchema.parse(config), {
    credentials: { get: async (ref) => keys[ref] ?? "" },
    now: () => new Date("2026-10-09T12:00:00.000Z"),
    http: async (_base, o) => {
      calls.push({ method: o.method, path: o.path, headers: o.headers as Record<string, string>, body: o.body as string | undefined });
      const hit = Object.entries(routes).find(([p]) => `${o.method} ${o.path}`.startsWith(p));
      return hit ? { status: 200, headers: {}, body: JSON.stringify(hit[1]) } : { status: 404, headers: {}, body: "{}" };
    },
  });
  return { adapter, calls };
}

test("platform registry: every module's custody, funds and fee rules are consistent", () => {
  for (const id of [
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
  ]) {
    const m = platformModule(id).manifest;
    assert.equal(m.holdsFunds, m.custody === "partner-held", `${id}: only partner-held rails hold funds`);
    if (m.feeCollection === "invoice") assert.equal(m.holdsFunds, false, `${id}: invoiced fees mean the merchant was paid in full`);
    assert.ok(m.methods.length > 0);
  }
});

const fw = (routes: Record<string, unknown>, key = "FLWSECK_TEST-abc") =>
  fake(flutterwaveSplitPlatform, { environment: "sandbox", secretKeyRef: "s" }, { s: key }, routes);
const wrap = (data: unknown) => ({ status: "success", data });

test("flutterwave split: name-checked subaccount, flat PayRouta charge, estimated share", async () => {
  const ok = fw({
    "POST /v3/accounts/resolve": wrap({ account_name: "ADAEZE FOODS LIMITED" }),
    "POST /v3/subaccounts": wrap({ subaccount_id: "RS_A1B2C3D4", id: 77 }),
  });
  const created = await ok.adapter.createAccount({ linkId: "l1", environment: "sandbox", profile: ngProfile, details: ngDetails, agreement });
  assert.equal(created.providerAccountId, "RS_A1B2C3D4");
  const sub = JSON.parse(ok.calls[1].body!);
  assert.equal(sub.account_bank, "058");
  assert.equal(sub.split_type, "flat");
  assert.equal(sub.split_value, 0);

  const pay = fw({ "POST /v3/payments": wrap({ link: "https://checkout.flutterwave.com/v3/hosted/pay/x" }) });
  const r = await pay.adapter.createPayment({
    providerAccountId: "RS_A1B2C3D4",
    attemptKey: "attempt:9",
    amount: "5000.00",
    precision: 2,
    currency: "NGN",
    method: "card",
    feeMinor: 2500n,
    reference: "order-1",
    returnUrl: "https://payrouta.example/r",
    cancelUrl: "https://payrouta.example/c",
    payerEmail: "buyer@example.com",
  });
  assert.equal(r.reference, "attempt-9");
  const body = JSON.parse(pay.calls[0].body!);
  assert.equal(body.amount, 5000, "major units");
  assert.deepEqual(body.subaccounts, [{ id: "RS_A1B2C3D4", transaction_charge_type: "flat", transaction_charge: 25 }]);
  assert.equal(body.payment_options, "card");
  assert.equal(flutterwaveOption("mobile-money", "KES"), "mpesa");
  assert.equal(flutterwaveOption("ussd", "GHS"), undefined);

  const verified = fw({
    "GET /v3/transactions/verify_by_reference": wrap({
      id: 3091255, status: "successful", amount: 5000, currency: "NGN", app_fee: 75.5, created_at: "2026-10-09T10:00:00.000Z",
      meta: { payrouta_subaccount: "RS_A1B2C3D4" },
    }),
  });
  assert.equal((await verified.adapter.paymentStatus({ reference: "attempt-9", providerAccountId: "RS_A1B2C3D4" }))?.state, "Confirmed");
  const funds = await verified.adapter.fundsAvailability({ reference: "attempt-9", providerAccountId: "RS_A1B2C3D4", feeMinor: 2500n });
  assert.equal(funds?.netMinor, 500000n - 2500n - 7550n);
  await assert.rejects(
    verified.adapter.paymentStatus({ reference: "attempt-9", providerAccountId: "RS_OTHER123" }),
    /PLATFORM_DESTINATION_MISMATCH/,
  );
  const live = fw({}, "FLWSECK-live");
  await assert.rejects(live.adapter.createPayment({ providerAccountId: "RS_A1B2C3D4", attemptKey: "a", amount: "1.00", precision: 2, currency: "NGN", method: "card", feeMinor: 0n, reference: "r", returnUrl: "https://x.example", cancelUrl: "https://x.example", payerEmail: "b@example.com" }), /FLUTTERWAVE_KEY_ENVIRONMENT_MISMATCH/);
});

const mfyWrap = (responseBody: unknown) => ({ requestSuccessful: true, responseBody });
const mfy = (routes: Record<string, unknown>, apiKey = "MK_TEST_abc123", secretKey = "sec_test_xyz") =>
  fake(
    monnifySplitPlatform,
    { environment: "sandbox", apiKeyRef: "k", secretKeyRef: "s", contractCode: "1000200030" },
    { k: apiKey, s: secretKey },
    { "POST /api/v1/auth/login": mfyWrap({ accessToken: "mfy_tok_1" }), ...routes },
  );

test("monnify split: NIBSS name-checked subaccount, incomeSplitConfig with subaccount fee bearer, and availability", async () => {
  const ok = mfy({
    "GET /api/v2/disbursements/account/validate": mfyWrap({ accountNumber: "0123456789", accountName: "ADAEZE FOODS LIMITED", bankCode: "058" }),
    "POST /api/v1/sub-accounts": mfyWrap([{ subAccountCode: "MFY_SUB_319452883968", accountNumber: "0123456789" }]),
    "GET /api/v1/sub-accounts": mfyWrap([{ subAccountCode: "MFY_SUB_319452883968" }]),
  });
  const created = await ok.adapter.createAccount({ linkId: "l1", environment: "sandbox", profile: ngProfile, details: ngDetails, agreement });
  assert.equal(created.providerAccountId, "MFY_SUB_319452883968");
  assert.equal(created.snapshot.state, "Approved");
  const subBody = JSON.parse(ok.calls[3].body!);
  assert.deepEqual(subBody, [
    {
      currencyCode: "NGN",
      bankCode: "058",
      accountNumber: "0123456789",
      email: "support@harbor.example",
      defaultSplitPercentage: 99,
    },
  ]);
  assert.equal((await ok.adapter.accountStatus("MFY_SUB_319452883968")).state, "Approved");

  const mismatch = mfy({
    "GET /api/v2/disbursements/account/validate": mfyWrap({ accountNumber: "0123456789", accountName: "OTHER COMPANY LTD", bankCode: "058" }),
  });
  await assert.rejects(
    mismatch.adapter.createAccount({ linkId: "l2", environment: "sandbox", profile: ngProfile, details: ngDetails, agreement }),
    /PAYOUT_ACCOUNT_NAME_MISMATCH/,
  );

  const pay = mfy({
    "POST /api/v1/merchant/transactions/init-transaction": mfyWrap({
      transactionReference: "MNFY|20261024|000001",
      paymentReference: "attempt-11",
      checkoutUrl: "https://sandbox.sdk.monnify.com/checkout/MNFY123",
    }),
  });
  const r = await pay.adapter.createPayment({
    providerAccountId: "MFY_SUB_319452883968",
    attemptKey: "attempt:11",
    amount: "5000.00",
    precision: 2,
    currency: "NGN",
    method: "bank-transfer",
    feeMinor: 2500n,
    reference: "order-11",
    returnUrl: "https://payrouta.example/r",
    cancelUrl: "https://payrouta.example/c",
    payerEmail: "buyer@example.com",
  });
  assert.equal(r.state, "Requires action");
  assert.equal(r.reference, "attempt-11");
  assert.equal(r.actionUrl, "https://sandbox.sdk.monnify.com/checkout/MNFY123");
  const initBody = JSON.parse(pay.calls[1].body!);
  assert.equal(initBody.amount, 5000);
  assert.equal(initBody.contractCode, "1000200030");
  assert.deepEqual(initBody.paymentMethods, ["ACCOUNT_TRANSFER"]);
  assert.deepEqual(initBody.incomeSplitConfig, [
    {
      subAccountCode: "MFY_SUB_319452883968",
      splitAmount: 4975,
      feePercentage: 100,
      feeBearer: true,
    },
  ]);
  assert.equal(monnifyReference("attempt:a/b"), "attempt-a-b");

  const verified = mfy({
    "GET /api/v2/merchant/transactions/query": mfyWrap({
      transactionReference: "MNFY|20261024|000001",
      paymentReference: "attempt-11",
      amountPaid: "5000.00",
      totalPayable: "5000.00",
      fee: "75.00",
      currency: "NGN",
      paymentStatus: "PAID",
      paidOn: "2026-10-09T10:00:00.000Z",
      metaData: { payrouta_subaccount: "MFY_SUB_319452883968" },
      incomeSplitConfig: [{ subAccountCode: "MFY_SUB_319452883968", splitAmount: 4975 }],
    }),
  });
  assert.equal((await verified.adapter.paymentStatus({ reference: "attempt-11", providerAccountId: "MFY_SUB_319452883968" }))?.state, "Confirmed");
  const funds = await verified.adapter.fundsAvailability({ reference: "attempt-11", providerAccountId: "MFY_SUB_319452883968", feeMinor: 2500n });
  assert.deepEqual(funds, {
    paymentRef: "MNFY|20261024|000001",
    netMinor: 500000n - 2500n - 7500n,
    availableAt: new Date("2026-10-10T10:00:00.000Z"),
  });
  await assert.rejects(
    verified.adapter.paymentStatus({ reference: "attempt-11", providerAccountId: "MFY_SUB_999999999999" }),
    /PLATFORM_DESTINATION_MISMATCH/,
  );
  const live = mfy({}, "MK_PROD_live");
  await assert.rejects(live.adapter.accountStatus("MFY_SUB_319452883968"), /MONNIFY_KEY_ENVIRONMENT_MISMATCH/);
});

const br = (routes: Record<string, unknown>, apiKey = "sk-test-bridge123", webhookSecret = "whsec_bridge") =>
  fake(
    bridgeSplitPlatform,
    { environment: "sandbox", apiKeyRef: "k", webhookSecretRef: "w" },
    { k: apiKey, w: webhookSecret },
    routes,
  );

test("bridge split: stablecoin-to-fiat customer + external bank account onboarding, USDC/fiat liquidation transfer, and availability", async () => {
  const ok = br({
    "POST /v0/customers/cust_bridge_1/external_accounts": { id: "ext_bank_1", currency: "usd" },
    "POST /v0/customers": { id: "cust_bridge_1", status: "active" },
    "GET /v0/customers/cust_bridge_1": { id: "cust_bridge_1", status: "active" },
  });
  const created = await ok.adapter.createAccount({ linkId: "l1", environment: "sandbox", profile, details, agreement });
  assert.equal(created.providerAccountId, "cust_bridge_1:ext_bank_1");
  assert.equal(created.snapshot.state, "Approved");
  assert.equal(ok.calls[0].headers["Idempotency-Key"], "payrouta-bridge-customer-l1");
  assert.equal(ok.calls[1].headers["Idempotency-Key"], "payrouta-bridge-ext-l1");
  const custBody = JSON.parse(ok.calls[0].body!);
  assert.equal(custBody.business_name, "Harbor Inc");
  assert.equal(custBody.type, "business");
  assert.equal((await ok.adapter.accountStatus("cust_bridge_1:ext_bank_1")).state, "Approved");
  assert.equal(bridgeSnapshot({ status: "incomplete" }, "cust_bridge_1:ext_bank_1").state, "Action required");
  assert.equal(bridgeFiatRail("EUR"), "sepa");

  const pay = br({
    "POST /v0/transfers": {
      id: "tx_bridge_99",
      state: "awaiting_funds",
      hosted_url: "https://sandbox.checkout.bridge.xyz/pay/tx_bridge_99",
    },
  });
  const r = await pay.adapter.createPayment({
    providerAccountId: "cust_bridge_1:ext_bank_1",
    attemptKey: "attempt:b1",
    amount: "100.00",
    precision: 2,
    currency: "USD",
    method: "digital-wallet",
    feeMinor: 100n,
    reference: "order-b1",
    returnUrl: "https://payrouta.example/r",
    cancelUrl: "https://payrouta.example/c",
  });
  assert.deepEqual(r, {
    state: "Requires action",
    reference: "tx_bridge_99",
    actionUrl: "https://sandbox.checkout.bridge.xyz/pay/tx_bridge_99",
  });
  const txBody = JSON.parse(pay.calls[0].body!);
  assert.equal(txBody.on_behalf_of, "cust_bridge_1");
  assert.equal(txBody.developer_fee, "1.00");
  assert.deepEqual(txBody.source, { payment_rail: "base", currency: "usdc" });
  assert.deepEqual(txBody.destination, { payment_rail: "ach", currency: "usd", external_account_id: "ext_bank_1" });

  const verified = br({
    "GET /v0/transfers/tx_bridge_99": {
      id: "tx_bridge_99",
      state: "payment_processed",
      amount: "100.00",
      on_behalf_of: "cust_bridge_1",
      destination: { currency: "usd", external_account_id: "ext_bank_1" },
      receipt: { final_amount: "98.50", exchange_fee: "0.50", gas_fee: "0.00" },
      updated_at: "2026-10-09T10:00:00.000Z",
    },
  });
  assert.equal((await verified.adapter.paymentStatus({ reference: "tx_bridge_99", providerAccountId: "cust_bridge_1:ext_bank_1" }))?.state, "Confirmed");
  const funds = await verified.adapter.fundsAvailability({ reference: "tx_bridge_99", providerAccountId: "cust_bridge_1:ext_bank_1", feeMinor: 100n });
  assert.deepEqual(funds, {
    paymentRef: "tx_bridge_99",
    netMinor: 9850n,
    availableAt: new Date("2026-10-10T10:00:00.000Z"),
  });
  await assert.rejects(
    verified.adapter.paymentStatus({ reference: "tx_bridge_99", providerAccountId: "cust_other:ext_bank_1" }),
    /PLATFORM_DESTINATION_MISMATCH/,
  );
  const live = br({}, "sk-live-bridge");
  await assert.rejects(live.adapter.accountStatus("cust_bridge_1:ext_bank_1"), /BRIDGE_KEY_ENVIRONMENT_MISMATCH/);
});

const yc = (routes: Record<string, unknown>, apiKey = "yc_test_key1", secretKey = "yc_sec_1") =>
  fake(
    yellowcardSplitPlatform,
    { environment: "sandbox", apiKeyRef: "k", secretKeyRef: "s" },
    { k: apiKey, s: secretKey },
    routes,
  );

test("yellowcard split: YcHmacV1 signed requests, bank-verified subaccount, USDC-backed African fiat settlement", async () => {
  const ok = yc({
    "POST /business/details/bank": { accountName: "ADAEZE FOODS LIMITED", accountNumber: "0123456789" },
    "POST /business/subaccounts": { id: "yc_sub_ng001", status: "active" },
    "GET /business/subaccounts/yc_sub_ng001": { id: "yc_sub_ng001", status: "active" },
  });
  const created = await ok.adapter.createAccount({ linkId: "l1", environment: "sandbox", profile: ngProfile, details: ngDetails, agreement });
  assert.equal(created.providerAccountId, "yc_sub_ng001");
  assert.equal(created.snapshot.state, "Approved");
  const h = ok.calls[0].headers;
  assert.equal(h["X-YC-Timestamp"], "2026-10-09T12:00:00.000Z");
  assert.equal(
    h.Authorization,
    `YcHmacV1 yc_test_key1:${yellowcardSignature("yc_sec_1", h["X-YC-Timestamp"], "/business/details/bank", "POST", ok.calls[0].body)}`,
  );
  const subBody = JSON.parse(ok.calls[1].body!);
  assert.equal(subBody.settlementAsset, "USDC");
  assert.equal(subBody.payoutAccount.accountNumber, "0123456789");

  const pay = yc({
    "POST /business/collections": {
      id: "yc_col_1",
      sequenceId: "attempt-yc1",
      checkoutUrl: "https://sandbox.widget.yellowcard.io/pay/yc_col_1",
    },
  });
  const r = await pay.adapter.createPayment({
    providerAccountId: "yc_sub_ng001",
    attemptKey: "attempt:yc1",
    amount: "5000.00",
    precision: 2,
    currency: "NGN",
    method: "bank-transfer",
    feeMinor: 2500n,
    reference: "order-yc1",
    payerCountry: "NG",
    merchantCountry: "NG",
    returnUrl: "https://payrouta.example/r",
    cancelUrl: "https://payrouta.example/c",
  });
  assert.equal(r.state, "Requires action");
  assert.equal(r.reference, "attempt-yc1");
  const colBody = JSON.parse(pay.calls[0].body!);
  assert.equal(colBody.subaccountId, "yc_sub_ng001");
  assert.equal(colBody.feeAmount, 25);
  assert.equal(colBody.settlementAsset, "USDC");

  const verified = yc({
    "GET /business/collections/reference/attempt-yc1": {
      id: "yc_col_1",
      sequenceId: "attempt-yc1",
      subaccountId: "yc_sub_ng001",
      amount: 5000,
      serviceFeeAmount: 50,
      currency: "NGN",
      status: "complete",
      updatedAt: "2026-10-09T10:00:00.000Z",
    },
  });
  assert.equal((await verified.adapter.paymentStatus({ reference: "attempt-yc1", providerAccountId: "yc_sub_ng001" }))?.state, "Confirmed");
  const funds = await verified.adapter.fundsAvailability({ reference: "attempt-yc1", providerAccountId: "yc_sub_ng001", feeMinor: 2500n });
  assert.deepEqual(funds, {
    paymentRef: "yc_col_1",
    netMinor: 500000n - 2500n - 5000n,
    availableAt: new Date("2026-10-10T10:00:00.000Z"),
  });
  await assert.rejects(
    verified.adapter.paymentStatus({ reference: "attempt-yc1", providerAccountId: "yc_sub_other99" }),
    /PLATFORM_DESTINATION_MISMATCH/,
  );
  const live = yc({}, "yc_live_key1");
  await assert.rejects(live.adapter.accountStatus("yc_sub_ng001"), /YELLOWCARD_KEY_ENVIRONMENT_MISMATCH/);
});

const dl = (routes: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  fake(
    dlocalPlatform,
    { environment: "sandbox", platformType: "PAYROUTA", loginRef: "l", transKeyRef: "t", secretKeyRef: "s", redirectHosts: ["pay.dlocal-sbox.com"], ...extra },
    { l: "login1", t: "trans1", s: "secret1" },
    routes,
  );

test("dlocal: signed requests, user account with KYC and consents, split leaves PayRouta's fee", async () => {
  const { adapter, calls } = dl({
    "POST /v2/accounts": { account_id: "d907f733-5e17-4470-b963-c2ac2c11a440", status: "PENDING", status_detail: "compliance_review" },
  });
  const created = await adapter.createAccount({
    linkId: "l1",
    environment: "sandbox",
    profile: { ...profile, country: "BR" },
    details: { ...details, representative: { ...details.representative, nationality: "BR", idType: "national-id", politicallyExposed: false } },
    agreement,
  });
  assert.equal(created.snapshot.state, "Under review");
  const h = calls[0].headers;
  assert.equal(h["X-Date"], "2026-10-09T12:00:00.000Z");
  assert.equal(h.Authorization, `V2-HMAC-SHA256, Signature: ${dlocalSignature("secret1", "login1", h["X-Date"], calls[0].body!)}`);
  const body = JSON.parse(calls[0].body!);
  assert.equal(body.platform_type, "PAYROUTA");
  assert.equal(body.tax_category, "company");
  assert.deepEqual(body.consents.map((c: { type: string }) => c.type), ["DATA_COLLECTION", "TERMS_AND_CONDITIONS", "CONTRACTUAL_EFFECTS", "DECLARATION_OF_FUNDS"]);
  assert.equal(body.company_information.legal_representative.document_type, "NATIONAL_ID");
  assert.equal(body.company_information.legal_representative.is_pep, false);
  assert.equal(body.company_information.ubos[0].ownership_percentage, 60);

  const pay = dl({ "POST /payments": { id: "D-4-abc", status: "PENDING", redirect_url: "https://pay.dlocal-sbox.com/x" } });
  const r = await pay.adapter.createPayment({
    providerAccountId: "d907f733-5e17-4470-b963-c2ac2c11a440",
    attemptKey: "attempt:1",
    amount: "100.00",
    precision: 2,
    currency: "BRL",
    method: "card",
    feeMinor: 150n,
    reference: "order-1",
    returnUrl: "https://payrouta.example/r",
    cancelUrl: "https://payrouta.example/c",
    payerCountry: "BR",
  });
  assert.equal(r.reference, "D-4-abc");
  assert.deepEqual(JSON.parse(pay.calls[0].body!).splits, [{ account_id: "d907f733-5e17-4470-b963-c2ac2c11a440", amount: 98.5 }]);
  // An unconfigured redirect host fails closed.
  const strict = dl({ "POST /payments": { id: "D-4-abc", redirect_url: "https://pay.dlocal-sbox.com/x" } }, { redirectHosts: [] });
  await assert.rejects(
    strict.adapter.createPayment({ providerAccountId: "d907f733-5e17-4470-b963-c2ac2c11a440", attemptKey: "a", amount: "100.00", precision: 2, currency: "BRL", method: "card", feeMinor: 0n, reference: "r", returnUrl: "https://x.example", cancelUrl: "https://x.example", payerCountry: "BR" }),
    /PARTNER_LINK_HOST_NOT_ALLOWED/,
  );
  assert.equal(dlocalSnapshot({ account_id: "x", status: "APPROVED", status_detail: "approved", capabilities: [{ capability_name: "PAYINS", capability_status: "ENABLED" }, { capability_name: "PAYOUTS", capability_status: "ENABLED" }] }).state, "Approved");
  assert.deepEqual(dlocalSnapshot({ status: "PENDING", status_detail: "documentation" }).requirementsDue, ["business-document"]);
  assert.equal(dlocalSnapshot({ status: "BLOCKED", status_detail: "blocked_by_fraud" }).state, "Restricted");
});

const tk = (routes: Record<string, unknown>) =>
  fake(
    tinkPlatform,
    { environment: "sandbox", clientId: "abcdef123456", clientSecretRef: "s", merchantsPath: "/partner/v1/merchants", redirectUri: "https://payrouta.example/tink/callback" },
    { s: "secret" },
    { "POST /api/v1/oauth/token": { access_token: "tok" }, ...routes },
  );

test("tink: pay by bank to the merchant's own account; fee invoiced, never withheld", async () => {
  const { adapter, calls } = tk({ "POST /partner/v1/merchants": { id: "3f2b8c1e-1d2a-4b5c-9e8f-0a1b2c3d4e5f", status: "Approved" } });
  const created = await adapter.createAccount({
    linkId: "l1",
    environment: "sandbox",
    profile: { ...profile, country: "GB", registrationNumber: "12345678" },
    details: { ...details, merchantCategoryCode: "5734" },
    agreement,
  });
  assert.equal(created.snapshot.state, "Approved");
  assert.deepEqual(JSON.parse(calls[1].body!), {
    name: "Harbor Inc", country: "GB", organizationNumber: "12345678", url: "https://harbor.example", categoryCode: "5734", externalId: "l1",
  });
  await assert.rejects(
    adapter.createAccount({ linkId: "l2", environment: "sandbox", profile, details, agreement }),
    /PLATFORM_DETAILS_MISSING/,
  );

  const pay = tk({ "POST /api/v1/payments/requests": { id: "18408f41163f4748b87da9b9a68b6df8" } });
  const input = {
    providerAccountId: "3f2b8c1e-1d2a-4b5c-9e8f-0a1b2c3d4e5f",
    attemptKey: "attempt:1",
    amount: "10.00",
    precision: 2,
    currency: "GBP",
    method: "bank-transfer" as const,
    feeMinor: 0n,
    reference: "order-1",
    returnUrl: "https://payrouta.example/r",
    cancelUrl: "https://payrouta.example/c",
    recipient: { name: "Harbor Ltd", accountNumber: "78901234", routingNumber: "12-34-56", country: "GB" },
  };
  const r = await pay.adapter.createPayment(input);
  assert.match(r.actionUrl!, /^https:\/\/link\.tink\.com\/1\.0\/pay\/direct\/\?client_id=abcdef123456/);
  assert.match(r.actionUrl!, /payment_request_id=18408f41163f4748b87da9b9a68b6df8/);
  const body = JSON.parse(pay.calls[1].body!);
  assert.deepEqual(body.recipient, { accountNumber: "12345678901234", accountType: "sort-code" });
  assert.equal(body.paymentScheme, "FASTER_PAYMENTS");
  assert.equal(body.remittanceInformation.type, "REFERENCE");
  assert.ok(body.remittanceInformation.value.length <= 18);
  assert.equal((await pay.adapter.createPayment({ ...input, feeMinor: 5n })).state, "Rejected", "Tink cannot withhold a fee");
  assert.deepEqual(tinkRecipient({ accountNumber: "DE89370400440532013000", country: "DE" }), { accountNumber: "DE89370400440532013000", accountType: "iban" });
  assert.equal(tinkRecipient({ accountNumber: "123", routingNumber: "123456", country: "GB" }), null);

  const status = (s: string) =>
    tk({ "GET /api/v1/payments/requests/18408f41163f4748b87da9b9a68b6df8/transfers": { paymentRequestCreatedTransfers: [{ status: s, amount: 10, currency: "GBP", updated: "1760000000000" }] } });
  const ref = { reference: "18408f41163f4748b87da9b9a68b6df8", providerAccountId: input.providerAccountId };
  assert.equal((await status("SENT").adapter.paymentStatus(ref))?.state, "Pending", "sent to the bank is not paid");
  assert.equal((await status("SETTLED_PAYEE").adapter.paymentStatus(ref))?.state, "Confirmed");
  assert.equal((await status("CANCELLED").adapter.paymentStatus(ref))?.state, "Rejected");
  assert.equal((await status("SETTLED_PAYEE").adapter.fundsAvailability({ ...ref, feeMinor: 0n }))?.netMinor, 1000n);
});

// ---------------------------------------------------------------------------
// Payouts and provider events (phase 2b)

test("paystack, flutterwave, dlocal and tink events: each provider's own signature", async () => {
  const paystack = fakePaystack({});
  const pBody = JSON.stringify({ event: "charge.success", data: { id: 42, reference: "attempt-1" } });
  const pSig = createHmac("sha512", "sk_test_123").update(pBody).digest("hex");
  assert.deepEqual(await paystack.adapter.verifyEvent!({ rawBody: pBody, headers: new Headers({ "x-paystack-signature": pSig }) }), {
    eventId: "charge.success:42", type: "charge.success", kind: "payment", objectRef: "attempt-1",
  });
  assert.equal(await paystack.adapter.verifyEvent!({ rawBody: pBody + " ", headers: new Headers({ "x-paystack-signature": pSig }) }), null);

  const flutter = fake(flutterwaveSplitPlatform, { environment: "sandbox", secretKeyRef: "s", webhookHashRef: "h" }, { s: "FLWSECK_TEST-x", h: "my-hash" }, {});
  const fBody = JSON.stringify({ event: "charge.completed", data: { id: 3091255, tx_ref: "attempt-9", status: "successful" } });
  assert.equal((await flutter.adapter.verifyEvent!({ rawBody: fBody, headers: new Headers({ "verif-hash": "my-hash" }) }))?.objectRef, "attempt-9");
  assert.equal(await flutter.adapter.verifyEvent!({ rawBody: fBody, headers: new Headers({ "verif-hash": "wrong-hash" }) }), null);

  const monnify = mfy({});
  const mBody = JSON.stringify({
    eventType: "SUCCESSFUL_TRANSACTION",
    eventData: { transactionReference: "MNFY|20261024|000001", paymentReference: "attempt-11" },
  });
  const mSig = createHmac("sha512", "sec_test_xyz").update(mBody).digest("hex");
  assert.deepEqual(await monnify.adapter.verifyEvent!({ rawBody: mBody, headers: new Headers({ "monnify-signature": mSig }) }), {
    eventId: "SUCCESSFUL_TRANSACTION:MNFY|20261024|000001",
    type: "SUCCESSFUL_TRANSACTION",
    kind: "payment",
    objectRef: "attempt-11",
  });
  assert.equal(await monnify.adapter.verifyEvent!({ rawBody: mBody + " ", headers: new Headers({ "monnify-signature": mSig }) }), null);

  const bridge = br({});
  const bBody = JSON.stringify({
    event_id: "evt_b1",
    event_type: "transfer.updated.status_transitioned",
    event_object_id: "tx_bridge_99",
  });
  const bTs = Math.floor(Date.parse("2026-10-09T12:00:00.000Z") / 1000);
  const bSig = createHmac("sha256", "whsec_bridge").update(`${bTs}.${bBody}`).digest("hex");
  assert.deepEqual(
    await bridge.adapter.verifyEvent!({ rawBody: bBody, headers: new Headers({ "x-webhook-signature": `t=${bTs},v0=${bSig}` }) }),
    { eventId: "evt_b1", type: "transfer.updated.status_transitioned", kind: "payment", objectRef: "tx_bridge_99" },
  );
  assert.equal(
    await bridge.adapter.verifyEvent!({ rawBody: bBody, headers: new Headers({ "x-webhook-signature": `t=${bTs - 600},v0=${bSig}` }) }),
    null,
  );

  const yellowcard = yc({});
  const yBody = JSON.stringify({ event: "collection.complete", id: "yc_col_1", sequenceId: "attempt-yc1" });
  const ySig = createHmac("sha256", "yc_sec_1").update(yBody).digest("base64");
  assert.deepEqual(
    await yellowcard.adapter.verifyEvent!({ rawBody: yBody, headers: new Headers({ "x-yc-signature": ySig }) }),
    { eventId: "collection.complete:yc_col_1", type: "collection.complete", kind: "payment", objectRef: "attempt-yc1" },
  );
  assert.equal(await yellowcard.adapter.verifyEvent!({ rawBody: yBody + " ", headers: new Headers({ "x-yc-signature": ySig }) }), null);

  const local = dl({});
  const dBody = JSON.stringify({ id: "D-4-abc", status: "PAID" });
  const date = "2026-10-09T12:00:00.000Z";
  const dHeaders = (login: string, signature: string, at = date) =>
    new Headers({ "x-date": at, "x-login": login, authorization: `V2-HMAC-SHA256, Signature: ${signature}` });
  assert.deepEqual(await local.adapter.verifyEvent!({ rawBody: dBody, headers: dHeaders("login1", dlocalSignature("secret1", "login1", date, dBody)) }), {
    eventId: "D-4-abc:PAID", type: "payment.paid", kind: "payment", objectRef: "D-4-abc",
  });
  assert.equal(await local.adapter.verifyEvent!({ rawBody: dBody, headers: dHeaders("login2", dlocalSignature("secret1", "login2", date, dBody)) }), null);
  const stale = "2026-10-09T11:00:00.000Z";
  assert.equal(await local.adapter.verifyEvent!({ rawBody: dBody, headers: dHeaders("login1", dlocalSignature("secret1", "login1", stale, dBody), stale) }), null);

  const tink = fake(
    tinkPlatform,
    { environment: "sandbox", clientId: "abcdef123456", clientSecretRef: "s", webhookSecretRef: "w", merchantsPath: "/partner/v1/merchants", redirectUri: "https://payrouta.example/tink/callback" },
    { s: "secret", w: "tink-webhook-secret" },
    {},
  );
  const tBody = JSON.stringify({ event: "payment:updated", content: { id: "40dc04e5353547378c84f34ffc88f853", paymentRequestId: "18408f41163f4748b87da9b9a68b6df8", status: "SETTLED_PAYEE" } });
  const t = Math.floor(Date.parse("2026-10-09T12:00:00.000Z") / 1000);
  const tSig = createHmac("sha256", "tink-webhook-secret").update(`${t}.${tBody}`).digest("hex");
  assert.deepEqual(await tink.adapter.verifyEvent!({ rawBody: tBody, headers: new Headers({ "x-tink-signature": `t=${t},v1=${tSig}` }) }), {
    eventId: "40dc04e5353547378c84f34ffc88f853:SETTLED_PAYEE", type: "payment:updated", kind: "payment", objectRef: "18408f41163f4748b87da9b9a68b6df8",
  });
  assert.equal(await tink.adapter.verifyEvent!({ rawBody: tBody, headers: new Headers({ "x-tink-signature": `t=${t - 3600},v1=${tSig}` }) }), null);
});

// ---------------------------------------------------------------------------
// Refunds, disputes and balances (phase 2c)

test("paystack, flutterwave and dlocal refunds; paystack disputes", async () => {
  const p = fakePaystack({
    "POST /refund": { id: 77, status: "pending" },
    "GET /dispute/9": { id: 9, status: "resolved", resolution: "declined", refund_amount: 0, currency: "NGN", transaction: { reference: "attempt-1", amount: 500000 } },
  });
  assert.deepEqual(await p.adapter.createRefund!({ providerAccountId: "ACCT_abc123", reference: "attempt-1", refundId: "rf", amountMinor: 100000n, currency: "NGN" }), { reference: "77", state: "Pending" });
  assert.equal(JSON.parse(p.calls[0].body!).transaction, "attempt-1");
  const pd = await p.adapter.disputeStatus!({ reference: "9" });
  assert.deepEqual({ state: pd?.state, amount: pd?.amountMinor, ref: pd?.paymentReference }, { state: "Won", amount: 500000n, ref: "attempt-1" });

  const f = fw({ "POST /v3/transactions/3091255/refund": wrap({ id: 1234, status: "completed" }) });
  assert.deepEqual(await f.adapter.createRefund!({ providerAccountId: "RS_A1B2C3D4", reference: "attempt-9", paymentRef: "3091255", refundId: "rf", amountMinor: 250000n, currency: "NGN" }), { reference: "1234", state: "Succeeded" });
  assert.equal(JSON.parse(f.calls[0].body!).amount, 2500);

  const m = mfy({
    "POST /api/v1/refunds/initiate-refund": mfyWrap({ refundReference: "rf-1", refundStatus: "COMPLETED" }),
    "GET /api/v1/refunds/rf-1": mfyWrap({ refundReference: "rf-1", refundStatus: "COMPLETED" }),
  });
  assert.deepEqual(
    await m.adapter.createRefund!({
      providerAccountId: "MFY_SUB_319452883968",
      reference: "attempt-11",
      paymentRef: "MNFY|20261024|000001",
      refundId: "rf-1",
      amountMinor: 250000n,
      currency: "NGN",
    }),
    { reference: "rf-1", state: "Succeeded" },
  );
  assert.equal(JSON.parse(m.calls[1].body!).refundAmount, 2500);
  assert.deepEqual(await m.adapter.refundStatus!({ providerAccountId: "MFY_SUB_319452883968", reference: "rf-1" }), { state: "Succeeded" });

  const b = br({
    "POST /v0/transfers/tx_bridge_99/refunds": { id: "brf_1", state: "completed" },
    "GET /v0/refunds/brf_1": { id: "brf_1", state: "completed" },
  });
  assert.deepEqual(
    await b.adapter.createRefund!({
      providerAccountId: "cust_bridge_1:ext_bank_1",
      reference: "tx_bridge_99",
      refundId: "rf-b1",
      amountMinor: 2000n,
      currency: "USD",
    }),
    { reference: "brf_1", state: "Succeeded" },
  );
  assert.deepEqual(await b.adapter.refundStatus!({ providerAccountId: "cust_bridge_1:ext_bank_1", reference: "brf_1" }), { state: "Succeeded" });

  const y = yc({
    "POST /business/refunds": { id: "ycrf_1", status: "complete" },
    "GET /business/refunds/ycrf_1": { id: "ycrf_1", status: "complete" },
  });
  assert.deepEqual(
    await y.adapter.createRefund!({
      providerAccountId: "yc_sub_ng001",
      reference: "attempt-yc1",
      refundId: "rf-y1",
      amountMinor: 100000n,
      currency: "NGN",
    }),
    { reference: "ycrf_1", state: "Succeeded" },
  );
  assert.deepEqual(await y.adapter.refundStatus!({ providerAccountId: "yc_sub_ng001", reference: "ycrf_1" }), { state: "Succeeded" });

  const d = dl({ "POST /refunds": { id: "REF-1", status: "PENDING" } });
  assert.deepEqual(await d.adapter.createRefund!({ providerAccountId: "d907f733-5e17-4470-b963-c2ac2c11a440", reference: "D-4-abc", refundId: "rf", amountMinor: 1050n, currency: "BRL" }), { reference: "REF-1", state: "Pending" });
  assert.deepEqual(JSON.parse(d.calls[0].body!).amount, 10.5);
  const tinkAdapter = tinkPlatform.create(
    tinkPlatform.configSchema.parse({ environment: "sandbox", clientId: "abcdef123456", merchantsPath: "/m/x", redirectUri: "https://x.example/cb" }),
    { http: async () => ({ status: 500, headers: {}, body: "" }), credentials: { get: async () => "" } },
  );
  assert.equal(tinkAdapter.createRefund, undefined, "pay by bank has no refunds");
});

test("dispute evidence: Paystack needs the customer's contact details", async () => {
  const p = fakePaystack({ "POST /dispute/9/evidence": { id: 9 } });
  await assert.rejects(
    p.adapter.submitDisputeEvidence!({ reference: "9", disputeId: "d2", evidence: { productDescription: "Two loaves delivered in Lagos on 2 Oct" } }),
    /EVIDENCE_CUSTOMER_DETAILS_REQUIRED/,
  );
  await p.adapter.submitDisputeEvidence!({
    reference: "9",
    disputeId: "d2",
    evidence: { productDescription: "Two loaves delivered in Lagos on 2 Oct", customerName: "Bola", customerEmail: "bola@example.com", customerPhone: "+2348000000000", explanation: "Courier photo on file." },
  });
  const pb = JSON.parse(p.calls[0].body!);
  assert.equal(pb.customer_phone, "+2348000000000");
  assert.match(pb.service_details, /Courier photo on file/);
});
