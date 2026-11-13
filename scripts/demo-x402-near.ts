// x402 on NEAR, end to end on NEAR testnet (docs/x402.md):
//
//   1. A merchant runs an x402 server: GET /report costs 0.10 pUSD, paid to
//      the merchant's NEAR account. It uses the x402 Foundation's own server
//      library and sends payments to PayRouta's facilitator API with a
//      PayRouta API key.
//   2. PayRouta's facilitator (app/api/v1/x402/[action]/route.ts, the route
//      handlers themselves) verifies the payment and its relayer submits it,
//      paying the gas.
//   3. An AI agent with a NEAR account and no NEAR to spare calls the URL
//      with @x402/fetch: it gets 402, signs a NEP-366 delegate action for one
//      ft_transfer, retries, and gets the report.
//   4. The same signed payment, sent again, is refused.
//
//   npm run portal:env && npm run portal:db && npm run db:migrate
//   npm run demo:x402-near
//
// Needs X402_NEAR_TESTNET_RELAYER(_KEY_REF) and the agent's testnet key at
// ~/.near-credentials/testnet/<X402_DEMO_PAYER>.json (default
// payrouta-agent.testnet), holding pUSD (payrouta-test-usd.testnet).
import "dotenv/config";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { randomBytes, randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { x402Client } from "@x402/core/client";
import { x402ResourceServer, HTTPFacilitatorClient } from "@x402/core/server";
import { decodePaymentResponseHeader, decodePaymentRequiredHeader } from "@x402/core/http";
import { createClientNearSigner } from "@x402/near";
import { ExactNearScheme as ClientScheme } from "@x402/near/exact/client";
import { ExactNearScheme as ServerScheme } from "@x402/near/exact/server";
import { wrapFetchWithPayment } from "@x402/fetch";
import { db } from "../lib/portal/db";
import { hash } from "../lib/payments/contracts";
import { GET, POST } from "../app/api/v1/x402/[action]/route";

if (process.env.PORTAL_MODE !== "local" || !process.env.DATABASE_URL?.includes("127.0.0.1:55432/payrouta")) {
  console.error("Local mode only: run npm run portal:env and npm run portal:db first.");
  process.exit(1);
}

const network = "near:testnet";
const token = process.env.X402_DEMO_ASSET || "payrouta-test-usd.testnet";
const merchantAccount = process.env.X402_DEMO_PAY_TO || "payrouta-merchant.testnet";
const payer = process.env.X402_DEMO_PAYER || "payrouta-agent.testnet";
const rpc = "https://rpc.testnet.fastnear.com";
const price = "100000"; // 0.10 pUSD (6 decimals)

async function balance(account: string) {
  const r = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "query",
      params: { request_type: "call_function", finality: "final", account_id: token, method_name: "ft_balance_of", args_base64: Buffer.from(JSON.stringify({ account_id: account })).toString("base64") },
    }),
  });
  const body = (await r.json()) as { result: { result: number[] } };
  return (Number(JSON.parse(Buffer.from(body.result.result).toString())) / 1e6).toFixed(2);
}

// Serves a Next.js route handler over plain HTTP, as the app does.
function serve(handler: (r: Request) => Promise<Response>) {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const request = new Request(`http://127.0.0.1${req.url}`, {
      method: req.method,
      headers: req.headers as Record<string, string>,
      body: req.method === "GET" ? undefined : Buffer.concat(chunks),
    });
    const response = await handler(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  return new Promise<{ url: string; close: () => void }>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => server.close() })),
  );
}

async function main() {
  // The merchant: a fictional business with a test-mode PayRouta API key.
  const orgId = `x402-demo-${randomUUID()}`;
  await db.organization.create({ data: { id: orgId, name: "Harbor Data", fictional: true } });
  await db.merchantConfig.create({ data: { orgId, returnOrigin: "http://127.0.0.1:3000" } });
  const apiKey = `pr_sandbox_${randomBytes(32).toString("base64url")}`;
  await db.merchantApiKey.create({ data: { orgId, environment: "sandbox", prefix: apiKey.slice(0, 22), verifier: hash(apiKey), permissions: ["payments:read", "payments:write"] } });

  // PayRouta's facilitator API: the route handlers, served over HTTP.
  const payrouta = await serve(async (r) => {
    const action = new URL(r.url).pathname.split("/").pop()!;
    const params = Promise.resolve({ action });
    return r.method === "GET" ? GET(r, { params }) : POST(r, { params });
  });
  const facilitator = new HTTPFacilitatorClient({
    url: `${payrouta.url}/api/v1/x402`,
    createAuthHeaders: async () => {
      const headers = { authorization: `Bearer ${apiKey}`, "payrouta-environment": "sandbox" };
      return { verify: headers, settle: headers, supported: headers };
    },
  });

  // The merchant's x402 server: one paid route.
  const resourceServer = new x402ResourceServer(facilitator).register(network, new ServerScheme());
  await resourceServer.initialize();
  const requirements = await resourceServer.buildPaymentRequirements({ scheme: "exact", network, payTo: merchantAccount, price: { amount: price, asset: token }, maxTimeoutSeconds: 60 });
  const resource = { url: "http://harbor-data.example/report", description: "Today's shipping report", mimeType: "application/json" };
  const shop = await serve(async (r) => {
    const signature = r.headers.get("payment-signature");
    if (!signature) {
      const required = await resourceServer.createPaymentRequiredResponse(requirements, resource, "Payment required");
      return Response.json(required, { status: 402, headers: { "PAYMENT-REQUIRED": Buffer.from(JSON.stringify(required)).toString("base64") } });
    }
    const payload = JSON.parse(Buffer.from(signature, "base64").toString());
    const match = resourceServer.findMatchingRequirements(requirements, payload);
    if (!match) return Response.json({ error: "No matching requirements" }, { status: 402 });
    const verified = await resourceServer.verifyPayment(payload, match);
    if (!verified.isValid) return Response.json({ error: verified.invalidReason }, { status: 402 });
    const settled = await resourceServer.settlePayment(payload, match);
    const headers = { "PAYMENT-RESPONSE": Buffer.from(JSON.stringify(settled)).toString("base64") };
    if (!settled.success) return Response.json({ error: settled.errorReason }, { status: 402, headers });
    return Response.json({ report: "Port of Lagos: 41 vessels berthed, average wait 2.4 days." }, { headers });
  });

  // The agent: a NEAR account paying with the x402 Foundation's client.
  const key = JSON.parse(readFileSync(`${homedir()}/.near-credentials/testnet/${payer}.json`, "utf8")) as { private_key: `ed25519:${string}` };
  // The agent's own spend controls: only pUSD on NEAR testnet, at most 1.00 a payment.
  const client = x402Client.fromConfig({
    schemes: [{ network: "near:*", client: new ClientScheme(createClientNearSigner({ accountId: payer, secretKey: key.private_key })) }],
    spendControls: { allowedAssets: [{ network, asset: token, maxAmountPerPayment: "1000000" }] },
  });
  let lastSignature = "";
  const recording: typeof fetch = async (input, init) => {
    const sig = (input instanceof Request ? input.headers : new Headers(init?.headers)).get("payment-signature");
    if (sig) lastSignature = sig;
    return fetch(input, init);
  };
  const pay = wrapFetchWithPayment(recording, client);

  console.log("x402 on NEAR testnet: a merchant's x402 server, PayRouta as facilitator, an agent paying with @x402/fetch\n");
  console.log(`Merchant account ${merchantAccount}: ${await balance(merchantAccount)} pUSD`);
  console.log(`Agent account    ${payer}: ${await balance(payer)} pUSD\n`);

  const first = await fetch(`${shop.url}/report`);
  const required = decodePaymentRequiredHeader(first.headers.get("payment-required")!);
  const a = required.accepts[0];
  console.log(`[1] GET /report → ${first.status} Payment Required: ${Number(a.amount) / 1e6} pUSD (${a.asset}) to ${a.payTo} on ${a.network}`);

  const paid = await pay(`${shop.url}/report`);
  const receipt = decodePaymentResponseHeader(paid.headers.get("payment-response")!);
  console.log(`[2] The agent signs one NEP-366 delegate action and retries → ${paid.status}: ${JSON.stringify(await paid.json())}`);
  console.log(`    Settled by PayRouta's relayer: ${receipt.success ? "success" : receipt.errorReason}, payer ${receipt.payer}`);
  console.log(`    https://testnet.nearblocks.io/txns/${receipt.transaction}`);

  const replay = await fetch(`${shop.url}/report`, { headers: { "PAYMENT-SIGNATURE": lastSignature } });
  console.log(`[3] The same signed payment sent again → ${replay.status}: ${JSON.stringify(await replay.json())}`);

  console.log(`\nMerchant account ${merchantAccount}: ${await balance(merchantAccount)} pUSD`);
  console.log(`Agent account    ${payer}: ${await balance(payer)} pUSD`);
  const settlements = await GET(new Request("http://127.0.0.1/api/v1/x402/settlements", { headers: { authorization: `Bearer ${apiKey}`, "payrouta-environment": "sandbox" } }), {
    params: Promise.resolve({ action: "settlements" }),
  });
  const list = ((await settlements.json()) as { data: { success: boolean }[] }).data;
  console.log(`PayRouta's record for Harbor Data: ${list.length} settlement(s), ${list.filter((s) => s.success).length} successful (GET /api/v1/x402/settlements)`);
  shop.close();
  payrouta.close();
  await db.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
