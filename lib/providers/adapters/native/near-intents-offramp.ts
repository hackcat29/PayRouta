// Crypto checkouts settled straight to the merchant's bank (docs/near-intents.md,
// "Settle in your bank").
//
// The merchant sets up a cash-out partner (lib/treasury/offramp): Bridge
// (their own liquidation address, which converts USDC on Base and pays their
// bank) or Yellow Card (PayRouta's top-up address; PayRouta then sends the
// local currency to their bank or mobile money). A checkout asks the customer
// to pay from any token on any chain: the checkout requests a 1Click
// exact-output quote that delivers USDC on Base to that funding address
// (lib/intents/checkout.ts), less PayRouta's fee where it's taken at source.
//
// The funding address receives every checkout, so a payment is confirmed
// only by its own swap: once 1Click reports SUCCESS, the swap's delivery
// transaction is read back from Base and must hold one USDC transfer of
// exactly the expected amount to that address, in a finalized block. The
// transfer is claimed once (DepositClaim). The cash out to the bank follows
// from the confirmed payment (lib/treasury/offramp/cashout.ts).
import { z } from "zod";
import { paymentAsset as tokenAsset } from "../../../blockchain/crypto-assets";
import { tokenMinor, validTokenAmount } from "../../../blockchain/assets";
import { alchemyReader } from "../../../blockchain/alchemy-rpc";
import type { DepositBinding, DepositStore } from "../../../blockchain/deposit-types";
import { PortalError } from "../../../portal/domain";
import { status as swapStatus, type OneClickStatus } from "../../../intents/oneclick";
import { nativeFields, parseConfig, object, checkEnvironment, stableId, type NativeDeps } from "./common";
import type { ExecutionAdapter } from "../../normalized";
import type { IntentsSwaps } from "./near-intents-deposit";

export const usdcBase = { network: "eip155:8453", identifier: "erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" } as const;
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export const offrampConfigSchema = z
  .object({
    ...nativeFields,
    adapter: z.literal("near-intents-offramp").default("near-intents-offramp"),
    // 1Click is mainnet only.
    environment: z.literal("production"),
    network: z.literal(usdcBase.network),
    identifier: z.literal(usdcBase.identifier),
    partner: z.enum(["bridge", "yellowcard"]),
    // The FiatPayoutAccount paid from this settlement, and its funding address.
    fiatAccountId: z.string().min(1).max(100),
    address: z
      .string()
      .regex(/^0x[0-9a-f]{40}$/)
      .refine((v) => v !== `0x${"0".repeat(40)}`),
    accountId: z.string().min(1).max(200).optional(),
  })
  .strict();

const finished = ["SUCCESS", "REFUNDED", "FAILED"];
const detected = ["KNOWN_DEPOSIT_TX", "PROCESSING", "SUCCESS"];
const hash = (v: unknown) => {
  if (typeof v !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(v)) throw new PortalError("INVALID_RPC_RESPONSE", 502);
  return v.toLowerCase();
};
const quantity = (v: unknown) => {
  if (typeof v !== "string" || !/^0x[0-9a-fA-F]+$/.test(v)) throw new PortalError("INVALID_RPC_RESPONSE", 502);
  return BigInt(v);
};

export function offrampExecutionAdapter(config: unknown, deps: NativeDeps): ExecutionAdapter {
  const c = parseConfig(offrampConfigSchema, config),
    token = tokenAsset(c.network, c.identifier)!;
  const store: DepositStore | undefined = deps.deposits,
    swaps: IntentsSwaps | undefined = deps.swaps;
  if (!store || !swaps) throw new PortalError("DEPOSIT_STORE_NOT_CONFIGURED", 409);
  const rpc = alchemyReader({ network: c.network }, deps);
  const ref = (key: string) => `offramp-${stableId(key, 48)}`;
  const action = (b: DepositBinding) => ({
    kind: "intents",
    settle: "bank",
    provider: "NEAR Intents",
    text: `Pay ${b.amount} ${token.symbol} from any token on any chain`,
    address: c.address,
    network: b.network,
    identifier: b.identifier,
    amount: b.amount,
    symbol: token.symbol,
  });
  const asset = (b: DepositBinding) => ({ kind: "blockchain", identifier: b.identifier, network: b.network });

  // The one USDC transfer of `amount` to the funding address in this
  // delivery transaction, once its block is finalized; null while it isn't.
  async function delivered(txHash: string, amount: bigint) {
    const receipt = await rpc("eth_getTransactionReceipt", [txHash]);
    if (!receipt) return null;
    const r = object(receipt);
    if (quantity(r.status) !== 1n || hash(r.transactionHash) !== txHash.toLowerCase()) throw new PortalError("DEPOSIT_RECEIPT_MISMATCH", 502);
    const finalized = object(await rpc("eth_getBlockByNumber", ["finalized", false]));
    if (quantity(r.blockNumber) > quantity(finalized.number)) return null;
    const recipient = `0x${c.address.slice(2).padStart(64, "0")}`;
    const transfers = (Array.isArray(r.logs) ? r.logs : []).map(object).filter(
      (l) =>
        String(l.address).toLowerCase() === token.contractAddress &&
        Array.isArray(l.topics) &&
        String(l.topics[0]).toLowerCase() === TRANSFER &&
        String(l.topics[2]).toLowerCase() === recipient,
    );
    if (transfers.length !== 1) throw new PortalError("DEPOSIT_MULTIPLE_TRANSFERS", 409);
    if (quantity(transfers[0].data) !== amount) throw new PortalError("DEPOSIT_AMOUNT_MISMATCH", 409);
    return { txHash: hash(r.transactionHash), logIndex: `0x${quantity(transfers[0].logIndex).toString(16)}`, blockHash: hash(r.blockHash) };
  }

  return {
    operations: ["create-payment", "payment-status"],
    async create(a, i) {
      checkEnvironment(c, a);
      const requested = object(i.asset);
      if (
        i.selectedMethod !== "stablecoin" ||
        requested.kind !== "blockchain" ||
        requested.network !== c.network ||
        requested.identifier !== c.identifier ||
        i.precision !== token.decimals ||
        !validTokenAmount(i.amount, token.decimals) ||
        tokenMinor(i.amount, token.decimals) <= 0n
      )
        throw new PortalError("UNSUPPORTED_PAYMENT_ASSET", 409);
      // One funding address receives every checkout: each binding gets its
      // own reference under it, and the swap attributes the delivery.
      const b =
        (await store.find(a.id)) ??
        (await store.allocate({
          attemptId: a.id,
          attemptKey: a.key,
          environment: a.environment,
          network: c.network,
          identifier: c.identifier,
          amount: i.amount,
          precision: token.decimals,
          startBlock: 0n,
          addresses: [`${c.address}/${stableId(a.key, 24)}`],
        }));
      if (b.attemptKey !== a.key || b.network !== c.network || b.identifier !== c.identifier || b.amount !== i.amount || b.precision !== token.decimals)
        throw new PortalError("DEPOSIT_BINDING_MISMATCH", 409);
      return { state: "Requires action", reference: ref(a.key), action: action(b) };
    },
    async status(a) {
      const b = await store.find(a.id);
      if (!b) return null;
      if (
        b.attemptKey !== a.key ||
        b.environment !== c.environment ||
        b.network !== c.network ||
        b.identifier !== c.identifier ||
        !b.address.startsWith(`${c.address}/`) ||
        (a.providerReference && a.providerReference !== ref(a.key))
      )
        throw new PortalError("DEPOSIT_BINDING_MISMATCH", 409);
      const expected = tokenMinor(b.amount, b.precision);
      const now = deps.now?.() ?? new Date();
      let seen = false;
      for (const swap of await swaps.forAttempt(a.id, "BANK")) {
        const fee = BigInt(swap.appFeeMinor ?? "0");
        if (fee < 0n || fee >= expected) continue;
        const net = expected - fee;
        if (swap.amountOut !== net.toString()) continue;
        let state = swap.status,
          details = swap.details as OneClickStatus["swapDetails"];
        if (!finished.includes(state) && (!swap.checkedAt || now.getTime() - swap.checkedAt.getTime() >= 5000)) {
          const s = await swapStatus(swap.depositAddress, swap.depositMemo, deps.http);
          if (s) {
            state = s.status;
            details = s.swapDetails;
            await swaps.record(swap.id, state, details ?? null, now);
          }
        }
        if (detected.includes(state)) seen = true;
        if (state !== "SUCCESS") continue;
        const txs = (details as { destinationChainTxHashes?: { hash: string }[] } | undefined)?.destinationChainTxHashes ?? [];
        if (txs.length !== 1) continue;
        const found = await delivered(txs[0].hash, net);
        if (!found) continue;
        await store.claim(b, { ...found, amount: b.amount });
        return { state: "Confirmed", reference: ref(a.key), amount: b.amount, asset: asset(b) };
      }
      return { state: seen ? "Pending" : "Requires action", reference: ref(a.key), amount: b.amount, asset: asset(b), action: action(b) };
    },
  };
}
