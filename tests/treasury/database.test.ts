Object.assign(process.env, { NODE_ENV: "test" });
process.env.PAYMENT_TEST_LEGACY_METHODS = "enabled";
import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../../lib/portal/db";
import { atomic, json } from "../../lib/portal/service";
import { baseProfile } from "../../lib/partners/conformance";
import { fingerprint, type KybProfile } from "../../lib/partners/kyb";
import {
  liveBlockers,
  requireFundsAccess,
  submitMerchantAccount,
  transitionMerchantAccount,
} from "../../lib/treasury/merchant-account";
import { merchantBalances, postFunds } from "../../lib/treasury/ledger";
import { openPlatformLink, provisionLink } from "../../lib/treasury/links";
import { acceptMerchantTerms, saveVerificationDetails } from "../../lib/treasury/verification";
import { recordAvailability, releaseReserve } from "../../lib/treasury/funds";
import { dispatchPayout, payoutEligible, requestPayout, sweepPayouts } from "../../lib/treasury/payouts";
import { processPlatformEvent, receivePlatformEvent } from "../../lib/treasury/events";
import { dispatchRefund, requestRefund } from "../../lib/treasury/refunds";
import { applyDispute, submitDisputeEvidence } from "../../lib/treasury/disputes";
import { reconcileLink } from "../../lib/treasury/reconciliation";
import { secretManager } from "../../lib/portal/adapters";
import { createHmac } from "node:crypto";
import {
  confirm,
  createIntent,
  createSession,
  customerAction,
  methods,
  selectMethod,
} from "../../lib/payments/service";
import { dispatch, poll } from "../../lib/payments/processing";

const terms = {
  reserve: { basisPoints: 1000, holdDays: 90 },
  payout: { schedule: "daily", delayDays: 2 },
  taxMode: "merchant-seller",
  limits: { currency: "USD", maximumMinor: "500000", dailyMaximumMinor: "5000000" },
};
// Fictional identity and payout details matching a profile's owners.
function details(profile: KybProfile) {
  const address = { line1: "1 Dock Street", city: "London", postalCode: "E1 1AA", country: "GB" };
  return {
    businessPhone: "+442071234567",
    representative: { dateOfBirth: "1985-04-12", address },
    owners: profile.owners.map(() => ({ dateOfBirth: "1979-01-30", address })),
    payoutAccount: {
      country: "GB",
      currency: "GBP",
      holderName: profile.legalName,
      holderType: "company",
      accountNumber: "GB82WEST12345698765432",
    },
  };
}
let entityId: string;
let platformId: string;

before(async () => {
  if (
    !process.env.DATABASE_URL?.includes("127.0.0.1:55432/payrouta") ||
    process.env.PORTAL_MODE !== "local"
  )
    throw new Error("Requires isolated local fixtures");
  const entity = await db.legalEntity.create({
    data: { name: `PayRouta Global ${randomUUID()}`, jurisdiction: "US-DE", updatedBy: "test" },
  });
  entityId = entity.id;
  const platform = await db.platformAccount.create({
    data: {
      legalEntityId: entity.id,
      provider: "sandbox-platform",
      environment: "sandbox",
      custody: "partner-held",
      merchantCountries: json(["GB", "US"]),
      config: json({}),
      enabled: true,
      updatedBy: "test",
    },
  });
  platformId = platform.id;
});
after(() => db.$disconnect());

async function merchant(profile: KybProfile = baseProfile, verdict = "clear") {
  const org = await db.organization.create({
    data: { name: `Treasury test ${randomUUID()}`, fictional: true },
  });
  await db.merchantConfig.create({
    data: { orgId: org.id, returnOrigin: "http://127.0.0.1:3000", environment: "sandbox" },
  });
  await db.merchantKybProfile.create({
    data: { orgId: org.id, version: 1, data: json(profile), fingerprint: fingerprint(profile), createdBy: "test" },
  });
  await db.merchantScreening.create({
    data: { orgId: org.id, profileVersion: 1, provider: "sandbox-fixture", verdict, results: json([]), createdBy: "test" },
  });
  await atomic(async (tx) => {
    await saveVerificationDetails(tx, org.id, details(profile), profile, "merchant-user");
    await acceptMerchantTerms(tx, org.id, "merchant-user", { ip: "127.0.0.1", userAgent: "test" });
  });
  const account = await atomic((tx) => submitMerchantAccount(tx, org.id, "sandbox", "merchant-user"));
  return { orgId: org.id, account };
}

async function review(orgId: string, expectedVersion: number, to: string, decision?: object) {
  return atomic((tx) =>
    transitionMerchantAccount(
      tx,
      {
        orgId,
        environment: "sandbox",
        expectedVersion,
        to: to as never,
        reason: `Test transition to ${to}`,
        decision: decision as never,
      },
      "ops-user",
    ),
  );
}

// Underwriting opens the merchant's sub-account; the fictional platform
// approves it immediately.
async function subAccount(orgId: string) {
  const link = await atomic((tx) =>
    openPlatformLink(tx, { orgId, environment: "sandbox", platformAccountId: platformId }, "ops-user"),
  );
  await provisionLink(link.id);
  return db.merchantPlatformLink.findUniqueOrThrow({ where: { id: link.id } });
}

async function live(profile?: KybProfile) {
  const m = await merchant(profile);
  await review(m.orgId, 1, "Underwriting");
  await subAccount(m.orgId);
  const account = await review(m.orgId, 2, "Live", {
    legalEntityId: entityId,
    riskTier: "standard",
    terms,
  });
  return { orgId: m.orgId, account };
}

function funds(orgId: string, source: string, lines: { account: string; debit: string; credit: string }[]) {
  return atomic((tx) =>
    postFunds(
      tx,
      {
        orgId,
        environment: "sandbox",
        platformAccountId: platformId,
        source,
        asset: "fiat:USD:",
        purpose: "Test",
        effectiveAt: new Date(),
      },
      lines,
    ),
  );
}

test("underwriting: a submitted merchant cannot go live without passing every gate", async () => {
  const flagged = await merchant(baseProfile, "review");
  await review(flagged.orgId, 1, "Underwriting");
  const blockers = await atomic(async (tx) =>
    liveBlockers(
      tx,
      (await tx.merchantAccount.findUniqueOrThrow({
        where: { orgId_environment: { orgId: flagged.orgId, environment: "sandbox" } },
      })),
      { legalEntityId: entityId, riskTier: "high", terms },
    ),
  );
  assert.deepEqual(blockers, ["SCREENING_NOT_CLEAR", "PLATFORM_SUB_ACCOUNT_NOT_APPROVED"]);
  const link = await subAccount(flagged.orgId);
  assert.equal(link.state, "Approved");
  assert.ok(link.integrationId, "an approved sub-account is bound for routing");
  await assert.rejects(
    review(flagged.orgId, 2, "Live", { legalEntityId: entityId, riskTier: "high", terms }),
    /MERCHANT_LIVE_BLOCKED: SCREENING_NOT_CLEAR$/,
  );

  const uncovered = await merchant({ ...baseProfile, country: "NG" });
  await review(uncovered.orgId, 1, "Underwriting");
  await assert.rejects(
    review(uncovered.orgId, 2, "Live", {
      legalEntityId: entityId,
      riskTier: "elevated",
      terms: { ...terms, reserve: { basisPoints: 0, holdDays: 0 } },
    }),
    /MERCHANT_LIVE_BLOCKED: RESERVE_BELOW_TIER_MINIMUM, NO_PLATFORM_ACCOUNT_FOR_MERCHANT_COUNTRY$/,
  );
});

test("underwriting: skipping review, stale versions and changed profiles are refused", async () => {
  const m = await merchant();
  await assert.rejects(review(m.orgId, 1, "Live", { legalEntityId: entityId, riskTier: "low", terms }), /TRANSITION_NOT_ALLOWED/);
  await review(m.orgId, 1, "Underwriting");
  await assert.rejects(review(m.orgId, 1, "Returned"), /VERSION_CONFLICT/);
  const profile = { ...baseProfile, tradingName: "Harbor Two" };
  await db.merchantKybProfile.create({
    data: { orgId: m.orgId, version: 2, data: json(profile), fingerprint: fingerprint(profile), createdBy: "test" },
  });
  await assert.rejects(
    review(m.orgId, 2, "Live", { legalEntityId: entityId, riskTier: "low", terms }),
    /PROFILE_CHANGED_RESUBMIT/,
  );
  await review(m.orgId, 2, "Returned");
  const resubmitted = await atomic((tx) => submitMerchantAccount(tx, m.orgId, "sandbox", "merchant-user"));
  assert.equal(resubmitted.profileVersion, 2);
  assert.equal(resubmitted.state, "Submitted");
  const history = await db.merchantAccountTransition.findMany({
    where: { merchantAccountId: m.account.id },
    orderBy: { createdAt: "asc" },
  });
  assert.deepEqual(history.map((h) => h.to), ["Submitted", "Underwriting", "Returned", "Submitted"]);
  await assert.rejects(
    db.merchantAccountTransition.update({ where: { id: history[0].id }, data: { reason: "Rewritten history" } }),
  );
});

test("ledger: merchant funds need a live merchant on its own company's platform account", async () => {
  const pending = await merchant();
  await assert.rejects(
    funds(pending.orgId, `pay:${randomUUID()}`, [
      { account: "funds-clearing", debit: "100", credit: "0" },
      { account: "merchant-pending", debit: "0", credit: "100" },
    ]),
    /underwritten merchant/,
  );
  const m = await live();
  const access = await atomic((tx) =>
    requireFundsAccess(tx, { orgId: m.orgId, environment: "sandbox", platformAccountId: platformId, operation: "pay-in" }),
  );
  assert.equal(access.platform.id, platformId);
});

test("ledger: balances follow postings and can never be overdrawn or edited", async () => {
  const m = await live();
  await funds(m.orgId, `pay:${randomUUID()}`, [
    { account: "funds-clearing", debit: "10000", credit: "0" },
    { account: "merchant-pending", debit: "0", credit: "9700" },
    { account: "fee-collected", debit: "0", credit: "300" },
  ]);
  await funds(m.orgId, `settle:${randomUUID()}`, [
    { account: "merchant-pending", debit: "9700", credit: "0" },
    { account: "merchant-available", debit: "0", credit: "8730" },
    { account: "merchant-reserve", debit: "0", credit: "970" },
  ]);
  const balances = Object.fromEntries(
    (await merchantBalances(m.orgId, "sandbox")).map((b) => [b.account, b.balance]),
  );
  assert.deepEqual(balances, {
    "fee-collected": "300",
    "funds-clearing": "-10000",
    "merchant-available": "8730",
    "merchant-pending": "0",
    "merchant-reserve": "970",
  });
  // A payout larger than what is available is refused by the database.
  await assert.rejects(
    funds(m.orgId, `payout:${randomUUID()}`, [
      { account: "merchant-available", debit: "9000", credit: "0" },
      { account: "payout-in-transit", debit: "0", credit: "9000" },
    ]),
    /merchant_balance_not_overdrawn/,
  );
  // A refund beyond the balance has to be booked as a receivable instead.
  await funds(m.orgId, `refund:${randomUUID()}`, [
    { account: "merchant-available", debit: "8730", credit: "0" },
    { account: "merchant-receivable", debit: "1270", credit: "0" },
    { account: "funds-clearing", debit: "0", credit: "10000" },
  ]);
  await assert.rejects(
    db.merchantBalance.update({
      where: { orgId_environment_asset_account: { orgId: m.orgId, environment: "sandbox", asset: "fiat:USD:", account: "merchant-available" } },
      data: { balance: 1000000 },
    }),
    /only through journal postings/,
  );
  await assert.rejects(
    funds(m.orgId, `bad:${randomUUID()}`, [
      { account: "merchant-payable", debit: "1", credit: "0" },
      { account: "funds-clearing", debit: "0", credit: "1" },
    ]),
    /JOURNAL_BOOK_ACCOUNT_MISMATCH/,
  );
});

test("lifecycle: restricted merchants are frozen; closing needs every balance at zero", async () => {
  const m = await live();
  await funds(m.orgId, `pay:${randomUUID()}`, [
    { account: "funds-clearing", debit: "500", credit: "0" },
    { account: "merchant-available", debit: "0", credit: "500" },
  ]);
  await review(m.orgId, 3, "Restricted");
  await assert.rejects(
    atomic((tx) =>
      requireFundsAccess(tx, { orgId: m.orgId, environment: "sandbox", platformAccountId: platformId, operation: "payout" }),
    ),
    /MERCHANT_NOT_LIVE/,
  );
  await review(m.orgId, 4, "Live");
  await review(m.orgId, 5, "Offboarding");
  await assert.rejects(review(m.orgId, 6, "Closed"), /MERCHANT_BALANCES_OUTSTANDING/);
  await funds(m.orgId, `payout:${randomUUID()}`, [
    { account: "merchant-available", debit: "500", credit: "0" },
    { account: "funds-clearing", debit: "0", credit: "500" },
  ]);
  const closed = await review(m.orgId, 6, "Closed");
  assert.equal(closed.state, "Closed");
});

test("checkout: a Live merchant is paid through the platform account with the fee withheld", async () => {
  const m = await live();
  const pending = await merchant();
  const fiat = { kind: "fiat", identifier: "GBP", network: "" };
  const checkout = async (orgId: string) => {
    const intent = await createIntent(orgId, `platform-pay-${randomUUID()}`, {
      reference: `order-${randomUUID().slice(0, 8)}`,
      amount: "40.00",
      asset: fiat,
      precision: 2,
      methods: ["card"],
      settlement: fiat,
      returnUrl: "http://127.0.0.1:3000/done",
    });
    return { intent, s: await createSession(orgId, intent.id) };
  };
  // A merchant still in underwriting is never offered the platform rail.
  const before = await checkout(pending.orgId);
  assert.notEqual(
    (await methods(before.s.sessionId, before.s.token)).methods.find((x) => x.method === "card")?.status,
    "AVAILABLE",
  );

  const { intent, s } = await checkout(m.orgId);
  const offered = await methods(s.sessionId, s.token);
  assert.equal(offered.methods.find((x) => x.method === "card")?.status, "AVAILABLE");
  const route = await selectMethod(s.sessionId, s.token, "card");
  const { attemptId } = await confirm(s.sessionId, s.token, route.routeId);
  const attempt = await db.paymentAttempt.findUniqueOrThrow({ where: { id: attemptId! } });
  assert.match(attempt.profileId, /^platform:/);
  await dispatch(attemptId!);
  await customerAction(s.sessionId, s.token);
  await poll(attemptId!);
  assert.equal((await db.paymentIntent.findUniqueOrThrow({ where: { id: intent.id } })).state, "Confirmed");

  const entry = await db.journalEntry.findUniqueOrThrow({ where: { source: `payment:${intent.id}` } });
  assert.equal(entry.book, "merchant-funds");
  assert.equal(entry.platformAccountId, platformId);
  const fee = await db.paymentFee.findUniqueOrThrow({ where: { intentId: intent.id } });
  assert.equal(fee.collection, "withheld");
  assert.equal(
    await db.journalEntry.count({ where: { source: `platform-fee:${intent.id}` } }),
    0,
    "a withheld fee is never invoiced again",
  );
  const balance = async () =>
    Object.fromEntries((await merchantBalances(m.orgId, "sandbox")).map((b) => [b.account, b.balance]));
  assert.equal((await balance())["merchant-pending"], "4000");

  // The fictional provider releases funds two days after confirmation.
  await recordAvailability(attemptId!);
  let p = await db.platformPayment.findUniqueOrThrow({ where: { attemptId: attemptId! } });
  assert.equal(p.state, "Pending");
  assert.ok(p.availableAt! > new Date());
  assert.ok(await db.job.findUnique({
    where: { key: `treasury-availability:${attemptId}:${p.availableAt!.getTime()}` },
  }));
  await recordAvailability(attemptId!, new Date(p.availableAt!.getTime() + 1000));
  p = await db.platformPayment.findUniqueOrThrow({ where: { attemptId: attemptId! } });
  assert.equal(p.state, "Available");
  assert.equal(p.reserveMinor?.toFixed(0), "400", "10% rolling reserve");
  assert.deepEqual(
    { pending: (await balance())["merchant-pending"], available: (await balance())["merchant-available"], reserve: (await balance())["merchant-reserve"] },
    { pending: "0", available: "3600", reserve: "400" },
  );
  // Replays never double-book.
  await recordAvailability(attemptId!, new Date(p.availableAt!.getTime() + 2000));
  await releaseReserve(attemptId!, new Date(p.reserveReleaseAt!.getTime() - 1000));
  assert.equal((await balance())["merchant-reserve"], "400", "not before the hold ends");
  await releaseReserve(attemptId!, new Date(p.reserveReleaseAt!.getTime() + 1000));
  await releaseReserve(attemptId!, new Date(p.reserveReleaseAt!.getTime() + 2000));
  assert.deepEqual(
    { available: (await balance())["merchant-available"], reserve: (await balance())["merchant-reserve"] },
    { available: "4000", reserve: "0" },
  );
});

test("checkout: restricting a merchant stops new platform payments", async () => {
  const m = await live();
  await review(m.orgId, 3, "Restricted");
  const fiat = { kind: "fiat", identifier: "GBP", network: "" };
  const intent = await createIntent(m.orgId, `platform-pay-${randomUUID()}`, {
    reference: `order-${randomUUID().slice(0, 8)}`,
    amount: "10.00",
    asset: fiat,
    precision: 2,
    methods: ["card"],
    settlement: fiat,
    returnUrl: "http://127.0.0.1:3000/done",
  });
  const s = await createSession(m.orgId, intent.id);
  const offered = await methods(s.sessionId, s.token);
  assert.notEqual(offered.methods.find((x) => x.method === "card")?.status, "AVAILABLE");
  await assert.rejects(selectMethod(s.sessionId, s.token, "card"), /NOT_AVAILABLE/);
});

test("onboarding: PayRouta collects identity and payout details itself, encrypted", async () => {
  const org = await db.organization.create({ data: { name: `Treasury test ${randomUUID()}`, fictional: true } });
  await db.merchantKybProfile.create({
    data: { orgId: org.id, version: 1, data: json(baseProfile), fingerprint: fingerprint(baseProfile), createdBy: "test" },
  });
  await assert.rejects(
    atomic((tx) => submitMerchantAccount(tx, org.id, "sandbox", "merchant-user")),
    /VERIFICATION_DETAILS_REQUIRED/,
  );
  const saved = await atomic((tx) => saveVerificationDetails(tx, org.id, details(baseProfile), baseProfile, "merchant-user"));
  assert.ok(!JSON.stringify(saved).includes("GB82WEST12345698765432"), "only a reference and a masked summary are stored");
  assert.equal((saved.summary as { payoutAccount: { accountLast4: string } }).payoutAccount.accountLast4, "5432");
  await assert.rejects(
    atomic((tx) => submitMerchantAccount(tx, org.id, "sandbox", "merchant-user")),
    /MERCHANT_TERMS_NOT_ACCEPTED/,
  );
  // Saving identical details again is not a new version.
  const again = await atomic((tx) => saveVerificationDetails(tx, org.id, details(baseProfile), baseProfile, "merchant-user"));
  assert.equal(again.version, 1);
  await assert.rejects(
    atomic((tx) => saveVerificationDetails(tx, org.id, { ...details(baseProfile), owners: [] }, baseProfile, "merchant-user")),
    /OWNER_DETAILS_MUST_MATCH_PROFILE/,
  );
});

test("onboarding: changed details after submission must be resubmitted before going live", async () => {
  const m = await merchant();
  await review(m.orgId, 1, "Underwriting");
  await subAccount(m.orgId);
  await atomic((tx) =>
    saveVerificationDetails(
      tx,
      m.orgId,
      { ...details(baseProfile), businessPhone: "+442079999999" },
      baseProfile,
      "merchant-user",
    ),
  );
  await assert.rejects(
    review(m.orgId, 2, "Live", { legalEntityId: entityId, riskTier: "low", terms }),
    /DETAILS_CHANGED_RESUBMIT/,
  );
});

test("split settlement: no reserve possible, processing fee from the merchant's share, paid directly", async () => {
  const entity = await db.legalEntity.create({
    data: { name: `PayRouta Nigeria ${randomUUID()}`, jurisdiction: "NG", updatedBy: "test" },
  });
  const split = await db.platformAccount.create({
    data: {
      legalEntityId: entity.id,
      provider: "sandbox-split",
      environment: "sandbox",
      custody: "split-settlement",
      merchantCountries: json(["GB"]),
      config: json({}),
      enabled: true,
      updatedBy: "test",
    },
  });
  const m = await merchant();
  await review(m.orgId, 1, "Underwriting");
  const link = await atomic((tx) =>
    openPlatformLink(tx, { orgId: m.orgId, environment: "sandbox", platformAccountId: split.id }, "ops-user"),
  );
  await provisionLink(link.id);
  // A rolling reserve cannot be held where the provider pays the merchant.
  await assert.rejects(
    review(m.orgId, 2, "Live", { legalEntityId: entity.id, riskTier: "standard", terms }),
    /RESERVE_NOT_SUPPORTED_BY_PLATFORM/,
  );
  await review(m.orgId, 2, "Live", {
    legalEntityId: entity.id,
    riskTier: "standard",
    terms: { ...terms, reserve: { basisPoints: 0, holdDays: 0 } },
  });
  const fiat = { kind: "fiat", identifier: "GBP", network: "" };
  const intent = await createIntent(m.orgId, `split-pay-${randomUUID()}`, {
    reference: `order-${randomUUID().slice(0, 8)}`,
    amount: "40.00",
    asset: fiat,
    precision: 2,
    methods: ["card"],
    settlement: fiat,
    returnUrl: "http://127.0.0.1:3000/done",
  });
  const s = await createSession(m.orgId, intent.id);
  await methods(s.sessionId, s.token);
  const route = await selectMethod(s.sessionId, s.token, "card");
  const { attemptId } = await confirm(s.sessionId, s.token, route.routeId);
  await dispatch(attemptId!);
  await customerAction(s.sessionId, s.token);
  await poll(attemptId!);
  const p = await db.platformPayment.findUniqueOrThrow({ where: { attemptId: attemptId! } });
  await recordAvailability(attemptId!, new Date(Date.now() + 3 * 86400000));
  const after = await db.platformPayment.findUniqueOrThrow({ where: { attemptId: attemptId! } });
  assert.equal(p.platformAccountId, split.id);
  assert.equal(after.state, "Released");
  assert.equal(after.settledDirectly, true);
  assert.equal(after.providerFeeMinor.toFixed(0), "60", "1.5% fictional processing fee");
  const balances = Object.fromEntries((await merchantBalances(m.orgId, "sandbox")).map((b) => [b.account, b.balance]));
  assert.deepEqual(
    { pending: balances["merchant-pending"], available: balances["merchant-available"], clearing: balances["funds-clearing"] },
    { pending: "0", available: "0", clearing: "0" },
    "nothing is owed by PayRouta: the provider paid the merchant",
  );
});

// ---------------------------------------------------------------------------
// Payouts and provider events (phase 2b)

// A Live merchant on `platformAccountId` with one confirmed 40.00 GBP
// payment whose funds are available (10% reserve held).
async function fundedMerchant(platformAccountId = platformId, legalEntityId = entityId) {
  const m = await merchant();
  await review(m.orgId, 1, "Underwriting");
  const link = await atomic((tx) =>
    openPlatformLink(tx, { orgId: m.orgId, environment: "sandbox", platformAccountId }, "ops-user"),
  );
  await provisionLink(link.id);
  await review(m.orgId, 2, "Live", { legalEntityId, riskTier: "standard", terms });
  const fiat = { kind: "fiat", identifier: "GBP", network: "" };
  const intent = await createIntent(m.orgId, `payout-pay-${randomUUID()}`, {
    reference: `order-${randomUUID().slice(0, 8)}`,
    amount: "40.00",
    asset: fiat,
    precision: 2,
    methods: ["card"],
    settlement: fiat,
    returnUrl: "http://127.0.0.1:3000/done",
  });
  const s = await createSession(m.orgId, intent.id);
  await methods(s.sessionId, s.token);
  const route = await selectMethod(s.sessionId, s.token, "card");
  const { attemptId } = await confirm(s.sessionId, s.token, route.routeId);
  await dispatch(attemptId!);
  await customerAction(s.sessionId, s.token);
  await poll(attemptId!);
  await recordAvailability(attemptId!);
  const p = await db.platformPayment.findUniqueOrThrow({ where: { attemptId: attemptId! } });
  const availableAt = new Date(p.availableAt!.getTime() + 1000);
  await recordAvailability(attemptId!, availableAt);
  return { orgId: m.orgId, availableAt };
}
const balanceOf = async (orgId: string) =>
  Object.fromEntries((await merchantBalances(orgId, "sandbox")).map((b) => [b.account, b.balance]));

test("payouts: only what is available after the delay, paid to the merchant's bank", async () => {
  const m = await fundedMerchant();
  const ask = (now: Date, amountMinor?: bigint) =>
    atomic((tx) =>
      requestPayout(tx, { orgId: m.orgId, environment: "sandbox", platformAccountId: platformId, asset: "fiat:GBP:", amountMinor, initiatedBy: "merchant-user", now }),
    );
  // Terms hold newly available funds for two days before they can be paid out.
  assert.equal(await payoutEligible(db, { orgId: m.orgId, environment: "sandbox", platformAccountId: platformId, asset: "fiat:GBP:", delayDays: 2, now: m.availableAt }), 0n);
  await assert.rejects(ask(m.availableAt), /NOTHING_TO_PAY_OUT/);
  const later = new Date(m.availableAt.getTime() + 3 * 86400000);
  await assert.rejects(ask(later, 3601n), /INSUFFICIENT_AVAILABLE_BALANCE/);
  await assert.rejects(
    atomic((tx) => requestPayout(tx, { orgId: m.orgId, environment: "sandbox", platformAccountId: platformId, asset: "fiat:USD:", initiatedBy: "x", now: later })),
    /PAYOUT_CURRENCY_NOT_SUPPORTED/,
  );
  const payout = await ask(later);
  assert.equal(payout!.amountMinor.toFixed(0), "3600", "the reserve is never paid out");
  let b = await balanceOf(m.orgId);
  assert.deepEqual({ available: b["merchant-available"], transit: b["payout-in-transit"] }, { available: "0", transit: "3600" });
  await dispatchPayout(payout!.id);
  await dispatchPayout(payout!.id);
  const paid = await db.payout.findUniqueOrThrow({ where: { id: payout!.id } });
  assert.equal(paid.state, "Paid");
  assert.equal(paid.providerPayoutRef, `sbxpo_${payout!.id}`);
  b = await balanceOf(m.orgId);
  assert.deepEqual(
    { available: b["merchant-available"], transit: b["payout-in-transit"], reserve: b["merchant-reserve"] },
    { available: "0", transit: "0", reserve: "400" },
  );
});

test("payouts: a refused payout returns the money to the merchant's balance", async () => {
  const entity = await db.legalEntity.create({ data: { name: `PayRouta Failing ${randomUUID()}`, jurisdiction: "US-DE", updatedBy: "test" } });
  const failing = await db.platformAccount.create({
    data: {
      legalEntityId: entity.id,
      provider: "sandbox-platform",
      environment: "sandbox",
      custody: "partner-held",
      merchantCountries: json(["GB"]),
      config: json({ payoutOutcome: "failed" }),
      enabled: true,
      updatedBy: "test",
    },
  });
  const m = await fundedMerchant(failing.id, entity.id);
  const later = new Date(m.availableAt.getTime() + 3 * 86400000);
  const payout = await atomic((tx) =>
    requestPayout(tx, { orgId: m.orgId, environment: "sandbox", platformAccountId: failing.id, asset: "fiat:GBP:", initiatedBy: "merchant-user", now: later }),
  );
  await dispatchPayout(payout!.id);
  const failed = await db.payout.findUniqueOrThrow({ where: { id: payout!.id } });
  assert.equal(failed.state, "Failed");
  assert.equal(failed.failureCode, "fictional-bank-refused");
  const b = await balanceOf(m.orgId);
  assert.deepEqual({ available: b["merchant-available"], transit: b["payout-in-transit"] }, { available: "3600", transit: "0" });
});

test("payouts: the daily schedule pays out once per day; restricted merchants are not paid", async () => {
  const m = await fundedMerchant();
  const day = new Date(m.availableAt.getTime() + 3 * 86400000);
  await sweepPayouts(day);
  await sweepPayouts(new Date(day.getTime() + 60000));
  const scheduled = await db.payout.findMany({ where: { orgId: m.orgId } });
  assert.equal(scheduled.length, 1, "one payout per schedule period");
  assert.equal(scheduled[0].period, `daily:${day.toISOString().slice(0, 10)}`);
  assert.equal(scheduled[0].initiatedBy, "schedule");
  await dispatchPayout(scheduled[0].id);

  const restricted = await fundedMerchant();
  await review(restricted.orgId, 3, "Restricted");
  await sweepPayouts(new Date(restricted.availableAt.getTime() + 3 * 86400000));
  assert.equal(await db.payout.count({ where: { orgId: restricted.orgId } }), 0);
});

test("events: verified, deduplicated, and only prompt a re-read", async () => {
  const secret = `whsec_${randomUUID()}`;
  const entity = await db.legalEntity.create({ data: { name: `PayRouta Events ${randomUUID()}`, jurisdiction: "US-DE", updatedBy: "test" } });
  const stripe = await db.platformAccount.create({
    data: {
      legalEntityId: entity.id,
      provider: "stripe-custom",
      environment: "sandbox",
      custody: "partner-held",
      merchantCountries: json(["GB"]),
      config: json({ connectWebhookSecretRef: await secretManager.put(secret) }),
      enabled: true,
      updatedBy: "test",
    },
  });
  const m = await merchant();
  const acct = `acct_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const link = await db.merchantPlatformLink.create({
    data: { orgId: m.orgId, platformAccountId: stripe.id, environment: "sandbox", profileVersion: 1, state: "Under review", providerAccountId: acct },
  });
  const body = JSON.stringify({ id: `evt_${randomUUID().replace(/-/g, "")}`, type: "account.updated", livemode: false, account: acct, data: { object: { id: acct } } });
  const signed = (raw: string) => {
    const t = Math.floor(Date.now() / 1000);
    return new Headers({ "stripe-signature": `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex")}` });
  };
  assert.deepEqual(await receivePlatformEvent("stripe-custom", "sandbox", body, signed(body)), { accepted: true });
  assert.deepEqual(await receivePlatformEvent("stripe-custom", "sandbox", body, signed(body)), { accepted: true, duplicate: true });
  await assert.rejects(receivePlatformEvent("stripe-custom", "sandbox", body.replace("account.updated", "account.updatex"), signed(body)), /INVALID_SIGNATURE/);
  const row = await db.platformEvent.findFirstOrThrow({ where: { platformAccountId: stripe.id } });
  assert.equal(row.kind, "account");
  await processPlatformEvent(row.id);
  assert.ok(
    await db.job.findUnique({ where: { key: `treasury-link-status:${link.id}:event:${row.id}` } }),
    "the event queues a status re-read; it changes nothing itself",
  );
  assert.equal((await db.merchantPlatformLink.findUniqueOrThrow({ where: { id: link.id } })).state, "Under review");
});

// ---------------------------------------------------------------------------
// Refunds, disputes, set-off and reconciliation (phase 2c)

async function sandboxPlatformWith(config: Record<string, unknown>) {
  const entity = await db.legalEntity.create({ data: { name: `PayRouta ${randomUUID()}`, jurisdiction: "US-DE", updatedBy: "test" } });
  const platform = await db.platformAccount.create({
    data: {
      legalEntityId: entity.id,
      provider: "sandbox-platform",
      environment: "sandbox",
      custody: "partner-held",
      merchantCountries: json(["GB"]),
      config: json(config),
      enabled: true,
      updatedBy: "test",
    },
  });
  return { entityId: entity.id, platformId: platform.id };
}
const paymentOf = (orgId: string) => db.platformPayment.findFirstOrThrow({ where: { orgId } });

test("refunds: funded by the merchant's balance; the shortfall is owed and recovered by set-off", async () => {
  const m = await fundedMerchant();
  const p = await paymentOf(m.orgId);
  const refund = await atomic((tx) =>
    requestRefund(tx, { orgId: m.orgId, environment: "sandbox", intentId: p.intentId, initiatedBy: "merchant-user", now: m.availableAt }),
  );
  assert.equal(refund.amountMinor.toFixed(0), "4000", "the full payment; PayRouta's fee is not returned");
  assert.equal(refund.fromAvailableMinor.toFixed(0), "3600");
  assert.equal(refund.fromReceivableMinor.toFixed(0), "400");
  await assert.rejects(
    atomic((tx) => requestRefund(tx, { orgId: m.orgId, environment: "sandbox", intentId: p.intentId, amountMinor: 1n, initiatedBy: "x", now: m.availableAt })),
    /REFUND_EXCEEDS_PAYMENT/,
  );
  await dispatchRefund(refund.id);
  assert.equal((await db.platformRefund.findUniqueOrThrow({ where: { id: refund.id } })).state, "Succeeded");
  let b = await balanceOf(m.orgId);
  assert.deepEqual({ available: b["merchant-available"], owed: b["merchant-receivable"], reserve: b["merchant-reserve"] }, { available: "0", owed: "-400", reserve: "400" });
  // When the reserve is released it first repays what the merchant owes.
  await releaseReserve(p.attemptId, new Date(p.reserveReleaseAt!.getTime() + 1000));
  b = await balanceOf(m.orgId);
  assert.deepEqual({ available: b["merchant-available"], owed: b["merchant-receivable"], reserve: b["merchant-reserve"] }, { available: "0", owed: "0", reserve: "0" });
});

test("refunds: a refund the provider refuses restores the merchant's balance exactly", async () => {
  const failing = await sandboxPlatformWith({ refundOutcome: "failed" });
  const m = await fundedMerchant(failing.platformId, failing.entityId);
  const p = await paymentOf(m.orgId);
  const refund = await atomic((tx) =>
    requestRefund(tx, { orgId: m.orgId, environment: "sandbox", intentId: p.intentId, amountMinor: 1000n, initiatedBy: "merchant-user", now: m.availableAt }),
  );
  await dispatchRefund(refund.id);
  const r = await db.platformRefund.findUniqueOrThrow({ where: { id: refund.id } });
  assert.equal(r.state, "Failed");
  assert.equal(r.failureCode, "fictional-refund-refused");
  const b = await balanceOf(m.orgId);
  assert.deepEqual({ available: b["merchant-available"], owed: b["merchant-receivable"] ?? "0" }, { available: "3600", owed: "0" });
});

test("disputes: held from available then reserve; won returns it and repays the fee", async () => {
  const m = await fundedMerchant();
  const p = await paymentOf(m.orgId);
  const opened = { reference: `dp_${randomUUID().slice(0, 8)}`, state: "Open" as const, amountMinor: 3800n, currency: "GBP", feeMinor: 1500n, paymentReference: p.reference };
  const d = await applyDispute(platformId, opened, m.availableAt);
  assert.deepEqual(
    { a: d!.fromAvailableMinor.toFixed(0), r: d!.fromReserveMinor.toFixed(0), o: d!.fromReceivableMinor.toFixed(0) },
    { a: "3600", r: "200", o: "0" },
  );
  let b = await balanceOf(m.orgId);
  assert.deepEqual(
    { held: b["merchant-dispute-hold"], available: b["merchant-available"], reserve: b["merchant-reserve"], owed: b["merchant-receivable"] },
    { held: "3800", available: "0", reserve: "200", owed: "-1500" },
    "the dispute fee the merchant could not cover is owed",
  );
  await applyDispute(platformId, opened, m.availableAt);
  assert.equal(await db.platformDispute.count({ where: { providerDisputeRef: opened.reference } }), 1, "replays change nothing");
  await applyDispute(platformId, { ...opened, state: "Won" }, m.availableAt);
  await applyDispute(platformId, { ...opened, state: "Won" }, m.availableAt);
  b = await balanceOf(m.orgId);
  assert.deepEqual(
    { held: b["merchant-dispute-hold"], available: b["merchant-available"], owed: b["merchant-receivable"] },
    { held: "0", available: "2300", owed: "0" },
  );
  // The reserve a dispute used is never released twice.
  await releaseReserve(p.attemptId, new Date(p.reserveReleaseAt!.getTime() + 1000));
  assert.equal((await balanceOf(m.orgId))["merchant-reserve"], "0");
});

test("disputes: a lost dispute sends the held amount to the cardholder", async () => {
  const m = await fundedMerchant();
  const p = await paymentOf(m.orgId);
  const opened = { reference: `dp_${randomUUID().slice(0, 8)}`, state: "Open" as const, amountMinor: 4000n, currency: "GBP", feeMinor: 0n, paymentReference: p.reference };
  await applyDispute(platformId, opened, m.availableAt);
  await applyDispute(platformId, { ...opened, state: "Lost" }, m.availableAt);
  const b = await balanceOf(m.orgId);
  assert.deepEqual(
    { held: b["merchant-dispute-hold"], available: b["merchant-available"], reserve: b["merchant-reserve"] },
    { held: "0", available: "0", reserve: "0" },
  );
  assert.equal((await db.platformDispute.findFirstOrThrow({ where: { providerDisputeRef: opened.reference } })).state, "Lost");
});

test("reconciliation: provider and ledger must agree, or that merchant's payouts pause", async () => {
  const m = await fundedMerchant();
  const link = await db.merchantPlatformLink.findFirstOrThrow({ where: { orgId: m.orgId } });
  const [ok] = await reconcileLink(link.id, m.availableAt);
  assert.equal(ok.result, "Matched");
  assert.equal(ok.ledgerMinor.toFixed(0), "4000");

  const drifting = await sandboxPlatformWith({ balanceOffsetMinor: 7 });
  const d = await fundedMerchant(drifting.platformId, drifting.entityId);
  const dLink = await db.merchantPlatformLink.findFirstOrThrow({ where: { orgId: d.orgId } });
  const [bad] = await reconcileLink(dLink.id, d.availableAt);
  assert.equal(bad.result, "Mismatch");
  assert.equal(bad.providerMinor.toFixed(0), "4007");
  await assert.rejects(
    atomic((tx) =>
      requestPayout(tx, { orgId: d.orgId, environment: "sandbox", platformAccountId: drifting.platformId, asset: "fiat:GBP:", initiatedBy: "x", now: new Date(d.availableAt.getTime() + 3 * 86400000) }),
    ),
    /PAYOUTS_PAUSED_RECONCILIATION/,
  );
});

test("disputes: the merchant responds once, while the dispute is open and before the deadline", async () => {
  const m = await fundedMerchant();
  const p = await paymentOf(m.orgId);
  const open = (reference: string, due?: Date) =>
    applyDispute(platformId, { reference, state: "Open", amountMinor: 1000n, currency: "GBP", feeMinor: 0n, paymentReference: p.reference, evidenceDueBy: due }, m.availableAt);
  const d = await open(`dp_${randomUUID().slice(0, 8)}`, new Date(Date.now() + 7 * 86400000));
  const evidence = { productDescription: "Handmade linen shirt, size M, delivered by courier", shippingTrackingNumber: "JD0001" };
  const answer = (disputeId: string, e: unknown = evidence) =>
    submitDisputeEvidence({ orgId: m.orgId, environment: "sandbox", disputeId, evidence: e, actorId: "merchant-user" });
  await assert.rejects(answer(d!.id, { productDescription: "too short" }));
  const sent = await answer(d!.id);
  assert.ok(sent.evidenceSubmittedAt);
  assert.deepEqual(sent.evidence, evidence);
  await assert.rejects(answer(d!.id), /EVIDENCE_ALREADY_SUBMITTED/);
  const late = await open(`dp_${randomUUID().slice(0, 8)}`, new Date(Date.now() - 1000));
  await assert.rejects(answer(late!.id), /EVIDENCE_DEADLINE_PASSED/);
  const decided = await open(`dp_${randomUUID().slice(0, 8)}`);
  await applyDispute(platformId, { reference: decided!.providerDisputeRef, state: "Won", amountMinor: 1000n, currency: "GBP", feeMinor: 0n, paymentReference: p.reference }, m.availableAt);
  await assert.rejects(answer(decided!.id), /DISPUTE_CLOSED/);
  const other = await fundedMerchant();
  await assert.rejects(
    submitDisputeEvidence({ orgId: other.orgId, environment: "sandbox", disputeId: d!.id, evidence, actorId: "x" }),
    /DISPUTE_NOT_FOUND/,
    "another merchant cannot answer this dispute",
  );
});
