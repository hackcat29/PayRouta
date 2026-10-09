import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { db } from "../../lib/portal/db";
import { json } from "../../lib/portal/service";
import {
  createIntent,
  createSession,
  methods,
  selectMethod,
  confirm,
  customerAction,
  progress,
  authorizeSession,
} from "../../lib/payments/service";
import { applyFact } from "../../lib/payments/processing";
import { hash } from "../../lib/payments/contracts";
import { databaseDepositStore } from "../../lib/blockchain/deposit-store";
import { POST as providerEvent } from "../../app/api/payments/provider/[id]/route";
import { GET, POST } from "../../app/api/v1/[...path]/route";
let orgId: string, integrationId: string, secret: string;
const address = `0x${randomBytes(20).toString("hex")}`,
  asset = {
    kind: "blockchain",
    network: "eip155:84532",
    identifier: "erc20:0x036cbd53842c5426634e7929541ec2318f3dcf7e",
  };
const input = {
  reference: "Stablecoin regression",
  amount: "1.000000",
  precision: 6,
  asset,
  settlement: asset,
  methods: ["stablecoin"],
  returnUrl: "http://127.0.0.1:3000/",
};
before(async () => {
  if (
    process.env.PORTAL_MODE !== "local" ||
    !process.env.DATABASE_URL?.includes("127.0.0.1:55432/payrouta")
  )
    throw new Error("Isolated local database required");
  orgId = `stablecoin-test-${randomUUID()}`;
  await db.organization.create({
    data: { id: orgId, name: "Fictional stablecoin tests", fictional: true },
  });
  await db.merchantConfig.create({
    data: { orgId, returnOrigin: "http://127.0.0.1:3000" },
  });
  integrationId = (
    await db.integration.create({
      data: {
        orgId,
        environment: "sandbox",
        version: 1,
        config: json({
          mode: "NATIVE",
          adapter: "erc20-deposit",
          environment: "sandbox",
          network: asset.network,
          identifier: asset.identifier,
          addresses: [address],
          publicTestnetRpc: true,
          accountId: "test-pool",
        }),
      },
    })
  ).id;
  secret = `pr_sandbox_${randomBytes(32).toString("base64url")}`;
  await db.merchantApiKey.create({
    data: {
      orgId,
      environment: "sandbox",
      prefix: secret.slice(0, 22),
      verifier: hash(secret),
      permissions: ["payments:read", "payments:write", "configuration:read"],
    },
  });
});
after(() => db.$disconnect());
async function call(method: string, path: string, body?: unknown) {
  const request = new Request("http://127.0.0.1:3000/api/v1/" + path, {
    method,
    headers: {
      authorization: `Bearer ${secret}`,
      "payrouta-environment": "sandbox",
      "idempotency-key": randomUUID(),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return (method === "GET" ? GET : POST)(request, {
    params: Promise.resolve({ path: path.split("/") }),
  });
}
test("public API permits on-chain payments and exposes seven coming-soon categories", async () => {
  const no = await call("POST", "payment-intents", {
    ...input,
    methods: ["card"],
  });
  assert.equal(no.status, 409);
  const yes = await call("POST", "payment-intents", input);
  assert.equal(yes.status, 201, await yes.clone().text());
  const intent = await yes.json();
  const available = await call("GET", `available-methods/${intent.id}`);
  assert.equal(available.status, 200, await available.clone().text());
  const m = await available.json();
  assert.equal(
    m.methods.filter((x: { status: string }) => x.status === "COMING_SOON")
      .length,
    7,
  );
  assert.equal(
    m.methods.find((x: { method: string }) => x.method === "stablecoin").status,
    "AVAILABLE",
  );
  const config = await call("GET", "configuration");
  assert.equal(config.status, 200, await config.clone().text());
  const c = await config.json();
  assert.deepEqual(c.permittedMethods, ["stablecoin", "crypto-app"]);
  assert.equal(c.comingSoonMethods.length, 7);
  assert.equal(c.liveExecutionEnabled, false);
});
test("intent ownership, address binding, cursor, pool exhaustion and forged confirmation fail closed", async () => {
  const intent = await createIntent(orgId, randomUUID(), input),
    session = await createSession(orgId, intent.id);
  await methods(session.sessionId, session.token);
  await assert.rejects(
    selectMethod(session.sessionId, session.token, "bank-transfer"),
    /COMING_SOON/,
  );
  const route = await selectMethod(
    session.sessionId,
    session.token,
    "stablecoin",
  );
  assert.equal(route.providerFeeMinor, "0");
  const attempts = await Promise.all([
    confirm(session.sessionId, session.token, route.routeId),
    confirm(session.sessionId, session.token, route.routeId),
  ]);
  assert.equal(attempts[0].attemptId, attempts[1].attemptId);
  const attempt = await db.paymentAttempt.findUniqueOrThrow({
    where: { id: attempts[0].attemptId },
  });
  const store = databaseDepositStore(integrationId),
    binding = await store.allocate({
      attemptId: attempt.id,
      attemptKey: attempt.key,
      environment: "sandbox",
      network: asset.network,
      identifier: asset.identifier,
      amount: input.amount,
      precision: 6,
      startBlock: 100n,
      addresses: [address],
    });
  assert.equal(binding.address, address);
  const afterExpiry = new Date(intent.expiresAt.getTime() + 60000);
  assert.equal(
    (await progress(session.sessionId, session.token, afterExpiry)).state,
    "Processing",
  );
  await assert.rejects(
    authorizeSession(session.sessionId, session.token, afterExpiry),
    /EXPIRED/,
  );
  await assert.rejects(
    authorizeSession(session.sessionId, "invalid", afterExpiry, true),
    /UNAUTHORIZED/,
  );
  await assert.rejects(
    authorizeSession(
      session.sessionId,
      session.token,
      new Date(intent.expiresAt.getTime() + 86400001),
      true,
    ),
    /EXPIRED/,
  );
  assert.equal(await store.scanStart!(binding), 100n);
  await store.advanceScan!(binding, 200n);
  await store.advanceScan!(binding, 150n);
  assert.equal(await store.scanStart!(binding), 200n);
  await assert.rejects(
    databaseDepositStore("foreign-integration").find(attempt.id),
    /BINDING_MISMATCH/,
  );
  await assert.rejects(
    db.depositBinding.update({
      where: { attemptId: attempt.id },
      data: { address: `0x${"d".repeat(40)}` },
    }),
    /immutable/,
  );
  await assert.rejects(
    applyFact(attempt.id, {
      state: "Confirmed",
      reference: "forged",
      amount: input.amount,
      asset,
    }),
    /FINALIZED_EVIDENCE_REQUIRED/,
  );
  await assert.rejects(customerAction(session.sessionId, session.token));
  assert.equal(
    (await db.paymentIntent.findUniqueOrThrow({ where: { id: intent.id } }))
      .state,
    "Processing",
  );
  const incoming = await providerEvent(
    new Request(
      "http://127.0.0.1:3000/api/payments/provider/" + integrationId,
      {
        method: "POST",
        body: JSON.stringify({
          type: "payment.status",
          state: "Confirmed",
          amount: input.amount,
          asset,
        }),
      },
    ),
    { params: Promise.resolve({ id: integrationId }) },
  );
  assert.equal(incoming.status, 409);
  const next = await createIntent(orgId, randomUUID(), input),
    s = await createSession(orgId, next.id);
  const m = await methods(s.sessionId, s.token);
  assert.equal(
    m.methods.find((m) => m.method === "stablecoin")?.status,
    "UNAVAILABLE",
  );
  await assert.rejects(
    selectMethod(s.sessionId, s.token, "stablecoin"),
    /NOT_AVAILABLE/,
  );
});
