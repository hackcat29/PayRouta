// Settlement into a merchant's NEAR Intents account (docs/near-intents.md).
//
// The merchant connects an intents account they own (lib/intents/account.ts)
// and picks the stablecoins it settles in. A checkout for one of those
// stablecoins then asks the customer to pay from any token on any chain: the
// checkout requests a 1Click exact-output quote that delivers the invoice
// amount into the merchant's intents account (lib/intents/checkout.ts), and
// the customer sends to the quote's one-time deposit address.
//
// Confirmation is on-chain, like every other deposit adapter: once 1Click
// reports the swap SUCCESS, its NEAR transactions are read back and the
// payment is confirmed only by an intents.near transfer of exactly the
// invoice amount (less PayRouta's fee, when 1Click withholds it at source)
// into the merchant's account, made by one of the swap's own intents. The transfer is claimed once (DepositClaim), so one delivery can
// never pay two checkouts. PayRouta never holds the funds or the account keys.
import { z } from "zod";
import { paymentAsset as tokenAsset, onchainMethod } from "../../../blockchain/crypto-assets";
import { tokenMinor, validTokenAmount } from "../../../blockchain/assets";
import type { DepositBinding, DepositStore } from "../../../blockchain/deposit-types";
import { PortalError } from "../../../portal/domain";
import { destinationFor, status as swapStatus, type OneClickStatus } from "../../../intents/oneclick";
import { deliveries, finalHeight, finalTransaction, intentsAccount } from "../../../intents/near";
import { nativeFields, parseConfig, object, checkEnvironment, stableId, type NativeDeps } from "./common";
import type { ExecutionAdapter } from "../../normalized";

export const intentsDepositConfigSchema = z
  .object({
    ...nativeFields,
    adapter: z.literal("near-intents-deposit").default("near-intents-deposit"),
    // 1Click and NEAR Intents are mainnet only.
    environment: z.literal("production"),
    network: z.string(),
    identifier: z.string(),
    // The merchant's NEAR Intents account and its IntentsAccount record.
    account: z.string().min(2).max(64),
    intentsAccountId: z.string().min(1).max(100),
    accountId: z.string().min(1).max(200).optional(),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (!destinationFor(c.network, c.identifier) || intentsAccount(c.account)?.accountId !== c.account)
      ctx.addIssue({ code: "custom", message: "Unsupported settlement token or intents account" });
  });

// The swaps a checkout's customer started (CrossChainPayment rows with
// recipientType INTENTS), newest first.
export type IntentsSwap = {
  id: string;
  depositAddress: string;
  depositMemo: string | null;
  destinationAsset: string;
  amountOut: string;
  // PayRouta's fee withheld at source: the account receives the invoice less this.
  appFeeMinor?: string | null;
  status: string;
  details: unknown;
  checkedAt: Date | null;
};
export interface IntentsSwaps {
  // INTENTS: into the merchant's intents account; BANK: to their cash-out
  // partner (near-intents-offramp).
  forAttempt(attemptId: string, recipientType?: "INTENTS" | "BANK"): Promise<IntentsSwap[]>;
  record(id: string, status: string, details: unknown, at: Date): Promise<void>;
}

const finished = ["SUCCESS", "REFUNDED", "FAILED"];
const detected = ["KNOWN_DEPOSIT_TX", "PROCESSING", "SUCCESS"];

export function intentsDepositExecutionAdapter(config: unknown, deps: NativeDeps): ExecutionAdapter {
  const c = parseConfig(intentsDepositConfigSchema, config),
    token = tokenAsset(c.network, c.identifier)!,
    destination = destinationFor(c.network, c.identifier)!;
  const store: DepositStore | undefined = deps.deposits,
    swaps = deps.swaps;
  if (!store || !swaps) throw new PortalError("DEPOSIT_STORE_NOT_CONFIGURED", 409);
  const ref = (key: string) => `intents-${stableId(key, 48)}`;
  const action = (b: DepositBinding) => ({
    kind: "intents",
    provider: "NEAR Intents",
    text: `Pay ${b.amount} ${token.symbol} from any token on any chain`,
    address: c.account,
    network: b.network,
    identifier: b.identifier,
    amount: b.amount,
    symbol: token.symbol,
  });
  const asset = (b: DepositBinding) => ({ kind: "blockchain", identifier: b.identifier, network: b.network });
  return {
    operations: ["create-payment", "payment-status"],
    async create(a, i) {
      checkEnvironment(c, a);
      const requested = object(i.asset);
      if (
        i.selectedMethod !== onchainMethod(c.network, c.identifier) ||
        requested.kind !== "blockchain" ||
        requested.network !== c.network ||
        requested.identifier !== c.identifier ||
        i.precision !== token.decimals ||
        !validTokenAmount(i.amount, token.decimals) ||
        tokenMinor(i.amount, token.decimals) <= 0n
      )
        throw new PortalError("UNSUPPORTED_PAYMENT_ASSET", 409);
      // One account receives every checkout, so each binding gets its own
      // reference under it; the swap's intent hashes attribute deliveries.
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
          startBlock: BigInt(await finalHeight(deps.http)),
          addresses: [`${c.account}/${stableId(a.key, 24)}`],
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
        !b.address.startsWith(`${c.account}/`) ||
        (a.providerReference && a.providerReference !== ref(a.key))
      )
        throw new PortalError("DEPOSIT_BINDING_MISMATCH", 409);
      const expected = tokenMinor(b.amount, b.precision);
      const now = deps.now?.() ?? new Date();
      let seen = false;
      for (const swap of await swaps.forAttempt(a.id)) {
        const fee = BigInt(swap.appFeeMinor ?? "0");
        if (fee < 0n || fee >= expected) continue;
        const net = expected - fee;
        if (swap.destinationAsset !== destination.assetId || swap.amountOut !== net.toString()) continue;
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
        const hashes = details?.intentHashes ?? [],
          txs = details?.nearTxHashes ?? [];
        const found = [];
        for (const hash of txs) {
          const tx = await finalTransaction(hash, deps.http);
          if (tx) found.push(...deliveries(tx, hash, { account: c.account, assetId: destination.assetId, intentHashes: hashes }));
        }
        if (!found.length) continue;
        if (found.length !== 1) throw new PortalError("DEPOSIT_MULTIPLE_TRANSFERS", 409);
        if (found[0].amount !== net) throw new PortalError("DEPOSIT_AMOUNT_MISMATCH", 409);
        await store.claim(b, {
          txHash: found[0].txHash,
          logIndex: `${found[0].receiptId}:${found[0].intentHash}`,
          blockHash: found[0].blockHash,
          amount: b.amount,
        });
        return { state: "Confirmed", reference: ref(a.key), amount: b.amount, asset: asset(b) };
      }
      return { state: seen ? "Pending" : "Requires action", reference: ref(a.key), amount: b.amount, asset: asset(b), action: action(b) };
    },
  };
}
