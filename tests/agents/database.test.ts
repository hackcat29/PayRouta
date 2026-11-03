// Agentic payments against the local database: an AI agent pays a crypto
// checkout within its key's limits, the agent API answers 402 for a
// payment link, and the MCP server acts with a merchant API key.
import "dotenv/config";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { db } from "../../lib/portal/db";
import { atomic, json } from "../../lib/portal/service";
import { event } from "../../lib/payments/service";
import { workOnce } from "../../lib/portal/worker";
import { createPlan, createSubscription, getSubscription } from "../../lib/subscriptions/service";
import { hash } from "../../lib/payments/contracts";
import { createCryptoCheckout } from "../../lib/payments/crypto-checkout";
import { newSlug } from "../../lib/merchant/payment-links";
import { describe, pay } from "../../lib/agents/checkout";
import { POST as mcp } from "../../app/api/mcp/route";
import { GET as agentGet } from "../../app/api/agent/v1/[...path]/route";

const usdc = { network: "eip155:84532", identifier: "erc20:0x036cbd53842c5426634e7929541ec2318f3dcf7e" };
let orgId: string, apiSecret: string, refundSecret: string;

before(async () => {
  if (process.env.PORTAL_MODE !== "local" || !process.env.DATABASE_URL?.includes("127.0.0.1:55432/payrouta"))
    throw new Error("Isolated local database required");
  orgId = `agents-${randomUUID()}`;
  await db.organization.create({ data: { id: orgId, name: "Fictional agent store", fictional: true } });
  await db.merchantConfig.create({ data: { orgId, returnOrigin: "http://127.0.0.1:3000" } });
  await db.integration.create({
    data: {
      orgId,
      environment: "sandbox",
      version: 1,
      config: json({
        mode: "NATIVE",
        adapter: "erc20-deposit",
        environment: "sandbox",
        ...usdc,
        publicRpc: true,
        addresses: Array.from({ length: 10 }, () => `0x${randomBytes(20).toString("hex")}`),
        accountId: "fictional-agent-stable",
      }),
    },
  });
  const key = async (permissions: string[]) => {
    const secret = `pr_sandbox_${randomBytes(32).toString("base64url")}`;
    await db.merchantApiKey.create({ data: { orgId, environment: "sandbox", prefix: secret.slice(0, 22), verifier: hash(secret), permissions } });
    return secret;
  };
  apiSecret = await key(["payments:read", "payments:write"]);
  refundSecret = await key(["payments:read", "refunds:write"]);
});
after(() => db.$disconnect());

const market = async () => ({ "usd-coin": { usd: "1.00", source: "CoinGecko" as const, updatedAt: new Date().toISOString() } });
async function checkout(usdAmount = "40.00") {
  const c = await createCryptoCheckout(orgId, "sandbox", randomUUID(), { reference: "Agent order", payerCountry: "NG", usdAmount, options: [usdc] }, market);
  return { id: c.id, token: c.checkoutPath.split("#")[1] };
}
async function agentKey(over: { budgetMinor?: string; perPaymentMinor?: string; merchants?: string[] } = {}) {
  return db.agentKey.create({
    data: {
      orgId,
      environment: "sandbox",
      name: "Test agent",
      prefix: "pra_sandbox_test",
      verifier: hash(randomUUID()),
      budgetMinor: over.budgetMinor ?? "10000",
      period: "week",
      perPaymentMinor: over.perPaymentMinor ?? "5000",
      merchants: json(over.merchants ?? []),
      createdBy: "test",
    },
  });
}
// The worker would issue instructions; here the attempt gets its receive
// address directly, so no RPC node is needed.
const dispatch = async (attemptId: string) => {
  const a = await db.paymentAttempt.findUniqueOrThrow({ where: { id: attemptId }, include: { intent: true } });
  await db.paymentAttempt.update({
    where: { id: attemptId },
    data: {
      state: "Requires action",
      action: json({ kind: "deposit", provider: "PayRouta", text: "Send USDC", address: `0x${"ab".repeat(20)}`, ...usdc, amount: a.intent.amount, symbol: "USDC" }),
    },
  });
};

test("an agent sees what it can pay with, then gets the exact transfer to make", async () => {
  const c = await checkout();
  const seen = await describe(c.id, c.token);
  assert.equal(seen.usdAmount, "40.00");
  assert.equal(seen.testMode, true);
  const direct = seen.payWith!.flatMap((n) => n.tokens).find((t) => t.symbol === "USDC")!;
  assert.equal(direct.route, "direct");
  const paid = (await pay(c.id, c.token, { token: direct.token, from: "wallet" }, null, new Date(), { dispatch })) as {
    kind: string;
    address: string;
    amount: string;
    network: string;
  };
  assert.equal(paid.kind, "transfer");
  assert.equal(paid.address, `0x${"ab".repeat(20)}`);
  assert.equal(paid.network, usdc.network);
  // Paying again returns the same instructions rather than a second attempt.
  const again = (await pay(c.id, c.token, { token: direct.token, from: "wallet" }, null, new Date(), { dispatch })) as { address: string };
  assert.equal(again.address, paid.address);
  assert.equal(await db.paymentAttempt.count({ where: { intent: { id: (await db.checkoutSession.findUniqueOrThrow({ where: { id: c.id } })).intentId } } }), 1);
  // Intents payments need mainnet.
  const fresh = await checkout();
  await assert.rejects(pay(fresh.id, fresh.token, { token: direct.token, from: "intents", payer: "agent.near" }, null, new Date(), { dispatch }), /CROSS_CHAIN_LIVE_ONLY/);
});

test("an agent key holds the agent to its merchants, per-payment cap and budget", async () => {
  const token = async (c: { id: string; token: string }) => (await describe(c.id, c.token)).payWith!.flatMap((n) => n.tokens)[0].token;
  const other = await agentKey({ merchants: ["somebody-else"] });
  const c1 = await checkout();
  await assert.rejects(pay(c1.id, c1.token, { token: await token(c1), from: "wallet" }, other, new Date(), { dispatch }), /AGENT_MERCHANT_NOT_ALLOWED/);
  const key = await agentKey({ budgetMinor: "10000", perPaymentMinor: "5000" });
  const big = await checkout("60.00");
  await assert.rejects(pay(big.id, big.token, { token: await token(big), from: "wallet" }, key, new Date(), { dispatch }), /AGENT_PAYMENT_OVER_LIMIT/);
  const a = await checkout("40.00"),
    b = await checkout("40.00"),
    c = await checkout("40.00");
  await pay(a.id, a.token, { token: await token(a), from: "wallet" }, key, new Date(), { dispatch });
  await pay(b.id, b.token, { token: await token(b), from: "wallet" }, key, new Date(), { dispatch });
  await assert.rejects(pay(c.id, c.token, { token: await token(c), from: "wallet" }, key, new Date(), { dispatch }), /AGENT_BUDGET_EXCEEDED/);
  // A checkout that ends unpaid gives its reservation back.
  const intentA = (await db.checkoutSession.findUniqueOrThrow({ where: { id: a.id } })).intentId;
  await db.paymentIntent.update({ where: { id: intentA }, data: { state: "Rejected" } });
  await pay(c.id, c.token, { token: await token(c), from: "wallet" }, key, new Date(), { dispatch });
  const spends = await db.agentSpend.findMany({ where: { keyId: key.id }, orderBy: { createdAt: "asc" } });
  assert.deepEqual(
    spends.map((s) => [s.amountMinor.toFixed(0), s.state]),
    [
      ["4000", "Released"],
      ["4000", "Reserved"],
      ["4000", "Reserved"],
    ],
  );
});

test("a payment link answers agents with 402 Payment Required and how to pay", async () => {
  const link = await db.paymentLink.create({
    data: { orgId, environment: "sandbox", slug: newSlug(), title: "API credits", amount: "25.00", currency: "USD", methods: [], crypto: true, country: "NG", createdBy: "test" },
  });
  const response = await agentGet(new NextRequest(`http://127.0.0.1:3000/api/agent/v1/links/${link.slug}`), { params: Promise.resolve({ path: ["links", link.slug] }) });
  assert.equal(response.status, 402);
  const terms = await response.json();
  assert.equal(terms.amount, "25.00");
  assert.equal(terms.merchant, "Fictional agent store");
  assert.deepEqual(terms.accepts.map((a: { method: string }) => a.method), ["wallet"], "intents payments are mainnet only");
  assert.deepEqual(terms.checkout.body, { link: link.slug });
});

async function rpc(secret: string | null, method: string, params?: object) {
  const response = await mcp(
    new Request("http://127.0.0.1:3000/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", ...(secret ? { authorization: `Bearer ${secret}` } : {}) },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) }),
    }),
  );
  return { status: response.status, body: await response.json() };
}

test("MCP: a merchant's assistant creates and lists payment links with an API key", async () => {
  assert.equal((await rpc(null, "tools/list")).status, 401);
  const init = await rpc(apiSecret, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
  assert.equal(init.body.result.protocolVersion, "2025-06-18");
  const created = await rpc(apiSecret, "tools/call", {
    name: "create_payment_link",
    arguments: { title: "Consulting hour", amount: "80", currency: "USD", country: "NG", crypto: true },
  });
  assert.equal(created.body.result.isError, undefined, JSON.stringify(created.body));
  assert.match(created.body.result.structuredContent.url, /^http:\/\/127\.0\.0\.1:3000\/pay\/[A-Za-z0-9]{10}$/);
  const listed = await rpc(apiSecret, "tools/call", { name: "list_payment_links", arguments: {} });
  assert.ok(listed.body.result.structuredContent.links.some((l: { title: string; amount: string }) => l.title === "Consulting hour" && l.amount === "80.00"));
  const payments = await rpc(apiSecret, "tools/call", { name: "list_payments", arguments: { limit: 5 } });
  assert.ok(Array.isArray(payments.body.result.structuredContent.data));
  // Refunds need refunds:write; with it, an unknown payment is reported as such.
  const refused = await rpc(apiSecret, "tools/call", { name: "refund_payment", arguments: { id: "pi_missing" } });
  assert.match(refused.body.result.content[0].text, /refunds:write/);
  const missing = await rpc(refundSecret, "tools/call", { name: "refund_payment", arguments: { id: "pi_missing" } });
  assert.equal(missing.body.result.isError, true);
  assert.match(missing.body.result.content[0].text, /^PAYMENT_NOT_FOUND/);
});

test("MCP: a buyer's agent pays a payment link with its agent key, and sees what it spent", async () => {
  const secret = `pra_sandbox_${randomBytes(32).toString("base64url")}`;
  await db.agentKey.create({
    data: {
      orgId,
      environment: "sandbox",
      name: "Procurement agent",
      prefix: secret.slice(0, 22),
      verifier: hash(secret),
      budgetMinor: "10000",
      period: "month",
      perPaymentMinor: "5000",
      merchants: json([]),
      createdBy: "test",
    },
  });
  const tools = await rpc(secret, "tools/list");
  const names = tools.body.result.tools.map((t: { name: string }) => t.name);
  assert.deepEqual(names, ["get_payment_terms", "open_checkout", "pay_checkout", "submit_signed_intent", "get_checkout_status", "get_spending"]);
  assert.ok(!names.includes("refund_payment"), "an agent key gets no merchant tools");
  // A merchant tool by name is unknown to an agent key.
  assert.equal((await rpc(secret, "tools/call", { name: "create_payment_link", arguments: {} })).body.error.code, -32602);

  const link = await db.paymentLink.create({
    data: { orgId, environment: "sandbox", slug: newSlug(), title: "Dataset licence", amount: "30.00", currency: "USD", methods: [], crypto: true, country: "NG", createdBy: "test" },
  });
  const url = `http://127.0.0.1:3000/pay/${link.slug}`;
  const terms = await rpc(secret, "tools/call", { name: "get_payment_terms", arguments: { url } });
  assert.equal(terms.body.result.structuredContent.amount, "30.00");
  const opened = await rpc(secret, "tools/call", { name: "open_checkout", arguments: { url } });
  assert.equal(opened.body.result.isError, undefined, JSON.stringify(opened.body));
  const { checkout, checkoutToken, payWith } = opened.body.result.structuredContent;
  assert.ok(checkoutToken && !("token" in opened.body.result.structuredContent));
  const asset = payWith.flatMap((n: { tokens: { token: string; symbol: string }[] }) => n.tokens).find((t: { symbol: string }) => t.symbol === "USDC").token;
  const paid = await rpc(secret, "tools/call", { name: "pay_checkout", arguments: { checkout, checkoutToken, asset, from: "wallet" } });
  assert.equal(paid.body.result.isError, undefined, JSON.stringify(paid.body));
  assert.equal(paid.body.result.structuredContent.kind, "transfer");
  // The USD price in USDC at the observed market price.
  assert.ok(Math.abs(Number(paid.body.result.structuredContent.amount) - 30) < 0.5);

  const spending = (await rpc(secret, "tools/call", { name: "get_spending", arguments: {} })).body.result.structuredContent;
  assert.equal(spending.spentMinor, "3000", "reserved against the budget while it's paid");
  assert.equal(spending.budgetMinor, "10000");
  assert.deepEqual(
    spending.payments.map((p: { merchant: string; for: string; amountMinor: string; state: string }) => [p.merchant, p.for, p.amountMinor, p.state]),
    [["Fictional agent store", "Dataset licence", "3000", "Pending"]],
  );
  // A revoked key stops at once.
  await db.agentKey.update({ where: { verifier: hash(secret) }, data: { revokedAt: new Date() } });
  assert.equal((await rpc(secret, "tools/list")).status, 401);
});

test("subscriptions: a crypto invoice is paid by an agent over MCP, and its confirmation marks the invoice paid", async () => {
  const plan = await createPlan({ orgId, environment: "sandbox" }, { name: "Data feed", amount: "12", currency: "USD", interval: "month", crypto: true }, "test");
  const sub = await createSubscription({ orgId, environment: "sandbox" }, { plan: plan.id, customer: { email: "agent-buyer@example.com" } }, "test");
  const invoiceUrl = sub.latestInvoice!.url;
  const secret = `pra_sandbox_${randomBytes(32).toString("base64url")}`;
  await db.agentKey.create({
    data: { orgId, environment: "sandbox", name: "Subscriber agent", prefix: secret.slice(0, 22), verifier: hash(secret), budgetMinor: "5000", period: "month", perPaymentMinor: "2000", merchants: json([]), createdBy: "test" },
  });
  const terms = (await rpc(secret, "tools/call", { name: "get_payment_terms", arguments: { url: invoiceUrl } })).body.result.structuredContent;
  assert.equal(terms.amount, "12.00");
  assert.deepEqual(terms.accepts.map((a: { method: string }) => a.method), ["wallet"]);
  const opened = (await rpc(secret, "tools/call", { name: "open_checkout", arguments: { url: invoiceUrl } })).body.result.structuredContent;
  const session = await db.checkoutSession.findUniqueOrThrow({ where: { id: opened.checkout }, include: { intent: true } });
  assert.equal((session.intent.metadata as { subscription_invoice?: string }).subscription_invoice, sub.latestInvoice!.id, "the crypto side knows its invoice");
  const asset = opened.payWith.flatMap((n: { tokens: { token: string; symbol: string }[] }) => n.tokens).find((t: { symbol: string }) => t.symbol === "USDC").token;
  const paid = await rpc(secret, "tools/call", { name: "pay_checkout", arguments: { checkout: opened.checkout, checkoutToken: opened.checkoutToken, asset, from: "wallet" } });
  assert.equal(paid.body.result.structuredContent.kind, "transfer");
  // The chain confirms the transfer (the deposit scanner's job): the
  // confirmed payment marks the invoice paid and the subscription active.
  await db.paymentIntent.update({ where: { id: session.intentId }, data: { state: "Confirmed" } });
  await atomic((tx) => event(tx, session.intentId, "payment.confirmed"));
  const job = await db.job.findFirstOrThrow({ where: { key: `subscription-paid:${sub.latestInvoice!.id}:${session.intentId}` } });
  await workOnce(job.key);
  const after = await getSubscription({ orgId, environment: "sandbox" }, sub.id);
  assert.equal(after.state, "Active");
  assert.equal(after.invoices[0].state, "Paid");
  const spending = (await rpc(secret, "tools/call", { name: "get_spending", arguments: {} })).body.result.structuredContent;
  assert.deepEqual(
    spending.payments.map((p: { for: string; amountMinor: string; state: string }) => [p.for, p.amountMinor, p.state]),
    [["Invoice 1 · Data feed", "1200", "Paid"]],
  );
});
