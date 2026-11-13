// NEAR AI Agent Market (market.near.ai, docs/agent-market.md), both ways:
//
// Hiring. Every listed agent is an A2A server at https://<handle>.market.near.ai
// that answers an unpaid task with x402 terms (`exact` on near:mainnet, USDC)
// and does the work once paid. `hire` sends the task, checks the price against
// the caller's cap and that it is USDC on NEAR, signs the one ft_transfer
// with the x402 Foundation's NEAR client (the caller's own key; PayRouta never
// holds it), and returns the result. The marketplace holds the payment until
// the agent delivers.
//
// Working. PayRouta lists its own agent, "PayRouta Checkout": hired with a
// brief about a store, app or agent, it delivers a PayRouta integration plan
// for that stack. `work` is one pass of the self-hosted loop: read new
// assignments, declare start, submit the deliverable.
import { randomUUID } from "node:crypto";
import type { PaymentRequirements } from "@x402/core/types";
import { ExactNearScheme } from "@x402/near/exact/client";
import type { ClientNearSigner } from "@x402/near";
import { usdcOnNear } from "../x402/near";

export const marketApi = "https://market.near.ai";
type Fetch = typeof fetch;

export type MarketAgent = { handle: string; name: string; description: string; category?: string; tags?: string[] };

export async function searchAgents(query: string, f: Fetch = fetch): Promise<MarketAgent[]> {
  const r = await f(`${marketApi}/v1/agents?q=${encodeURIComponent(query)}&limit=10`, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`Agent Market search failed (${r.status})`);
  const body = (await r.json()) as { agents?: MarketAgent[] };
  return (body.agents ?? []).map(({ handle, name, description, category, tags }) => ({ handle, name, description, category, tags }));
}

const a2a = (handle: string) => {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(handle)) throw new Error("Invalid agent handle");
  return `https://${handle}.market.near.ai/a2a/v1`;
};
const message = (task: string) => ({
  jsonrpc: "2.0",
  id: 1,
  method: "SendMessage",
  params: { message: { messageId: randomUUID(), role: "ROLE_USER", parts: [{ text: task }] } },
});

type Task = { id: string; status: { state: string }; artifacts?: { parts?: { text?: string }[] }[] };
const taskText = (t: Task) => (t.artifacts ?? []).flatMap((a) => a.parts ?? []).map((p) => p.text ?? "").filter(Boolean).join("\n\n");

// The NEAR USDC row of an agent's 402, if its price is within `maxAmount`
// (atomic USDC). Anything else is refused before signing.
export function acceptable(accepts: PaymentRequirements[], maxAmount: bigint) {
  const row = accepts.find((a) => a.scheme === "exact" && a.network === "near:mainnet");
  if (!row) throw new Error("The agent doesn't take x402 payments on NEAR");
  if (row.asset !== usdcOnNear["near:mainnet"]) throw new Error(`The agent asks for ${row.asset}, not USDC on NEAR`);
  if (!/^\d+$/.test(row.amount) || BigInt(row.amount) > maxAmount)
    throw new Error(`The agent's price, ${Number(row.amount) / 1e6} USDC, is over your cap of ${Number(maxAmount) / 1e6} USDC`);
  return row;
}

export async function quote(handle: string, task: string, f: Fetch = fetch) {
  const r = await f(a2a(handle), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(message(task)) });
  if (r.status !== 402) throw new Error(`Expected 402 with the agent's price, got ${r.status}`);
  const body = (await r.json()) as { x402Version?: number; accepts?: PaymentRequirements[] };
  if (body.x402Version !== 2 || !Array.isArray(body.accepts)) throw new Error("The agent's 402 isn't x402 v2");
  return body.accepts;
}

export async function hire(
  input: { handle: string; task: string; maxAmount: bigint; signer: ClientNearSigner; waitMs?: number },
  f: Fetch = fetch,
  sleep = (ms: number) => new Promise((r) => setTimeout(r, ms)),
) {
  const row = acceptable(await quote(input.handle, input.task, f), input.maxAmount);
  const signed = await new ExactNearScheme(input.signer).createPaymentPayload(2, row);
  const header = Buffer.from(JSON.stringify({ x402Version: 2, accepted: row, payload: signed.payload })).toString("base64");
  // The same request, paid. Agent Market reads X-PAYMENT; PAYMENT-SIGNATURE is x402 v2's name.
  const r = await f(a2a(input.handle), {
    method: "POST",
    headers: { "content-type": "application/json", "X-PAYMENT": header, "PAYMENT-SIGNATURE": header },
    body: JSON.stringify(message(input.task)),
  });
  if (!r.ok) throw new Error(`The agent refused the payment (${r.status}): ${(await r.text()).slice(0, 300)}`);
  let task = ((await r.json()) as { result?: { task?: Task } }).result?.task;
  if (!task) throw new Error("No task in the agent's answer");
  const until = Date.now() + (input.waitMs ?? 600_000);
  while (["TASK_STATE_SUBMITTED", "TASK_STATE_WORKING"].includes(task.status.state) && Date.now() < until) {
    await sleep(10_000);
    const g: Response = await f(a2a(input.handle), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "GetTask", params: { id: task.id } }),
    });
    task = ((await g.json()) as { result?: Task }).result ?? task;
  }
  return { taskId: task.id, state: task.status.state, paid: `${Number(row.amount) / 1e6} USDC`, result: taskText(task) };
}

// ---- PayRouta's own listed agent ------------------------------------------

type Assignment = {
  assignment: { assignmentId: string; status: string; startedAt: string | null; submittedAt: string | null };
  job: { title: string; description: string };
  latestMessage: { body?: string } | null;
};

const site = "https://payrouta.com";
const integrations: { test: RegExp; title: string; steps: string[] }[] = [
  {
    test: /woo ?commerce|wordpress/i,
    title: "WooCommerce",
    steps: [
      "Install the PayRouta plugin for WooCommerce (WordPress → Plugins → Add New → Upload, from the PayRouta dashboard's Integrations page).",
      "Paste your PayRouta API key and webhook signing secret in WooCommerce → Settings → Payments → PayRouta.",
      "Place a test order: the checkout offers any token on any chain NEAR Intents covers, and the order is marked paid when the payment confirms.",
    ],
  },
  {
    test: /shopify/i,
    title: "Shopify",
    steps: [
      "In Shopify admin → Settings → Payments, add a manual payment method named “Pay with crypto (PayRouta)”.",
      "Connect the store in the PayRouta dashboard (Integrations → Shopify); PayRouta sends the customer a checkout for each order that chose it.",
      "When the payment confirms, PayRouta marks the Shopify order paid.",
    ],
  },
  {
    test: /\bagent|mcp|llm|ai\b|x402/i,
    title: "AI agents (agent API, MCP and x402)",
    steps: [
      "Create an agent key in the PayRouta dashboard (Developers → Agent keys) with a budget, a per-payment cap and the merchants it may pay.",
      "Point your agent at PayRouta's MCP server (https://payrouta.com/api/mcp) with that key, or call the agent API directly (GET /api/agent/v1/links/{slug} answers 402 with the terms).",
      "Any x402 client with a NEAR account can pay a live link at /api/agent/v1/x402/links/{slug} in USDC on NEAR, with no gas. For limits the agent can't bypass, pay from a PayRouta agent vault (a NEAR contract; docs/agent-vault.md).",
    ],
  },
  {
    test: /api|backend|server|next\.?js|node|python|django|rails|laravel|app/i,
    title: "Your own app (checkout API)",
    steps: [
      "Create a test-mode API key in the PayRouta dashboard (Developers → API keys).",
      "From your server, POST /api/v1/checkouts with the amount, currency and your order reference; send the customer to the returned checkout URL.",
      "Register a webhook endpoint (PUT /api/v1/webhook-endpoint) and fulfil the order on payment.confirmed. Verify the signature on every delivery.",
    ],
  },
];

// The deliverable for one brief: which PayRouta integration fits, and how.
export function integrationPlan(brief: string, feedback?: string) {
  const text = `${brief}\n${feedback ?? ""}`;
  const picked = integrations.filter((i) => i.test.test(text));
  const plans = picked.length ? picked : [integrations[integrations.length - 1], { test: /./, title: "No website (payment links)", steps: ["In the PayRouta dashboard, create a payment link with the price, and share it anywhere: chat, social, email or a QR code."] }];
  const lines = [
    "# Accept crypto with PayRouta",
    "",
    `Your brief: “${brief.trim().slice(0, 500)}”`,
    ...(feedback ? ["", `Your feedback: “${feedback.trim().slice(0, 500)}”`] : []),
    "",
    "PayRouta is a universal checkout: your customers pay with whatever token, chain or wallet they have, through NEAR Intents, and you settle in the stablecoin, chain or local currency you choose.",
    "",
    ...plans.flatMap((p) => [`## ${p.title}`, "", ...p.steps.map((s, i) => `${i + 1}. ${s}`), ""]),
    "## Try it first",
    "",
    `- A working checkout to try, no account needed: ${site}/checkout/demo`,
    `- Sign up and stay in test mode until you are ready: ${site}`,
    `- Developer docs: https://docs.payrouta.com`,
  ];
  return lines.join("\n");
}

export async function work(token: string, f: Fetch = fetch) {
  const auth = { authorization: `Bearer ${token}` };
  const r = await f(`${marketApi}/v1/agents/me/assignments`, { headers: auth });
  if (!r.ok) throw new Error(`Agent Market assignments failed (${r.status})`);
  const { assignments = [] } = (await r.json()) as { assignments?: Assignment[] };
  const done: string[] = [];
  for (const a of assignments) {
    const { assignmentId: id, status, startedAt, submittedAt } = a.assignment;
    if (status !== "in_progress") continue;
    // A new hire, or a request for changes after a submission.
    const revision = !!submittedAt;
    if (!startedAt) {
      const s = await f(`${marketApi}/v1/assignments/${id}/start`, { method: "POST", headers: auth });
      if (!s.ok) continue;
    }
    const deliverable = integrationPlan(a.job.description || a.job.title, revision ? a.latestMessage?.body : undefined);
    const sub = await f(`${marketApi}/v1/assignments/${id}/submit`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ deliverableMarkdown: deliverable }),
    });
    if (sub.ok) done.push(id);
  }
  return done;
}
