// PayRouta agent vault (contracts/agent-vault, docs/agent-vault.md): the
// on-chain side of agent spending limits. An agent pays from a NEAR contract
// that enforces its owner's policy itself, holding only a function-call key
// that can call `pay`. `pay` takes a payment order PayRouta signed for one
// checkout, so a prompt-injected agent can't send the money anywhere else.
//
// This file: PayRouta's order signing (PAYROUTA_AGENT_ORDER_KEY_REF, an
// ed25519 seed in the secret store) and reading a vault's Chain Signatures
// EVM address.
import { ed25519 } from "@noble/curves/ed25519";
import bs58 from "bs58";
import { getAddress, keccak256 } from "viem";
import { secretManager } from "../portal/adapters";
import { PortalError } from "../portal/domain";
import { destinations } from "../intents/oneclick";
import { usdcOnNear } from "../x402/near";

export const orderDomain = "PayRouta agent order v1\n";

export type VaultOrder = {
  id: string;
  merchant: string;
  merchant_name: string;
  network: string;
  token: string;
  pay_to: string;
  amount: string;
  expires_at_ms: string;
};

async function orderSeed(get = (ref: string) => secretManager.get(ref)) {
  const ref = process.env.PAYROUTA_AGENT_ORDER_KEY_REF?.trim();
  if (!ref) return null;
  const seed = (await get(ref)).trim();
  if (!/^[0-9a-f]{64}$/.test(seed)) throw new PortalError("AGENT_ORDER_KEY_INVALID", 503);
  return Buffer.from(seed, "hex");
}

// The key a vault's owner sets as `order_signer`.
export async function orderPublicKey(get?: (ref: string) => Promise<string>) {
  const seed = await orderSeed(get);
  return seed ? `ed25519:${bs58.encode(ed25519.getPublicKey(seed))}` : null;
}

export async function signOrder(order: VaultOrder, get?: (ref: string) => Promise<string>) {
  const seed = await orderSeed(get);
  if (!seed) return null;
  // Key order fixed: the vault verifies these exact bytes.
  const text = JSON.stringify({
    id: order.id,
    merchant: order.merchant,
    merchant_name: order.merchant_name,
    network: order.network,
    token: order.token,
    pay_to: order.pay_to,
    amount: order.amount,
    expires_at_ms: order.expires_at_ms,
  });
  const signature = ed25519.sign(Buffer.from(orderDomain + text, "utf8"), seed);
  return { order: text, signature: Buffer.from(signature).toString("hex") };
}

// Base units of a decimal amount.
export function baseUnits(amount: string, decimals: number) {
  const m = amount.match(/^(\d+)(?:\.(\d+))?$/);
  if (!m || (m[2]?.length ?? 0) > decimals) throw new PortalError("AGENT_ORDER_AMOUNT_INVALID", 409);
  return (BigInt(m[1]) * 10n ** BigInt(decimals) + BigInt((m[2] ?? "").padEnd(decimals, "0") || "0")).toString();
}

// The network and token a vault pays with, for the transfer checkout asked
// for: a stablecoin deposit on an EVM chain, or the NEAR Intents deposit
// address of a swap from a stablecoin on NEAR or an EVM chain.
export function vaultAsset(transfer: { network?: string; token?: string; originAsset?: string }) {
  if (transfer.originAsset) {
    if (transfer.originAsset === `nep141:${usdcOnNear["near:mainnet"]}`) return { network: "near:mainnet", token: usdcOnNear["near:mainnet"], decimals: 6 };
    const d = destinations.find((x) => x.assetId === transfer.originAsset && x.network.startsWith("eip155:"));
    return d ? { network: d.network, token: d.contract, decimals: d.decimals } : null;
  }
  if (transfer.network?.startsWith("eip155:") && transfer.token?.startsWith("erc20:")) {
    const contract = transfer.token.slice(6);
    const known = destinations.find((x) => x.network === transfer.network && x.contract === contract);
    // Base Sepolia USDC, for test mode.
    if (!known && transfer.network === "eip155:84532" && contract === "0x036cbd53842c5426634e7929541ec2318f3dcf7e")
      return { network: transfer.network, token: contract, decimals: 6 };
    return known && ["USDC", "USDT"].includes(known.symbol) ? { network: known.network, token: contract, decimals: known.decimals } : null;
  }
  return null;
}

// A vault's EVM address: the key v1.signer derives for (vault, path), as an
// Ethereum address. Read from the MPC contract itself.
export async function vaultEvmAddress(
  vault: string,
  path: string,
  mpc = vault.endsWith(".testnet") ? "v1.signer-prod.testnet" : "v1.signer",
  rpc = vault.endsWith(".testnet") ? "https://rpc.testnet.fastnear.com" : "https://rpc.mainnet.fastnear.com",
) {
  const response = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "query",
      params: {
        request_type: "call_function",
        finality: "final",
        account_id: mpc,
        method_name: "derived_public_key",
        args_base64: Buffer.from(JSON.stringify({ path, predecessor: vault, domain_id: 0 })).toString("base64"),
      },
    }),
  });
  const body = (await response.json()) as { result?: { result?: number[] }; error?: unknown };
  if (!body.result?.result) throw new PortalError("NEAR_RPC_UNAVAILABLE", 503);
  const key = JSON.parse(Buffer.from(body.result.result).toString()) as string;
  const raw = bs58.decode(key.replace(/^secp256k1:/, ""));
  if (raw.length !== 64) throw new PortalError("NEAR_RPC_UNAVAILABLE", 503);
  return getAddress(`0x${keccak256(raw).slice(-40)}`);
}
