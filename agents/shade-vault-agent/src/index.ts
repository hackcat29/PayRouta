// A Shade Agent that pays PayRouta checkouts from a PayRouta agent vault
// (contracts/agent-vault, docs/agent-vault.md).
//
// Inside a TEE (Phala Cloud, dstack), shade-agent-js generates the agent's
// NEAR key in the enclave and produces an Intel TDX attestation whose report
// data is that key. `register()` sends it to the vault's register_agent: the
// vault checks the quote and the image's measurements before it accepts the
// agent. The key never leaves the enclave.
//
// Then, for each checkout:
//   1. open it on PayRouta's agent API and ask to pay: PayRouta returns the
//      transfer and a payment order it signed for the vault;
//   2. call the vault's `pay` with the order. On NEAR the vault transfers the
//      token; on an EVM chain it returns a transaction signed by NEAR Chain
//      Signatures for the vault's own EVM address;
//   3. broadcast that transaction.
// The vault enforces the owner's merchants, cap and budget whatever the agent
// is told.
//
//   GET  /           the agent's account, the vault, registration
//   POST /pay        { "link": "<payment link slug or URL>" } or { "checkoutUrl": "…" }
import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { ShadeClient } from "@neardefi/shade-agent-js";
import { createPublicClient, getAddress, http, keccak256, type Hex } from "viem";

const vault = process.env.AGENT_CONTRACT_ID!;
const network = (process.env.NEAR_NETWORK as "testnet" | "mainnet") || "testnet";
const payrouta = process.env.PAYROUTA_URL || "https://payrouta.com";
const nearRpc = network === "testnet" ? "https://rpc.testnet.fastnear.com" : "https://rpc.mainnet.fastnear.com";
const mpc = network === "testnet" ? "v1.signer-prod.testnet" : "v1.signer";
const evm = createPublicClient({ transport: http(process.env.EVM_RPC_URL || "https://sepolia.base.org") });

const client = await ShadeClient.create({
  networkId: network,
  agentContractId: vault,
  sponsor: { accountId: process.env.SPONSOR_ACCOUNT_ID!, privateKey: process.env.SPONSOR_PRIVATE_KEY! },
});

async function nearView<T>(contract: string, method: string, args: object): Promise<T> {
  const r = await fetch(nearRpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "query",
      params: { request_type: "call_function", finality: "final", account_id: contract, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") },
    }),
  });
  const body = (await r.json()) as { result?: { result: number[] } };
  if (!body.result) throw new Error(`${contract}.${method} failed`);
  return JSON.parse(Buffer.from(body.result.result).toString()) as T;
}

const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(text: string) {
  let n = 0n;
  for (const c of text) n = n * 58n + BigInt(alphabet.indexOf(c));
  const hex = n.toString(16).padStart(128, "0");
  return Buffer.from(hex, "hex");
}

// The vault's EVM address: the key v1.signer derives for (vault, path).
async function vaultEvmAddress() {
  const config = await nearView<{ evm_path: string }>(vault, "get_config", {});
  const key = await nearView<string>(mpc, "derived_public_key", { path: config.evm_path, predecessor: vault, domain_id: 0 });
  return getAddress(`0x${keccak256(base58(key.replace(/^secp256k1:/, ""))).slice(-40)}`);
}

async function agentApi(path: string, init: RequestInit & { token?: string } = {}) {
  const r = await fetch(`${payrouta}/api/agent/v1${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init.token ? { "PayRouta-Checkout-Token": init.token } : {}) },
  });
  const body = await r.json();
  if (!r.ok) throw new Error(`PayRouta ${path}: ${JSON.stringify(body)}`);
  return body as Record<string, unknown>;
}

const app = new Hono();

app.get("/", async (c) => {
  const registered = await client.view({ methodName: "get_agent", args: { account_id: client.accountId() } }).catch(() => null);
  return c.json({ agent: client.accountId(), vault, registered: !!registered, evmAddress: await vaultEvmAddress().catch(() => null) });
});

// The agent's account pays its own gas: the sponsor funds it first.
async function register() {
  if ((await client.balance()) < 0.4) await client.fund(Number(process.env.AGENT_FUNDING_NEAR || "0.5"));
  return client.register();
}

app.post("/register", async (c) => {
  try {
    return c.json({ registered: true, result: await register() });
  } catch (e) {
    return c.json({ registered: false, error: e instanceof Error ? e.message : String(e) }, 400);
  }
});

app.post("/pay", async (c) => {
  const input = (await c.req.json()) as { link?: string; checkoutUrl?: string };
  // 1. Open the checkout and ask to pay: PayRouta signs the vault order.
  const opened = (await agentApi("/checkouts", { method: "POST", body: JSON.stringify(input.link ? { link: input.link } : { checkoutUrl: input.checkoutUrl }) })) as {
    checkout: string;
    token: string;
    payWith?: { tokens: { token: string; route?: string }[] }[];
  };
  const token = opened.payWith?.flatMap((n) => n.tokens).find((t) => !t.token.startsWith("swap:"))?.token;
  if (!token) return c.json({ error: "No direct stablecoin option on this checkout" }, 409);
  const transfer = (await agentApi(`/checkouts/${opened.checkout}/pay`, { method: "POST", token: opened.token, body: JSON.stringify({ token, from: "wallet" }) })) as {
    network: string;
    vault?: { order: string; signature: string };
  };
  if (!transfer.vault) return c.json({ error: "PayRouta returned no vault order for this checkout" }, 409);

  // 2. Pay from the vault. On an EVM chain, give it the nonce and gas.
  let gas: object | null = null;
  if (transfer.network.startsWith("eip155:")) {
    const from = await vaultEvmAddress();
    const [nonce, fees] = await Promise.all([evm.getTransactionCount({ address: from }), evm.estimateFeesPerGas()]);
    const maxFee = fees.maxFeePerGas * 2n;
    gas = { nonce: String(nonce), gas_limit: "80000", max_fee_per_gas: maxFee.toString(), max_priority_fee_per_gas: (fees.maxPriorityFeePerGas < maxFee ? fees.maxPriorityFeePerGas : maxFee).toString() };
  }
  const result = (await client.call({
    methodName: "pay",
    args: { order: transfer.vault.order, signature: transfer.vault.signature, evm: gas },
    gas: BigInt("300000000000000"),
  })) as unknown as { raw_transaction: Hex; transaction_hash: Hex } | boolean | null;

  // 3. Broadcast the signed EVM transaction.
  if (result && typeof result === "object" && "raw_transaction" in result) {
    const hash = await evm.sendRawTransaction({ serializedTransaction: result.raw_transaction });
    const receipt = await evm.waitForTransactionReceipt({ hash });
    return c.json({ checkout: opened.checkout, paid: receipt.status === "success", transaction: hash });
  }
  return c.json({ checkout: opened.checkout, paid: result === true });
});

// Inside a TEE, register with the vault on start; it re-checks the attestation.
if (process.env.REGISTER_ON_START !== "false") {
  register().then(
    () => console.log(`Agent ${client.accountId()} registered with ${vault}`),
    (e: unknown) => console.error(`Registration failed: ${e instanceof Error ? e.message : String(e)}`),
  );
}

serve({ fetch: app.fetch, port: Number(process.env.PORT || 3000) });
console.log(`PayRouta vault agent ${client.accountId()} for ${vault} on :${process.env.PORT || 3000}`);
