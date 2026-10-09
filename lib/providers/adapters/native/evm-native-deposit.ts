import { z } from "zod";
import QRCode from "qrcode";
import { chain, isTestnet } from "../../../blockchain/chains";
import {
  cryptoAsset,
  validPaymentAmount,
} from "../../../blockchain/crypto-assets";
import { tokenMinor } from "../../../blockchain/assets";
import { depositPayment } from "../../../blockchain/wallet-payment";
import { alchemyReader } from "../../../blockchain/alchemy-rpc";
import type {
  DepositBinding,
  DepositStore,
} from "../../../blockchain/deposit-types";
import { PortalError } from "../../../portal/domain";
import {
  nativeFields,
  secretRef,
  parseConfig,
  checkEnvironment,
  assertHints,
  object,
  stableId,
  type NativeDeps,
} from "./common";
import type { ExecutionAdapter } from "../../normalized";
export const nativeDepositConfigSchema = z
  .object({
    ...nativeFields,
    adapter: z.literal("evm-native-deposit"),
    network: z.string().refine((n) => chain(n)?.family === "evm"),
    identifier: z.string().regex(/^native:(ETH|AVAX|POL)$/),
    rpcKeyRef: secretRef.optional(),
    publicRpc: z.boolean().default(false),
    accountId: z.string().min(1).max(200).optional(),
    addresses: z
      .array(
        z
          .string()
          .regex(/^0x[0-9a-fA-F]{40}$/)
          .transform((v) => v.toLowerCase())
          .refine((v) => v !== `0x${"0".repeat(40)}`),
      )
      .min(1)
      .max(1000)
      .refine((a) => new Set(a).size === a.length),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (
      (!c.publicRpc && !c.rpcKeyRef) ||
      !cryptoAsset(c.network, c.identifier) ||
      isTestnet(c.network) !== (c.environment === "sandbox")
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Supported native asset, matching environment and RPC required",
      });
  });
const quantity = (v: unknown) => {
  if (typeof v !== "string" || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(v))
    throw new PortalError("INVALID_RPC_RESPONSE", 502);
  return BigInt(v);
};
const hash = (v: unknown) => {
  if (typeof v !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(v))
    throw new PortalError("INVALID_RPC_RESPONSE", 502);
  return v.toLowerCase();
};
const hex = (v: bigint) => `0x${v.toString(16)}`;
// Direct top-level value transfers only. Balances and unverified transaction hints
// never prove payment; internal contract transfers need a separate trace adapter.
export function nativeDepositExecutionAdapter(
  config: unknown,
  deps: NativeDeps & { deposits?: DepositStore },
): ExecutionAdapter {
  const c = parseConfig(nativeDepositConfigSchema, config),
    token = cryptoAsset(c.network, c.identifier)!;
  const store = deps.deposits;
  if (!store) throw new PortalError("DEPOSIT_STORE_NOT_CONFIGURED", 409);
  const rpc = alchemyReader(c, deps),
    ref = (key: string) => `deposit-${stableId(key, 48)}`;
  const checkChain = async () => {
    if (
      quantity(await rpc("eth_chainId", [])) !== BigInt(c.network.split(":")[1])
    )
      throw new PortalError("RPC_CHAIN_MISMATCH", 502);
  };
  const action = async (b: DepositBinding) => {
    const request = depositPayment(b);
    return {
      kind: "deposit",
      provider: "Crypto wallet",
      text: `Send exactly ${b.amount} ${token.symbol} on ${chain(c.network)!.name}.`,
      address: b.address,
      network: b.network,
      identifier: b.identifier,
      amount: b.amount,
      symbol: token.symbol,
      code: request.uri,
      image: await QRCode.toDataURL(request.uri, { width: 240, margin: 2 }),
    };
  };
  const matches = (
    b: DepositBinding,
    a: { key: string; providerReference?: string | null },
  ) => {
    if (
      b.attemptKey !== a.key ||
      b.environment !== c.environment ||
      b.network !== c.network ||
      b.identifier !== c.identifier ||
      (a.providerReference && a.providerReference !== ref(a.key))
    )
      throw new PortalError("DEPOSIT_BINDING_MISMATCH", 409);
  };
  return {
    operations: ["create-payment", "payment-status"],
    async create(a, i) {
      checkEnvironment(c, a);
      assertHints(i, [], ["native"]);
      const asset = object(i.asset);
      if (
        i.selectedMethod !== "crypto-app" ||
        asset.kind !== "blockchain" ||
        asset.network !== c.network ||
        asset.identifier !== c.identifier ||
        i.precision !== token.decimals ||
        !validPaymentAmount(c.network, c.identifier, i.amount)
      )
        throw new PortalError("UNSUPPORTED_PAYMENT_ASSET", 409);
      await checkChain();
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
          startBlock: quantity(await rpc("eth_blockNumber", [])) + 1n,
          addresses: c.addresses,
        }));
      matches(b, a);
      if (b.amount !== i.amount || b.precision !== token.decimals)
        throw new PortalError("DEPOSIT_BINDING_MISMATCH", 409);
      return {
        state: "Requires action",
        reference: ref(a.key),
        action: await action(b),
      };
    },
    async status(a) {
      const b = await store.find(a.id);
      if (!b) return null;
      matches(b, a);
      await checkChain();
      const pending = async (detected = false) => ({
        state: detected ? "Pending" : "Requires action",
        reference: ref(a.key),
        amount: b.amount,
        asset: {
          kind: "blockchain",
          network: b.network,
          identifier: b.identifier,
        },
        action: await action(b),
      });
      const latest = quantity(await rpc("eth_blockNumber", []));
      const final = object(
          await rpc("eth_getBlockByNumber", ["finalized", false]),
        ),
        end = quantity(final.number);
      hash(final.hash);
      if (end > latest) throw new PortalError("INVALID_RPC_RESPONSE", 502);
      const claimed = await store.claimed?.(b);
      const candidates: Record<string, unknown>[] = [];
      if (claimed) {
        if (
          claimed.logIndex !== "native:0" ||
          tokenMinor(claimed.amount, b.precision) !==
            tokenMinor(b.amount, b.precision)
        )
          throw new PortalError("DEPOSIT_RECEIPT_MISMATCH", 502);
        const tx = object(
          await rpc("eth_getTransactionByHash", [claimed.txHash]),
        );
        if (
          hash(tx.hash) !== claimed.txHash ||
          hash(tx.blockHash) !== claimed.blockHash
        )
          throw new PortalError("DEPOSIT_RECEIPT_MISMATCH", 502);
        candidates.push(tx);
      } else {
        let checkpoint = await store.checkpoint?.(b);
        let from =
          checkpoint?.nextBlock ?? (await store.scanStart?.(b)) ?? b.startBlock;
        let previousHash: string | undefined;
        if (from < b.startBlock)
          throw new PortalError("DEPOSIT_BINDING_MISMATCH", 409);
        // Tentative pagination is safe only while the preceding block remains
        // canonical: its hash commits to every earlier block we scanned.
        if (checkpoint?.cursor) {
          const anchor = /^evm-native:([0-9]+):(0x[0-9a-f]{64})$/.exec(
            checkpoint.cursor,
          );
          if (!anchor || BigInt(anchor[1]) !== from - 1n)
            throw new PortalError("DEPOSIT_BINDING_MISMATCH", 409);
          const previous = await rpc("eth_getBlockByNumber", [
            hex(from - 1n),
            false,
          ]);
          if (!previous || hash(object(previous).hash) !== anchor[2]) {
            await store.advanceCheckpoint?.(b, b.startBlock, null, checkpoint);
            return pending();
          }
          if (quantity(object(previous).number) !== from - 1n)
            throw new PortalError("INVALID_RPC_RESPONSE", 502);
          previousHash = anchor[2];
        }
        // Fixed work per poll, including the unfinalized range. A candidate
        // stops pagination and its canonical receipt is rechecked until finality.
        for (let count = 0; from <= latest && count < 32; count++, from++) {
          const block = object(
            await rpc("eth_getBlockByNumber", [hex(from), true]),
          );
          if (
            quantity(block.number) !== from ||
            !Array.isArray(block.transactions)
          )
            throw new PortalError("INVALID_RPC_RESPONSE", 502);
          const bh = hash(block.hash);
          if (previousHash && hash(block.parentHash) !== previousHash) {
            if (checkpoint)
              await store.advanceCheckpoint?.(
                b,
                b.startBlock,
                null,
                checkpoint,
              );
            return pending();
          }
          previousHash = bh;
          for (const raw of block.transactions) {
            const tx = object(raw);
            if (
              String(tx.to).toLowerCase() !== b.address ||
              quantity(tx.value) === 0n
            )
              continue;
            if (quantity(tx.blockNumber) !== from || hash(tx.blockHash) !== bh)
              throw new PortalError("DEPOSIT_RECEIPT_MISMATCH", 502);
            candidates.push(tx);
          }
          if (candidates.length) break;
          if (checkpoint && store.advanceCheckpoint) {
            const next = {
              nextBlock: from + 1n,
              cursor: `evm-native:${from}:${bh}`,
            };
            await store.advanceCheckpoint(
              b,
              next.nextBlock,
              next.cursor,
              checkpoint,
            );
            checkpoint = next;
          } else if (from <= end) await store.advanceScan?.(b, from + 1n);
        }
      }
      if (!candidates.length) return pending();
      if (candidates.length !== 1)
        throw new PortalError("DEPOSIT_MULTIPLE_TRANSFERS", 409);
      const tx = candidates[0],
        txHash = hash(tx.hash),
        blockHash = hash(tx.blockHash),
        n = quantity(tx.blockNumber);
      if (
        n < b.startBlock ||
        n > latest ||
        String(tx.to).toLowerCase() !== b.address ||
        !/^0x[0-9a-fA-F]{40}$/.test(String(tx.from)) ||
        String(tx.from).toLowerCase() === b.address ||
        tx.input !== "0x"
      )
        throw new PortalError("DEPOSIT_TRANSFER_MISMATCH", 502);
      const receipt = await rpc("eth_getTransactionReceipt", [txHash]);
      if (receipt === null) return pending();
      const r = object(receipt);
      if (
        hash(r.transactionHash) !== txHash ||
        hash(r.blockHash) !== blockHash ||
        quantity(r.blockNumber) !== n ||
        r.status !== "0x1" ||
        String(r.to).toLowerCase() !== b.address ||
        String(r.from).toLowerCase() !== String(tx.from).toLowerCase()
      )
        throw new PortalError("DEPOSIT_RECEIPT_MISMATCH", 502);
      const block = object(await rpc("eth_getBlockByNumber", [hex(n), true]));
      if (
        hash(block.hash) !== blockHash ||
        quantity(block.number) !== n ||
        (n === end && hash(final.hash) !== blockHash)
      )
        return pending();
      // Require the returned transaction to be present in its canonical block.
      if (
        !Array.isArray(block.transactions) ||
        !block.transactions.some((raw) => {
          const t = object(raw);
          return (
            hash(t.hash) === txHash &&
            t.value === tx.value &&
            t.input === tx.input &&
            t.to === tx.to &&
            t.from === tx.from
          );
        })
      )
        throw new PortalError("DEPOSIT_RECEIPT_MISMATCH", 502);
      if (
        b.acceptBefore &&
        quantity(block.timestamp) * 1000n >= BigInt(b.acceptBefore.getTime())
      )
        throw new PortalError("DEPOSIT_QUOTE_PAYMENT_LATE", 409);
      if (quantity(tx.value) !== tokenMinor(b.amount, b.precision))
        throw new PortalError("DEPOSIT_AMOUNT_MISMATCH", 409);
      if (end < n) return pending(true);
      await store.claim(b, {
        txHash,
        logIndex: "native:0",
        blockHash,
        amount: b.amount,
      });
      return {
        state: "Confirmed",
        reference: ref(a.key),
        amount: b.amount,
        asset: {
          kind: "blockchain",
          network: b.network,
          identifier: b.identifier,
        },
      };
    },
  };
}
