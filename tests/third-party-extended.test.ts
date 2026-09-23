import test from "node:test";
import assert from "node:assert/strict";
import { DiditAdapter, type DiditHttp } from "../lib/compliance/didit";
import { MonnifyIdentityAdapter, type MonnifyIdentityHttp } from "../lib/compliance/monnify-identity";
import { AlchemyRpcProvider, alchemyNetworkUrl } from "../lib/blockchain/alchemy";
import type { RpcHttp } from "../lib/blockchain/rpc";
import {
  PostHogAnalytics,
  sanitizeAnalyticsPayload,
} from "../lib/analytics/posthog";
import { BetterStackLogger } from "../lib/observability/betterstack";

test("DiditAdapter fails closed without API key", async () => {
  const adapter = new DiditAdapter({}, async () => ({ status: 200, headers: {}, body: "{}" }));
  await assert.rejects(
    adapter.verifyIndividual({ country: "NG", name: "Alice" }),
    /DIDIT_CREDENTIALS_NOT_CONFIGURED/,
  );
  await assert.rejects(
    adapter.verifyBusiness({ country: "NG", name: "Acme Ltd" }),
    /DIDIT_CREDENTIALS_NOT_CONFIGURED/,
  );
  await assert.rejects(
    adapter.screenEntity({ name: "Bob" }),
    /DIDIT_CREDENTIALS_NOT_CONFIGURED/,
  );
  await assert.rejects(
    adapter.screenWallet({ network: "eip155:8453", address: "0x123" }),
    /DIDIT_CREDENTIALS_NOT_CONFIGURED/,
  );
  await assert.rejects(
    adapter.monitor({ amount: "500.00", asset: "USDC" }),
    /DIDIT_CREDENTIALS_NOT_CONFIGURED/,
  );
});

test("DiditAdapter normalizes responses for KYC, KYB, and AML screening", async () => {
  const calls: { url: string; body?: string }[] = [];
  const http: DiditHttp = async (url, options) => {
    calls.push({ url, body: options.body });
    if (url.includes("/kyc/verify")) {
      return {
        status: 200,
        headers: {},
        body: JSON.stringify({
          status: "approved",
          id: "didit_kyc_01",
        }),
      };
    }
    if (url.includes("/kyb/verify")) {
      return {
        status: 200,
        headers: {},
        body: JSON.stringify({
          status: "approved",
          id: "didit_kyb_01",
        }),
      };
    }
    if (url.includes("/aml/screen")) {
      return {
        status: 200,
        headers: {},
        body: JSON.stringify({
          status: "flagged",
          matches: [{ category: "pep" }],
        }),
      };
    }
    if (url.includes("/crypto/screen")) {
      return {
        status: 200,
        headers: {},
        body: JSON.stringify({
          risk_level: "high",
          alerts: ["sanctions"],
        }),
      };
    }
    if (url.includes("/monitoring/transaction")) {
      return {
        status: 200,
        headers: {},
        body: JSON.stringify({
          flagged: false,
          risk_score: 12,
        }),
      };
    }
    return { status: 404, headers: {}, body: "{}" };
  };

  const adapter = new DiditAdapter({ apiKey: "didit_test_key" }, http);

  const kyc = await adapter.verifyIndividual({ country: "NG", name: "Alice" });
  assert.equal(kyc.verdict, "clear");
  assert.equal(kyc.reference, "didit_kyc_01");

  const kyb = await adapter.verifyBusiness({ country: "NG", name: "Acme Ltd" });
  assert.equal(kyb.verdict, "clear");
  assert.equal(kyb.reference, "didit_kyb_01");

  const aml = await adapter.screenEntity({ name: "Sanctioned Entity" });
  assert.equal(aml.verdict, "match");
  assert.deepEqual(aml.matches, ["pep"]);

  const wallet = await adapter.screenWallet({ network: "eip155:8453", address: "0xbad" });
  assert.equal(wallet.verdict, "match");
  assert.deepEqual(wallet.matches, ["sanctions"]);

  const tx = await adapter.monitor({ amount: "100.00", asset: "USDC" });
  assert.equal(tx.flagged, false);
  assert.equal(tx.riskScore, 12);
});

test("MonnifyIdentityAdapter enforces input formats and verifies credentials", async () => {
  const unconfigured = new MonnifyIdentityAdapter({}, async () => ({ status: 200, headers: {}, body: "{}" }));

  // Format checks before network calls
  const badBvn = await unconfigured.verifyBvn("123");
  assert.equal(badBvn.verified, false);
  assert.equal(badBvn.reference, "invalid-bvn");

  const badNin = await unconfigured.verifyNin("abc");
  assert.equal(badNin.verified, false);
  assert.equal(badNin.reference, "invalid-nin");

  const badAccount = await unconfigured.verifyBankAccount("123", "044");
  assert.equal(badAccount.verified, false);
  assert.equal(badAccount.reference, "invalid-account");

  // Valid format fails closed if credentials missing
  await assert.rejects(
    unconfigured.verifyBvn("12345678901"),
    /MONNIFY_IDENTITY_CREDENTIALS_NOT_CONFIGURED/,
  );
});

test("MonnifyIdentityAdapter authenticates and verifies valid BVN and bank account", async () => {
  const calls: string[] = [];
  const http: MonnifyIdentityHttp = async (url) => {
    calls.push(url);
    if (url.endsWith("/api/v1/auth/login")) {
      return {
        status: 200,
        headers: {},
        body: JSON.stringify({
          requestSuccessful: true,
          responseBody: { accessToken: "monnify_id_token" },
        }),
      };
    }
    if (url.includes("/api/v1/vas/bvn-details")) {
      return {
        status: 200,
        headers: {},
        body: JSON.stringify({
          requestSuccessful: true,
          responseBody: { bvn: "22233344455", matchPercentage: 95 },
        }),
      };
    }
    if (url.includes("/api/v1/disbursements/account/validate")) {
      return {
        status: 200,
        headers: {},
        body: JSON.stringify({
          requestSuccessful: true,
          responseBody: { accountName: "JOHN DOE ENTERPRISES" },
        }),
      };
    }
    return { status: 404, headers: {}, body: "{}" };
  };

  const adapter = new MonnifyIdentityAdapter(
    { apiKey: "test_key", secretKey: "test_secret" },
    http,
  );

  const bvnRes = await adapter.verifyBvn("22233344455", "John Doe");
  assert.equal(bvnRes.verified, true);
  assert.equal(bvnRes.matchRate, 95);

  const accountRes = await adapter.verifyBankAccount("0123456789", "044");
  assert.equal(accountRes.verified, true);
  assert.equal(accountRes.accountName, "JOHN DOE ENTERPRISES");
});

test("AlchemyRpcProvider configures networks and queries block number", async () => {
  assert.throws(
    () => new AlchemyRpcProvider({}),
    /ALCHEMY_API_KEY_NOT_CONFIGURED/,
  );

  assert.throws(
    () => alchemyNetworkUrl("eip155:999999", "key"),
    /ALCHEMY_UNSUPPORTED_CHAIN:eip155:999999/,
  );

  const baseMainnetUrl = alchemyNetworkUrl("eip155:8453", "alchemy_key_123");
  assert.ok(baseMainnetUrl.includes("base-mainnet.g.alchemy.com/v2/alchemy_key_123"));

  let requestedBody = "";
  const http: RpcHttp = async (_url, options) => {
    requestedBody = options.body;
    return {
      status: 200,
      headers: {},
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x12a05f" }), // 1220703
    };
  };

  const provider = new AlchemyRpcProvider({ apiKey: "alchemy_key_123", http });
  const blockNum = await provider.getBlockNumber("eip155:8453");
  assert.equal(blockNum, 1220703);
  assert.ok(requestedBody.includes("eth_blockNumber"));
});

test("PostHogAnalytics redacts sensitive fields and sends allowed events", async () => {
  const dirtyPayload = {
    amount: "100.00",
    currency: "NGN",
    cardNumber: "4111111111111111",
    cvv: "123",
    secretKey: "super_secret",
    user_bvn: "12345678901",
    nin: "98765432101",
    meta: {
      passwordHash: "hash123",
      safeNote: "Invoice #101",
    },
  };

  const sanitized = sanitizeAnalyticsPayload(dirtyPayload) as Record<string, unknown>;
  assert.equal(sanitized.amount, "100.00");
  assert.equal(sanitized.currency, "NGN");
  assert.equal(sanitized.cardNumber, undefined);
  assert.equal(sanitized.cvv, undefined);
  assert.equal(sanitized.secretKey, undefined);
  assert.equal(sanitized.user_bvn, undefined);
  assert.equal(sanitized.nin, undefined);
  assert.equal((sanitized.meta as Record<string, unknown>).passwordHash, undefined);
  assert.equal((sanitized.meta as Record<string, unknown>).safeNote, "Invoice #101");

  const holder: { captured?: { event?: string; distinct_id?: string; properties?: Record<string, unknown> } } = {};
  const client = new PostHogAnalytics({
    apiKey: "ph_test_key",
    host: "https://test.posthog.internal",
    http: async (_url, options) => {
      holder.captured = JSON.parse(options.body) as { event?: string; distinct_id?: string; properties?: Record<string, unknown> };
      return {};
    },
  });

  const res = await client.track("payment_confirmed", dirtyPayload, "merchant_123");
  assert.equal(res, true);
  assert.equal(holder.captured?.event, "payment_confirmed");
  assert.equal(holder.captured?.distinct_id, "merchant_123");
  assert.equal(holder.captured?.properties?.cardNumber, undefined);
  assert.equal(holder.captured?.properties?.amount, "100.00");

  const unconfigured = new PostHogAnalytics({});
  assert.equal(await unconfigured.track("checkout_opened"), false);
});

test("BetterStackLogger logs structured events and heartbeats safely", async () => {
  const logHolder: { body?: { message?: string; level?: string; context?: Record<string, unknown> } } = {};
  let heartbeatHit = false;

  const logger = new BetterStackLogger({
    sourceToken: "bs_token_123",
    heartbeatUrl: "https://uptime.betterstack.com/api/v1/heartbeat/hb_123",
    http: async (url, options) => {
      if (url.includes("logs.betterstack.com")) {
        logHolder.body = JSON.parse(options.body || "{}") as { message?: string; level?: string; context?: Record<string, unknown> };
      }
      if (url.includes("heartbeat")) {
        heartbeatHit = true;
      }
      return {};
    },
  });

  const logOk = await logger.log({
    level: "info",
    message: "Provider route certified",
    context: { provider: "paystack", capability: "card" },
  });

  assert.equal(logOk, true);
  assert.equal(logHolder.body?.message, "Provider route certified");
  assert.equal(logHolder.body?.level, "info");
  assert.equal(logHolder.body?.context?.provider, "paystack");

  const hbOk = await logger.heartbeat();
  assert.equal(hbOk, true);
  assert.equal(heartbeatHit, true);

  const unconfigured = new BetterStackLogger({});
  assert.equal(await unconfigured.log({ level: "info", message: "noop" }), false);
  assert.equal(await unconfigured.heartbeat(), false);
});
