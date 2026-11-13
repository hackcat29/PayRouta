// NEAR AI Agent Market (lib/agents/agent-market.ts): hiring a listed agent
// over x402 within a cap, and PayRouta's own agent working its assignments.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { PaymentRequirements } from "@x402/core/types";
import { acceptable, hire, integrationPlan, work } from "../lib/agents/agent-market";

const usdc = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const row = (over: Partial<PaymentRequirements> = {}): PaymentRequirements => ({
  scheme: "exact",
  network: "near:mainnet",
  asset: usdc,
  amount: "2500000",
  payTo: "market-treasury.near",
  maxTimeoutSeconds: 4200,
  extra: {},
  ...over,
});

test("Agent Market: pays only USDC on NEAR, within the cap", () => {
  assert.equal(acceptable([row()], 3_000_000n).amount, "2500000");
  assert.throws(() => acceptable([row()], 2_000_000n), /over your cap of 2 USDC/);
  assert.throws(() => acceptable([row({ asset: "wrap.near" })], 3_000_000n), /not USDC on NEAR/);
  assert.throws(() => acceptable([row({ network: "eip155:8453" })], 3_000_000n), /doesn't take x402 payments on NEAR/);
});

test("Agent Market: hiring sends the task, pays the quoted row, and returns the result", async () => {
  const calls: { url: string; headers: Record<string, string>; body: { method: string } }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    const body = JSON.parse(String(init.body));
    calls.push({ url, headers, body });
    if (body.method === "SendMessage" && !headers["X-PAYMENT"]) return Response.json({ x402Version: 2, accepts: [row()] }, { status: 402 });
    if (body.method === "SendMessage") return Response.json({ result: { task: { id: "t1", status: { state: "TASK_STATE_WORKING" } } } });
    return Response.json({ result: { id: "t1", status: { state: "TASK_STATE_COMPLETED" }, artifacts: [{ parts: [{ text: "The report." }] }] } });
  }) as unknown as typeof fetch;
  const signer = { createSignedDelegateAction: async () => "c2lnbmVk" };
  const out = await hire({ handle: "qadri-research", task: "Research X", maxAmount: 3_000_000n, signer }, f, async () => {});
  assert.deepEqual(out, { taskId: "t1", state: "TASK_STATE_COMPLETED", paid: "2.5 USDC", result: "The report." });
  assert.equal(calls[0].url, "https://qadri-research.market.near.ai/a2a/v1");
  const payment = JSON.parse(Buffer.from(calls[1].headers["X-PAYMENT"], "base64").toString());
  assert.deepEqual(payment, { x402Version: 2, accepted: row(), payload: { signedDelegateAction: "c2lnbmVk" } });
  assert.equal(calls[2].body.method, "GetTask");
});

test("Agent Market: a price over the cap is refused before anything is signed", async () => {
  let signed = false;
  const f = (async () => Response.json({ x402Version: 2, accepts: [row({ amount: "50000000" })] }, { status: 402 })) as unknown as typeof fetch;
  const signer = {
    createSignedDelegateAction: async () => {
      signed = true;
      return "x";
    },
  };
  await assert.rejects(hire({ handle: "pricey", task: "x", maxAmount: 5_000_000n, signer }, f), /over your cap/);
  assert.equal(signed, false);
});

test("Agent Market: the integration plan fits the brief", () => {
  const woo = integrationPlan("I run a WooCommerce shop selling fabric in Lagos");
  assert.match(woo, /## WooCommerce/);
  assert.doesNotMatch(woo, /## Shopify/);
  assert.match(integrationPlan("Our AI agent buys API credits; can it pay with x402?"), /## AI agents/);
  const vague = integrationPlan("I sell paintings on Instagram");
  assert.match(vague, /## No website \(payment links\)/);
  assert.match(vague, /https:\/\/payrouta\.com\/checkout\/demo/);
  assert.match(integrationPlan("Shopify store", "Please add the webhook part"), /Your feedback: “Please add the webhook part”/);
});

test("Agent Market: the worker starts new hires, answers change requests, and leaves the rest", async () => {
  const assignment = (id: string, status: string, startedAt: string | null, submittedAt: string | null, body?: string) => ({
    assignment: { assignmentId: id, status, startedAt, submittedAt },
    job: { title: "Crypto checkout", description: "Add crypto to my Shopify store" },
    latestMessage: body ? { body } : null,
  });
  const posts: { url: string; body?: { deliverableMarkdown: string } }[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    if (url.endsWith("/v1/agents/me/assignments"))
      return Response.json({
        assignments: [
          assignment("new", "in_progress", null, null),
          assignment("revise", "in_progress", "2026-11-13T10:00:00Z", "2026-11-13T10:05:00Z", "Mention refunds"),
          assignment("waiting", "submitted", "2026-11-13T10:00:00Z", "2026-11-13T10:05:00Z"),
        ],
      });
    posts.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return Response.json({});
  }) as unknown as typeof fetch;
  assert.deepEqual(await work("aat_test", f), ["new", "revise"]);
  assert.deepEqual(
    posts.map((p) => p.url.replace("https://market.near.ai", "")),
    ["/v1/assignments/new/start", "/v1/assignments/new/submit", "/v1/assignments/revise/submit"],
  );
  assert.match(posts[1].body!.deliverableMarkdown, /## Shopify/);
  assert.match(posts[2].body!.deliverableMarkdown, /Mention refunds/);
});
