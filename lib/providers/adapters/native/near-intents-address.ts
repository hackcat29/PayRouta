// Crypto checkouts settled straight to an address the merchant gives, on any
// chain NEAR Intents delivers to (docs/near-intents.md, "Settle to an
// address"): USDT on Tron, USDC on Solana, USDT on TON and so on.
//
// The checkout is priced in USDC (on Base) and the customer pays from any
// token; the 1Click exact-output quote delivers the same amount of the
// merchant's chosen stablecoin to their address, less PayRouta's fee
// (lib/intents/checkout.ts). The address receives every checkout, so a
// payment is confirmed only by its own swap's delivery: read back on-chain
// where PayRouta reads that chain (EVM networks, Solana), otherwise taken
// from 1Click's SUCCESS and the delivery transaction it reports
// (lib/intents/delivery.ts). Each delivery is claimed once (DepositClaim).
import { z } from "zod";
import { paymentAsset as tokenAsset } from "../../../blockchain/crypto-assets";
import { tokenMinor, validTokenAmount } from "../../../blockchain/assets";
import type { DepositBinding, DepositStore } from "../../../blockchain/deposit-types";
import { PortalError } from "../../../portal/domain";
import { status as swapStatus, type OneClickStatus } from "../../../intents/oneclick";
import { checkDelivery } from "../../../intents/delivery";
import { nativeFields, parseConfig, object, checkEnvironment, stableId, type NativeDeps } from "./common";
import type { ExecutionAdapter } from "../../normalized";
import type { IntentsSwaps } from "./near-intents-deposit";
import { usdcBase } from "./near-intents-offramp";

// An address on its chain: letters, digits and the separators chains use
// (Tron, TON, Bitcoin, XRP memos aside). 1Click refuses one that isn't valid
// for the chain when the quote is made.
export const settlementAddress = z.string().trim().regex(/^[A-Za-z0-9:._@+=/-]{2,140}$/);

export const addressConfigSchema = z
  .object({
    ...nativeFields,
    adapter: z.literal("near-intents-address").default("near-intents-address"),
    // 1Click is mainnet only.
    environment: z.literal("production"),
    // The checkout's price: USDC on Base.
    network: z.literal(usdcBase.network),
    identifier: z.literal(usdcBase.identifier),
    // What the merchant receives, and where.
    settlementAddressId: z.string().min(1).max(100),
    destination: z
      .object({
        assetId: z.string().min(3).max(300),
        blockchain: z.string().min(2).max(40),
        symbol: z.enum(["USDC", "USDT"]),
        decimals: z.number().int().min(0).max(30),
        contract: z.string().max(200).nullable(),
      })
      .strict(),
    address: settlementAddress,
    accountId: z.string().min(1).max(200).optional(),
  })
  .strict();
export type AddressConfig = z.infer<typeof addressConfigSchema>;

const finished = ["SUCCESS", "REFUNDED", "FAILED"];
const detected = ["KNOWN_DEPOSIT_TX", "PROCESSING", "SUCCESS"];

export function addressExecutionAdapter(config: unknown, deps: NativeDeps): ExecutionAdapter {
  const c = parseConfig(addressConfigSchema, config),
    invoice = tokenAsset(c.network, c.identifier)!;
  const store: DepositStore | undefined = deps.deposits,
    swaps: IntentsSwaps | undefined = deps.swaps;
  if (!store || !swaps) throw new PortalError("DEPOSIT_STORE_NOT_CONFIGURED", 409);
  const ref = (key: string) => `address-${stableId(key, 48)}`;
  const action = (b: DepositBinding) => ({
    kind: "intents",
    settle: "address",
    destinationAsset: c.destination.assetId,
    provider: "NEAR Intents",
    text: `Pay ${b.amount} ${invoice.symbol} from any token on any chain`,
    address: c.address,
    network: b.network,
    identifier: b.identifier,
    amount: b.amount,
    symbol: invoice.symbol,
  });
  const asset = (b: DepositBinding) => ({ kind: "blockchain", identifier: b.identifier, network: b.network });
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
        i.precision !== invoice.decimals ||
        !validTokenAmount(i.amount, invoice.decimals) ||
        tokenMinor(i.amount, invoice.decimals) <= 0n
      )
        throw new PortalError("UNSUPPORTED_PAYMENT_ASSET", 409);
      const b =
        (await store.find(a.id)) ??
        (await store.allocate({
          attemptId: a.id,
          attemptKey: a.key,
          environment: a.environment,
          network: c.network,
          identifier: c.identifier,
          amount: i.amount,
          precision: invoice.decimals,
          startBlock: 0n,
          addresses: [`${c.settlementAddressId}/${stableId(a.key, 24)}`],
        }));
      if (b.attemptKey !== a.key || b.network !== c.network || b.identifier !== c.identifier || b.amount !== i.amount || b.precision !== invoice.decimals)
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
        !b.address.startsWith(`${c.settlementAddressId}/`) ||
        (a.providerReference && a.providerReference !== ref(a.key))
      )
        throw new PortalError("DEPOSIT_BINDING_MISMATCH", 409);
      // The invoice amount in the delivered token's units.
      const expected = tokenMinor(b.amount, c.destination.decimals);
      const now = deps.now?.() ?? new Date();
      let seen = false;
      for (const swap of await swaps.forAttempt(a.id, "ADDRESS")) {
        const fee = BigInt(swap.appFeeMinor ?? "0");
        if (fee < 0n || fee >= expected) continue;
        const net = expected - fee;
        if (swap.destinationAsset !== c.destination.assetId || swap.amountOut !== net.toString()) continue;
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
        if (txs.length !== 1 || !txs[0].hash) continue;
        const found = await checkDelivery(
          { blockchain: c.destination.blockchain, contract: c.destination.contract, decimals: c.destination.decimals, address: c.address, amount: net, txHash: txs[0].hash },
          deps,
        );
        if (found.status === "pending") continue;
        await store.claim(b, { txHash: found.txHash, logIndex: found.logIndex, blockHash: found.blockHash, amount: b.amount });
        return { state: "Confirmed", reference: ref(a.key), amount: b.amount, asset: asset(b) };
      }
      return { state: seen ? "Pending" : "Requires action", reference: ref(a.key), amount: b.amount, asset: asset(b), action: action(b) };
    },
  };
}
