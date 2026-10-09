import { chain, isTestnet } from "../../../blockchain/chains";
import {
  paymentAsset as tokenAsset,
  onchainMethod,
} from "../../../blockchain/crypto-assets";
import QRCode from "qrcode";
import { depositPayment } from "../../../blockchain/wallet-payment";
import { z } from "zod";
import { PortalError } from "../../../portal/domain";
import { tokenMinor, validTokenAmount } from "../../../blockchain/assets";
import { alchemyReader } from "../../../blockchain/alchemy-rpc";
import type {
  DepositBinding,
  DepositStore,
} from "../../../blockchain/deposit-types";
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

const address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .transform((v) => v.toLowerCase())
  .refine((v) => v !== `0x${"0".repeat(40)}`);
export const depositConfigSchema = z
  .object({
    ...nativeFields,
    adapter: z.literal("erc20-deposit").default("erc20-deposit"),
    rpcKeyRef: secretRef.optional(),
    publicTestnetRpc: z.boolean().default(false),
    publicRpc: z.boolean().default(false),
    accountId: z.string().min(1).max(200).optional(),
    logBlockRange: z.number().int().min(1).max(1000).default(10),
    network: z.string().refine((n) => chain(n)?.family === "evm"),
    identifier: z.string().regex(/^erc20:0x[0-9a-f]{40}$/),
    addresses: z
      .array(address)
      .min(1)
      .max(1000)
      .refine((a) => new Set(a).size === a.length),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (
      (!c.publicTestnetRpc && !c.publicRpc && !c.rpcKeyRef) ||
      (c.publicTestnetRpc &&
        (c.environment !== "sandbox" || c.network !== "eip155:84532"))
    )
      ctx.addIssue({
        code: "custom",
        message:
          "A configured RPC is required; legacy publicTestnetRpc is Base Sepolia only",
      });
    const test = isTestnet(c.network);
    if (
      test !== (c.environment === "sandbox") ||
      !tokenAsset(c.network, c.identifier)
    )
      ctx.addIssue({
        code: "custom",
        message: "Unsupported token or environment/network mismatch",
      });
  });
const TRANSFER =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const hash = (v: unknown) => {
  if (typeof v !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(v))
    throw new PortalError("INVALID_RPC_RESPONSE", 502);
  return v.toLowerCase();
};
const quantity = (v: unknown) => {
  if (typeof v !== "string" || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(v))
    throw new PortalError("INVALID_RPC_RESPONSE", 502);
  return BigInt(v);
};
const hex = (v: bigint) => `0x${v.toString(16)}`;
function amount(value: bigint, decimals: number) {
  const s = value.toString().padStart(decimals + 1, "0");
  return `${s.slice(0, -decimals)}.${s.slice(-decimals)}`;
}
// The operator provisions merchant-owned receive addresses. No keys, signing,
// sweeping, shared-address matching or customer-supplied transaction evidence.
export function depositExecutionAdapter(
  config: unknown,
  deps: NativeDeps & { deposits?: DepositStore },
): ExecutionAdapter {
  const c = parseConfig(depositConfigSchema, config),
    token = tokenAsset(c.network, c.identifier)!;
  const store = deps.deposits;
  if (!store) throw new PortalError("DEPOSIT_STORE_NOT_CONFIGURED", 409);
  const rpc = alchemyReader(
    { ...c, publicRpc: c.publicTestnetRpc || c.publicRpc },
    deps,
  );
  async function checkChain() {
    if (
      quantity(await rpc("eth_chainId", [])) !== BigInt(c.network.split(":")[1])
    )
      throw new PortalError("RPC_CHAIN_MISMATCH", 502);
  }
  async function action(b: DepositBinding) {
    const request = depositPayment(b);
    return {
      kind: "deposit",
      provider:
        onchainMethod(c.network, c.identifier) === "crypto-app"
          ? "Crypto wallet"
          : "Stablecoin deposit",
      text: `Send exactly ${b.amount} ${token.symbol} on ${chain(c.network)!.name}.`,
      address: b.address,
      network: b.network,
      identifier: b.identifier,
      amount: b.amount,
      symbol: token.symbol,
      code: request.uri,
      image: await QRCode.toDataURL(request.uri, { width: 240, margin: 2 }),
    };
  }
  const ref = (key: string) => `deposit-${stableId(key, 48)}`;
  return {
    operations: ["create-payment", "payment-status"],
    async create(a, i) {
      checkEnvironment(c, a);
      assertHints(i, [], ["erc20"]);
      const asset = object(i.asset);
      if (
        i.selectedMethod !== onchainMethod(c.network, c.identifier) ||
        asset.kind !== "blockchain" ||
        asset.network !== c.network ||
        asset.identifier !== c.identifier ||
        i.precision !== token.decimals ||
        !validTokenAmount(i.amount, token.decimals) ||
        tokenMinor(i.amount, token.decimals) <= 0n
      )
        throw new PortalError("UNSUPPORTED_PAYMENT_ASSET", 409);
      const old = await store.find(a.id);
      await checkChain();
      const b =
        old ??
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
      if (
        b.attemptKey !== a.key ||
        b.network !== c.network ||
        b.identifier !== c.identifier ||
        b.environment !== c.environment ||
        b.amount !== i.amount ||
        b.precision !== token.decimals
      )
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
      if (
        b.attemptKey !== a.key ||
        b.environment !== c.environment ||
        b.network !== c.network ||
        b.identifier !== c.identifier ||
        (a.providerReference && a.providerReference !== ref(a.key))
      )
        throw new PortalError("DEPOSIT_BINDING_MISMATCH", 409);
      const pending = async (detected = false) => ({
        state: detected ? "Pending" : "Requires action",
        reference: ref(a.key),
        amount: b.amount,
        asset: {
          kind: "blockchain",
          identifier: b.identifier,
          network: b.network,
        },
        action: await action(b),
      });
      await checkChain();
      const latest = quantity(await rpc("eth_blockNumber", []));
      if (latest < b.startBlock) return pending();
      const recipient = `0x${b.address.slice(2).padStart(64, "0")}`;
      let raw: unknown;
      const claimed = await store.claimed?.(b);
      if (claimed) {
        // Once finalized, revalidate the claimed receipt directly. Historical
        // reconciliation must not rescan an ever-growing receive-address history.
        const receipt = object(
          await rpc("eth_getTransactionReceipt", [claimed.txHash]),
        );
        if (
          !Array.isArray(receipt.logs) ||
          hash(receipt.transactionHash) !== claimed.txHash ||
          hash(receipt.blockHash) !== claimed.blockHash ||
          tokenMinor(claimed.amount, b.precision) !==
            tokenMinor(b.amount, b.precision)
        )
          throw new PortalError("DEPOSIT_RECEIPT_MISMATCH", 502);
        raw = receipt.logs.filter((v) => {
          const l = object(v);
          return (
            String(l.address).toLowerCase() === token.contractAddress &&
            Array.isArray(l.topics) &&
            String(l.topics[2]).toLowerCase() === recipient
          );
        });
        if (
          !(raw as unknown[]).some((v) => {
            const l = object(v);
            return (
              hash(l.transactionHash) === claimed.txHash &&
              hex(quantity(l.logIndex)) === claimed.logIndex &&
              hash(l.blockHash) === claimed.blockHash
            );
          })
        )
          throw new PortalError("DEPOSIT_RECEIPT_MISMATCH", 502);
      } else if (store.scanStart && store.advanceScan) {
        // Empty history is checkpointed only through finality; reorgs cannot
        // hide transfers in an unfinalized range. Work is bounded per poll.
        const checkpoint = object(
          await rpc("eth_getBlockByNumber", ["finalized", false]),
        );
        const finalizedEnd = quantity(checkpoint.number);
        const end = latest;
        hash(checkpoint.hash);
        if (finalizedEnd > latest)
          throw new PortalError("INVALID_RPC_RESPONSE", 502);
        let from = await store.scanStart(b);
        if (from < b.startBlock)
          throw new PortalError("DEPOSIT_BINDING_MISMATCH", 409);
        raw = [];
        const range = BigInt(c.publicTestnetRpc ? 500 : c.logBlockRange);
        for (let page = 0; from <= end && page < 20; page++) {
          const to = from + range - 1n < end ? from + range - 1n : end;
          const found = await rpc("eth_getLogs", [
            {
              address: token.contractAddress,
              fromBlock: hex(from),
              toBlock: hex(to),
              topics: [TRANSFER, null, recipient],
            },
          ]);
          if (!Array.isArray(found) || found.length > 100)
            throw new PortalError("INVALID_RPC_RESPONSE", 502);
          if (found.some((v) => object(v).removed === true)) return pending();
          if (found.length) {
            // Read the rest of the observed window before allowing
            // confirmation. Never advance the cursor past unresolved evidence.
            const remaining = end - from;
            if (remaining > 5000n || remaining >= range * BigInt(20 - page))
              throw new PortalError("DEPOSIT_SCAN_REQUIRES_INSPECTION", 409);
            const collected = [...found];
            for (let next = to + 1n; next <= end; next += range) {
              const finish = next + range - 1n < end ? next + range - 1n : end;
              const extra = await rpc("eth_getLogs", [
                {
                  address: token.contractAddress,
                  fromBlock: hex(next),
                  toBlock: hex(finish),
                  topics: [TRANSFER, null, recipient],
                },
              ]);
              if (
                !Array.isArray(extra) ||
                extra.length > 100 ||
                collected.length + extra.length > 100
              )
                throw new PortalError("INVALID_RPC_RESPONSE", 502);
              collected.push(...extra);
            }
            raw = collected;
            break;
          }
          if (from <= finalizedEnd)
            await store.advanceScan(
              b,
              (to < finalizedEnd ? to : finalizedEnd) + 1n,
            );
          from = to + 1n;
        }
      } else {
        // Custom stores without a durable cursor must never truncate history.
        if (latest - b.startBlock > 5000n)
          throw new PortalError("DEPOSIT_SCAN_REQUIRES_INSPECTION", 409);
        raw = await rpc("eth_getLogs", [
          {
            address: token.contractAddress,
            fromBlock: hex(b.startBlock),
            toBlock: hex(latest),
            topics: [TRANSFER, null, recipient],
          },
        ]);
      }
      if (!Array.isArray(raw) || raw.length > 100)
        throw new PortalError("INVALID_RPC_RESPONSE", 502);
      const logs = raw.map(object).filter((l) => l.removed !== true);
      if (!logs.length) return pending();
      const unique = new Map<string, Record<string, unknown>>();
      for (const l of logs) {
        if (
          (l.address !== token.contractAddress &&
            String(l.address).toLowerCase() !== token.contractAddress) ||
          !Array.isArray(l.topics) ||
          l.topics.length !== 3 ||
          l.topics[0] !== TRANSFER ||
          String(l.topics[2]).toLowerCase() !== recipient ||
          String(l.topics[1]).toLowerCase() === recipient ||
          !/^0x[0-9a-fA-F]{64}$/.test(String(l.data)) ||
          !/^0x[0-9a-fA-F]{64}$/.test(String(l.topics[1]))
        )
          throw new PortalError("DEPOSIT_TRANSFER_MISMATCH", 502);
        const n = quantity(l.blockNumber);
        if (n < b.startBlock || n > latest)
          throw new PortalError("DEPOSIT_TRANSFER_MISMATCH", 502);
        const id = `${hash(l.transactionHash)}:${hex(quantity(l.logIndex))}`;
        if (
          unique.has(id) &&
          JSON.stringify(unique.get(id)) !== JSON.stringify(l)
        )
          throw new PortalError("DEPOSIT_CONFLICTING_EVIDENCE", 502);
        unique.set(id, l);
      }
      if (unique.size !== 1)
        throw new PortalError("DEPOSIT_MULTIPLE_TRANSFERS", 409);
      const l = [...unique.values()][0],
        txHash = hash(l.transactionHash),
        blockHash = hash(l.blockHash),
        blockNumber = quantity(l.blockNumber);
      const receipt = await rpc("eth_getTransactionReceipt", [txHash]);
      if (receipt === null) return pending(); // A disappearing receipt is a reorg, not confirmation.
      const r = object(receipt);
      if (
        hash(r.transactionHash) !== txHash ||
        hash(r.blockHash) !== blockHash ||
        quantity(r.blockNumber) !== blockNumber ||
        r.status !== "0x1" ||
        !Array.isArray(r.logs) ||
        !r.logs.some((v) => {
          const e = object(v);
          return (
            hash(e.transactionHash) === txHash &&
            quantity(e.logIndex) === quantity(l.logIndex) &&
            hash(e.blockHash) === blockHash &&
            e.address === l.address &&
            e.data === l.data &&
            JSON.stringify(e.topics) === JSON.stringify(l.topics) &&
            e.removed !== true
          );
        })
      )
        throw new PortalError("DEPOSIT_RECEIPT_MISMATCH", 502);
      const finalized = object(
        await rpc("eth_getBlockByNumber", ["finalized", false]),
      );
      const finalizedHash = hash(finalized.hash);
      const finalNumber = quantity(finalized.number);
      if (finalNumber > latest)
        throw new PortalError("INVALID_RPC_RESPONSE", 502);
      if (finalNumber === blockNumber && finalizedHash !== blockHash)
        return pending();
      // Check canonical receipt identity before showing even provisional detection.
      const block = object(
        await rpc("eth_getBlockByNumber", [hex(blockNumber), false]),
      );
      if (
        hash(block.hash) !== blockHash ||
        quantity(block.number) !== blockNumber
      )
        return pending();
      if (
        b.acceptBefore &&
        quantity(block.timestamp) * 1000n >= BigInt(b.acceptBefore.getTime())
      )
        throw new PortalError("DEPOSIT_QUOTE_PAYMENT_LATE", 409);
      const paid = amount(BigInt(String(l.data)), token.decimals);
      // Incorrect amounts are authentic evidence, but are never applied as a
      // matching invoice. They go to inspection without consuming the event.
      if (
        tokenMinor(paid, token.decimals) !==
        tokenMinor(b.amount, token.decimals)
      )
        throw new PortalError("DEPOSIT_AMOUNT_MISMATCH", 409);
      // Detection never claims, settles or bills the payment. If the receipt
      // disappears on a later poll, the checkout returns to awaiting a transfer.
      if (finalNumber < blockNumber) return pending(true);
      await store.claim(b, {
        txHash,
        logIndex: hex(quantity(l.logIndex)),
        blockHash,
        amount: paid,
      });
      return {
        state: "Confirmed",
        reference: ref(a.key),
        amount: paid,
        asset: {
          kind: "blockchain",
          identifier: b.identifier,
          network: b.network,
        },
      };
    },
  };
}
