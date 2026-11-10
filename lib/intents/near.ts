// NEAR mainnet reads for NEAR Intents settlement (docs/near-intents.md):
// balances held in the intents.near contract, the keys it accepts for an
// account, and the events a swap emitted when it delivered into a merchant's
// intents account. Read-only: PayRouta never signs NEAR transactions.
//
// Verified against mainnet on 30 October 2026: intents.near exposes
// mt_batch_balance_of, has_public_key and public_keys_of; execute_intents
// receipts log `dip4` transfer events (with the intent hash) next to the
// NEP-245 `mt_transfer` that moved the tokens; settlement transactions are
// signed by intents.near itself.
import bs58 from "bs58";
import { PortalError } from "../portal/domain";
import { providerRequest } from "../providers/adapters/http";
import type { Http } from "./oneclick";

export const intentsContract = "intents.near";
const rpcUrl = () => process.env.NEAR_RPC_URL || "https://rpc.mainnet.near.org";
// Transactions older than a few epochs are only on archival nodes; settlement
// re-reads its evidence, sometimes days later.
const archivalUrl = () => process.env.NEAR_ARCHIVAL_RPC_URL || "https://archival-rpc.mainnet.near.org";

// NEAR Intents account ids: named NEAR accounts and implicit (64-hex)
// accounts sign NEP-413 messages; an EVM address (lowercase) signs ERC-191.
const nearAccount = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
export type IntentsStandard = "nep413" | "erc191" | "raw_ed25519";

// A Solana wallet owns the implicit NEAR Intents account named by its key in
// hex, and signs intents as raw_ed25519 (the payload text, as wallets sign
// off-chain messages). The address is that key in base58.
export function solanaOwner(address: string): { accountId: string; standard: "raw_ed25519"; publicKey: string } | null {
  const value = address.trim();
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) return null;
  try {
    const key = bs58.decode(value);
    if (key.length !== 32) return null;
    return { accountId: Array.from(key, (b) => b.toString(16).padStart(2, "0")).join(""), standard: "raw_ed25519", publicKey: `ed25519:${value}` };
  } catch {
    return null;
  }
}
export function intentsAccount(raw: string): { accountId: string; standard: IntentsStandard } | null {
  const value = raw.trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(value)) return { accountId: value.toLowerCase(), standard: "erc191" };
  if (nearAccount.test(value) && (/^[0-9a-f]{64}$/.test(value) || value.includes("."))) return { accountId: value, standard: "nep413" };
  return null;
}

type RpcError = { name?: string; cause?: { name?: string } };
async function rpc(method: string, params: unknown, http: Http, base = rpcUrl()) {
  const response = await http(base, {
    method: "POST",
    path: "/",
    headers: { "User-Agent": "PayRouta/0.1 (+https://payrouta.com)" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "payrouta", method, params }),
    // Transaction lookups take several seconds on public nodes.
    timeoutMs: method === "tx" ? 15000 : 10000,
    maxResponseBytes: 4194304,
  });
  if (response.status === 429) throw new PortalError("NEAR_RPC_RATE_LIMITED", 503);
  let body: { result?: unknown; error?: RpcError };
  try {
    body = JSON.parse(response.body);
  } catch {
    throw new PortalError("NEAR_RPC_UNAVAILABLE", 503);
  }
  if (body.error) return { error: body.error.cause?.name ?? body.error.name ?? "RPC_ERROR" };
  if (response.status !== 200 || body.result === undefined) throw new PortalError("NEAR_RPC_UNAVAILABLE", 503);
  return { result: body.result };
}

async function view<T>(method: string, args: object, http: Http): Promise<T> {
  const r = await rpc(
    "query",
    {
      request_type: "call_function",
      finality: "final",
      account_id: intentsContract,
      method_name: method,
      args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
    },
    http,
  );
  const bytes = (r.result as { result?: unknown } | undefined)?.result;
  if (r.error || !Array.isArray(bytes)) throw new PortalError("NEAR_RPC_UNAVAILABLE", 503);
  try {
    return JSON.parse(Buffer.from(bytes as number[]).toString("utf8")) as T;
  } catch {
    throw new PortalError("NEAR_RPC_UNAVAILABLE", 503);
  }
}

// Balances held for an account inside NEAR Intents, in base units.
export async function intentsBalances(accountId: string, tokenIds: string[], http: Http = providerRequest) {
  if (!tokenIds.length) return {};
  const amounts = await view<unknown>("mt_batch_balance_of", { account_id: accountId, token_ids: tokenIds }, http);
  if (!Array.isArray(amounts) || amounts.length !== tokenIds.length || amounts.some((a) => typeof a !== "string" || !/^\d+$/.test(a)))
    throw new PortalError("NEAR_RPC_UNAVAILABLE", 503);
  return Object.fromEntries(tokenIds.map((t, i) => [t, amounts[i] as string]));
}

// Whether intents.near accepts signatures by this key for the account. EVM
// and implicit accounts are accepted without registration; a named NEAR
// account registers its wallet key once (add_public_key).
export async function intentsKeyRegistered(accountId: string, publicKey: string, http: Http = providerRequest) {
  return (await view<unknown>("has_public_key", { account_id: accountId, public_key: publicKey }, http)) === true;
}

// Whether the key is a full-access key of the NEAR account, i.e. the signer
// controls the account.
export async function fullAccessKey(accountId: string, publicKey: string, http: Http = providerRequest) {
  const r = await rpc("query", { request_type: "view_access_key", finality: "final", account_id: accountId, public_key: publicKey }, http);
  if (r.error) {
    if (["UNKNOWN_ACCESS_KEY", "UNKNOWN_ACCOUNT", "INVALID_ACCOUNT"].includes(r.error)) return false;
    throw new PortalError("NEAR_RPC_UNAVAILABLE", 503);
  }
  return (r.result as { permission?: unknown }).permission === "FullAccess";
}

export async function finalHeight(http: Http = providerRequest) {
  const r = await rpc("block", { finality: "final" }, http);
  const height = (r.result as { header?: { height?: unknown } } | undefined)?.header?.height;
  if (r.error || typeof height !== "number" || !Number.isSafeInteger(height)) throw new PortalError("NEAR_RPC_UNAVAILABLE", 503);
  return height;
}

// A final transaction, or null while no node knows it yet.
export async function finalTransaction(hash: string, http: Http = providerRequest) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(hash)) throw new PortalError("NEAR_TX_INVALID", 502);
  const params = { tx_hash: hash, sender_account_id: intentsContract, wait_until: "FINAL" };
  let r = await rpc("tx", params, http);
  if (r.error === "UNKNOWN_TRANSACTION") r = await rpc("tx", params, http, archivalUrl());
  if (r.error === "UNKNOWN_TRANSACTION") return null;
  if (r.error) throw new PortalError("NEAR_RPC_UNAVAILABLE", 503);
  return r.result;
}

export type Delivery = { txHash: string; receiptId: string; blockHash: string; intentHash: string; from: string; amount: bigint };

const events = (logs: unknown) =>
  (Array.isArray(logs) ? logs : []).flatMap((log) => {
    if (typeof log !== "string" || !log.startsWith("EVENT_JSON:")) return [];
    try {
      const e = JSON.parse(log.slice("EVENT_JSON:".length)) as { standard?: unknown; event?: unknown; data?: unknown };
      return Array.isArray(e.data) ? [{ standard: e.standard, event: e.event, data: e.data as Record<string, unknown>[] }] : [];
    } catch {
      return [];
    }
  });

// Transfers of `assetId` into `account` that one of the swap's own intents
// made, from a final transaction. Settlement transactions batch many users'
// intents, so a transfer counts only when its intent hash is the swap's and
// the receipt's NEP-245 event moved the same tokens between the same owners.
export function deliveries(raw: unknown, txHash: string, match: { account: string; assetId: string; intentHashes: string[] }): Delivery[] {
  const tx = raw as { final_execution_status?: unknown; receipts_outcome?: unknown } | null;
  if (!tx || !Array.isArray(tx.receipts_outcome)) throw new PortalError("NEAR_TX_INVALID", 502);
  if (!["FINAL", "EXECUTED"].includes(String(tx.final_execution_status))) return [];
  const out: Delivery[] = [];
  for (const receipt of tx.receipts_outcome as { id?: unknown; block_hash?: unknown; outcome?: { executor_id?: unknown; logs?: unknown; status?: unknown } }[]) {
    const outcome = receipt.outcome;
    if (
      outcome?.executor_id !== intentsContract ||
      !outcome.status ||
      typeof outcome.status !== "object" ||
      !("SuccessValue" in outcome.status) ||
      typeof receipt.id !== "string" ||
      typeof receipt.block_hash !== "string"
    )
      continue;
    const logged = events(outcome.logs);
    const moved = logged
      .filter((e) => e.standard === "nep245" && e.event === "mt_transfer")
      .flatMap((e) => e.data)
      .flatMap((d) =>
        Array.isArray(d.token_ids) && Array.isArray(d.amounts) && d.token_ids.length === d.amounts.length
          ? d.token_ids.map((t, i) => ({ from: d.old_owner_id, to: d.new_owner_id, token: t, amount: (d.amounts as unknown[])[i] }))
          : [],
      );
    for (const t of logged.filter((e) => e.standard === "dip4" && e.event === "transfer").flatMap((e) => e.data)) {
      const amount = (t.tokens as Record<string, unknown> | undefined)?.[match.assetId];
      if (
        t.receiver_id !== match.account ||
        typeof t.intent_hash !== "string" ||
        !match.intentHashes.includes(t.intent_hash) ||
        typeof t.account_id !== "string" ||
        typeof amount !== "string" ||
        !/^\d+$/.test(amount) ||
        !moved.some((m) => m.from === t.account_id && m.to === match.account && m.token === match.assetId && m.amount === amount)
      )
        continue;
      out.push({ txHash, receiptId: receipt.id, blockHash: receipt.block_hash, intentHash: t.intent_hash, from: t.account_id, amount: BigInt(amount) });
    }
  }
  return out;
}
