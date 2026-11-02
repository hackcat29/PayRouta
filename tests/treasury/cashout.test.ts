// Cash outs to a bank or mobile money against the local database, with fake
// Bridge and Yellow Card APIs: setup, then each cash out followed from its
// funding payout to the partner's payout.
Object.assign(process.env, { NODE_ENV: "test" });
import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { db } from "../../lib/portal/db";
import { json } from "../../lib/portal/service";
import { secretManager } from "../../lib/portal/adapters";
import { baseProfile } from "../../lib/partners/conformance";
import { fingerprint } from "../../lib/partners/kyb";
import { addBridgeBankAs, advanceCashOut, setYellowCardAs, startBridgeAs, yellowCardNetworksAs } from "../../lib/treasury/offramp/cashout";
import { ycSignature } from "../../lib/treasury/offramp/yellowcard";
import type { Http } from "../../lib/intents/oneclick";

let orgId: string;
const environment = "production";
before(async () => {
  if (!process.env.DATABASE_URL?.includes("127.0.0.1:55432/payrouta") || process.env.PORTAL_MODE !== "local")
    throw new Error("Requires isolated local fixtures");
  orgId = `cashout-${randomUUID()}`;
  await db.organization.create({ data: { id: orgId, name: "Fictional cash out tests", fictional: true } });
  await db.merchantConfig.create({ data: { orgId, returnOrigin: "http://127.0.0.1:3000", environment } });
  await db.merchantKybProfile.create({ data: { orgId, version: 1, data: json(baseProfile), fingerprint: fingerprint(baseProfile), createdBy: "test" } });
  process.env.BRIDGE_API_KEY_REF = await secretManager.put("sk-live-fictional");
  process.env.YELLOWCARD_API_KEY = "yc-key";
  process.env.YELLOWCARD_API_SECRET_REF = await secretManager.put("yc-secret");
});
after(() => db.$disconnect());
const actor = () => ({ orgId, environment, userId: "test-user" });

type Call = { base: string; method?: string; path: string; headers?: Record<string, string>; body?: string };
const reply = (status: number, body: unknown) => ({ status, headers: {}, body: JSON.stringify(body), bytes: 0 });

async function fundingPayout(status: string, txHash = `0x${randomBytes(32).toString("hex")}`) {
  return db.intentsPayout.create({
    data: {
      orgId,
      environment,
      accountId: "merchant.near",
      purpose: "payout",
      originAsset: "nep141:base-usdc",
      destinationAsset: "nep141:base-usdc",
      destinationChain: "base",
      destinationSymbol: "USDC",
      recipient: `0x${"9".repeat(40)}`,
      amountIn: "40190000",
      amountInFormatted: "40.19",
      amountOutFormatted: "40.18",
      depositAddress: `0x${randomBytes(20).toString("hex")}`,
      quote: json({}),
      payload: json({}),
      status,
      details: json({ destinationChainTxHashes: [{ hash: txHash }] }),
      createdBy: "test",
    },
  });
}

test("Bridge: verify the business, add the bank, and follow a cash out to the bank", async () => {
  const calls: Call[] = [];
  let approved = false,
    drainState: string | null = null,
    deposit = "";
  const http: Http = async (base, o) => {
    calls.push({ base, method: o.method, path: o.path, headers: o.headers, body: o.body });
    assert.equal(o.headers?.["Api-Key"], "sk-live-fictional");
    assert.equal(base, "https://api.bridge.xyz");
    if (o.path === "/v0/kyc_links" && o.method === "POST")
      return reply(200, { id: "kyc_1", kyc_link: "https://bridge.example/kyc", tos_link: "https://bridge.example/tos", kyc_status: "not_started", tos_status: "pending" });
    if (o.path === "/v0/kyc_links/kyc_1")
      return reply(200, { id: "kyc_1", kyc_link: "https://bridge.example/kyc", tos_link: "https://bridge.example/tos", kyc_status: approved ? "approved" : "under_review", tos_status: approved ? "approved" : "pending", customer_id: approved ? "cust_1" : null });
    if (o.path === "/v0/customers/cust_1/external_accounts") return reply(201, { id: "ea_1", last_4: "9123", currency: "usd" });
    if (o.path === "/v0/customers/cust_1/liquidation_addresses") return reply(201, { id: "liq_1", address: `0x${"b".repeat(40)}`, chain: "base", currency: "usdc" });
    if (o.path === "/v0/customers/cust_1/liquidation_addresses/liq_1/drains")
      return reply(200, drainState ? [{ id: "drain_1", amount: "40.18", currency: "usd", state: drainState, deposit_tx_hash: deposit, created_at: "2026-11-02T10:00:00Z" }] : []);
    return reply(404, {});
  };
  const started = await startBridgeAs(actor(), { currency: "usd" }, { http });
  assert.equal(started.account.status, "Verifying");
  assert.equal(started.account.kycUrl, "https://bridge.example/kyc");
  const kyc = JSON.parse(calls[0].body!);
  assert.deepEqual(kyc, { full_name: "Harbor Goods Ltd", email: "ada@harbor.example", type: "business" });
  assert.ok(calls[0].headers?.["Idempotency-Key"]);
  const bank = { currency: "usd", rail: "ach", bankName: "Lead Bank", accountName: "Operating", routingNumber: "101019644", accountNumber: "215268129123", checkingOrSavings: "checking" };
  await assert.rejects(addBridgeBankAs(actor(), bank, { http }), /CASHOUT_VERIFICATION_PENDING/);
  approved = true;
  const ready = await addBridgeBankAs(actor(), bank, { http });
  assert.equal(ready.account.status, "Ready");
  assert.equal(ready.account.depositAddress, `0x${"b".repeat(40)}`);
  assert.equal(ready.account.label, "Lead Bank ···9123 (USD, ACH)");
  const ea = JSON.parse(calls.find((c) => c.path.endsWith("/external_accounts"))!.body!);
  assert.equal(ea.account_owner_type, "business");
  assert.equal(ea.address.country, "GBR");
  const liq = JSON.parse(calls.find((c) => c.path.endsWith("/liquidation_addresses"))!.body!);
  assert.deepEqual(liq, { chain: "base", currency: "usdc", external_account_id: "ea_1", destination_payment_rail: "ach", destination_currency: "usd" });

  // A cash out: funding payout delivered, then Bridge drains it to the bank.
  const account = await db.fiatPayoutAccount.findFirstOrThrow({ where: { orgId, partner: "bridge" } });
  const payout = await fundingPayout("PROCESSING");
  deposit = (payout.details as { destinationChainTxHashes: { hash: string }[] }).destinationChainTxHashes[0].hash;
  const c = await db.fiatPayout.create({ data: { orgId, environment, accountId: account.id, partner: "bridge", payoutId: payout.id, amountUsd: "40.18", currency: "USD" } });
  assert.equal((await advanceCashOut(c.id, { http })).status, "Funding");
  await db.intentsPayout.update({ where: { id: payout.id }, data: { status: "SUCCESS" } });
  assert.equal((await advanceCashOut(c.id, { http })).status, "Converting", "no drain yet");
  drainState = "payment_submitted";
  assert.equal((await advanceCashOut(c.id, { http })).status, "Converting");
  drainState = "payment_processed";
  const paid = await advanceCashOut(c.id, { http });
  assert.equal(paid.status, "Paid");
  assert.equal(paid.partnerRef, "drain_1");
  // A payout that never arrived fails the cash out, before any partner call.
  const failed = await fundingPayout("REFUNDED");
  const c2 = await db.fiatPayout.create({ data: { orgId, environment, accountId: account.id, partner: "bridge", payoutId: failed.id, amountUsd: "10.00", currency: "USD" } });
  assert.equal((await advanceCashOut(c2.id, { http })).status, "Failed");
});

test("Yellow Card: save a mobile money account, then send once the USDC has arrived", async () => {
  const calls: Call[] = [];
  let sent: Record<string, unknown> | null = null;
  let state = "process";
  const http: Http = async (base, o) => {
    calls.push({ base, method: o.method, path: o.path, headers: o.headers, body: o.body });
    assert.equal(base, "https://api.yellowcard.io");
    // Every request is signed as Yellow Card documents.
    const ts = o.headers!["X-YC-Timestamp"];
    assert.equal(o.headers!.Authorization, `YcHmacV1 yc-key:${ycSignature("yc-secret", ts, o.path.split("?")[0], o.method!, o.body)}`);
    if (o.path === "/business/networks?country=KE")
      return reply(200, { networks: [{ id: "net-mpesa", name: "M-Pesa", country: "KE", status: "active", channelType: "momo" }, { id: "net-old", name: "Old", country: "KE", status: "inactive", channelType: "bank" }] });
    if (o.path.startsWith("/business/send/sequence-id/"))
      return sent ? reply(200, { ...sent, id: "send_1", status: state, convertedAmount: 5190.5, rate: 129.18, ...(state === "failed" ? { errorCode: "NAME_MISMATCH" } : {}) }) : reply(404, { code: "NotFound" });
    if (o.path === "/business/send" && o.method === "POST") {
      sent = JSON.parse(o.body!);
      return reply(201, { ...sent, id: "send_1", status: "process", convertedAmount: 5190.5, rate: 129.18 });
    }
    return reply(404, {});
  };
  const { networks } = await yellowCardNetworksAs(actor(), { country: "KE" }, { http });
  assert.deepEqual(networks, [{ id: "net-mpesa", name: "M-Pesa", channelType: "momo" }]);
  const saved = await setYellowCardAs(actor(), { country: "KE", currency: "KES", channelType: "momo", networkId: "net-mpesa", networkName: "M-Pesa", accountNumber: "+254700123456", accountName: "Harbor Goods" });
  assert.equal(saved.account.label, "M-Pesa ···3456 (KES)");
  const account = await db.fiatPayoutAccount.findFirstOrThrow({ where: { orgId, partner: "yellowcard" } });
  assert.ok(account.destinationRef && !JSON.stringify(account).includes("254700123456"), "account details are kept in the vault");

  const payout = await fundingPayout("SUCCESS");
  const c = await db.fiatPayout.create({ data: { orgId, environment, accountId: account.id, partner: "yellowcard", payoutId: payout.id, amountUsd: "40.18", currency: "KES" } });
  assert.equal((await advanceCashOut(c.id, { http })).status, "Converting");
  assert.deepEqual(
    { sequenceId: sent!.sequenceId, amount: sent!.amount, currency: sent!.currency, country: sent!.country, channelType: sent!.channelType, forceAccept: sent!.forceAccept, customerType: sent!.customerType },
    { sequenceId: c.id, amount: 40.18, currency: "KES", country: "KE", channelType: "momo", forceAccept: true, customerType: "institution" },
  );
  assert.deepEqual(sent!.destination, { accountNumber: "+254700123456", accountName: "Harbor Goods", accountType: "momo", networkId: "net-mpesa", networkName: "M-Pesa", country: "KE" });
  assert.equal((sent!.sender as { businessName: string }).businessName, "Harbor Goods Ltd");
  // Followed by its sequence ID; never sent twice.
  state = "complete";
  const paid = await advanceCashOut(c.id, { http });
  assert.equal(paid.status, "Paid");
  assert.equal(paid.localAmount, "5190.5");
  assert.equal(calls.filter((x) => x.path === "/business/send").length, 1);

  // A send Yellow Card fails after the USDC arrived needs operations.
  const p2 = await fundingPayout("SUCCESS");
  const c2 = await db.fiatPayout.create({ data: { orgId, environment, accountId: account.id, partner: "yellowcard", payoutId: p2.id, amountUsd: "12.00", currency: "KES" } });
  sent = null;
  state = "failed";
  await advanceCashOut(c2.id, { http });
  const attention = await advanceCashOut(c2.id, { http });
  assert.equal(attention.status, "Needs attention");
  assert.equal(attention.failure, "Yellow Card: NAME_MISMATCH");
});
