import QRCode from "qrcode";
import {
  paymentAsset as tokenAsset,
  onchainMethod,
} from "../../../blockchain/crypto-assets";
import { verifySolanaNativeTransfer } from "../../../blockchain/solana-native-proof";
import { z } from "zod";
import { PublicKey } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "../../../blockchain/solana-token";
import { tokenMinor, validTokenAmount } from "../../../blockchain/assets";
import { chain } from "../../../blockchain/chains";
import { alchemyReader, type Rpc } from "../../../blockchain/alchemy-rpc";
import type {
  DepositBinding,
  DepositStore,
} from "../../../blockchain/deposit-types";
import { PortalError } from "../../../portal/domain";
import {
  nativeFields,
  secretRef,
  parseConfig,
  object,
  checkEnvironment,
  stableId,
  type NativeDeps,
} from "./common";
import type { ExecutionAdapter } from "../../normalized";
export function solanaAddress(value: string) {
  try {
    const key = new PublicKey(value);
    return key.toBase58() === value && PublicKey.isOnCurve(key.toBytes());
  } catch {
    return false;
  }
}
export const solanaDepositConfigSchema = z
  .object({
    ...nativeFields,
    adapter: z.literal("solana-deposit").default("solana-deposit"),
    network: z.enum(["solana:mainnet", "solana:devnet"]),
    identifier: z.string(),
    rpcKeyRef: secretRef.optional(),
    publicRpc: z.boolean().default(false),
    accountId: z.string().min(1).max(200).optional(),
    addresses: z
      .array(z.string().refine(solanaAddress))
      .min(1)
      .max(1000)
      .refine((a) => new Set(a).size === a.length),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (
      (!c.rpcKeyRef && !c.publicRpc) ||
      !tokenAsset(c.network, c.identifier) ||
      chain(c.network)?.testnet !== (c.environment === "sandbox")
    )
      ctx.addIssue({
        code: "custom",
        message: "Unsupported Solana token or network/environment mismatch",
      });
  });
export function solanaRecipient(address: string, mint: string) {
  return getAssociatedTokenAddressSync(
    new PublicKey(mint),
    new PublicKey(address),
  ).toBase58();
}
export async function checkSolanaNetwork(rpc: Rpc, network: string) {
  if ((await rpc("getGenesisHash", [])) !== chain(network)?.genesisHash)
    throw new PortalError("RPC_CHAIN_MISMATCH", 502);
}
function integer(n: unknown) {
  if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 0)
    throw new PortalError("INVALID_RPC_RESPONSE", 502);
  return n;
}
function signature(value: unknown) {
  if (typeof value !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(value))
    throw new PortalError("INVALID_RPC_RESPONSE", 502);
  return value;
}
export function verifySolanaTransfer(
  raw: unknown,
  b: DepositBinding,
  txHash: string,
) {
  const token = tokenAsset(b.network, b.identifier)!;
  if (!token.contractAddress) return verifySolanaNativeTransfer(raw, b, txHash);
  const r = object(raw),
    meta = object(r.meta),
    transaction = object(r.transaction),
    message = object(transaction.message);
  if (
    meta.err !== null ||
    !Array.isArray(transaction.signatures) ||
    transaction.signatures[0] !== txHash ||
    BigInt(integer(r.slot)) < b.startBlock
  )
    throw new PortalError("DEPOSIT_RECEIPT_MISMATCH", 502);
  if (
    !Array.isArray(message.accountKeys) ||
    !Array.isArray(message.instructions) ||
    !Array.isArray(meta.postTokenBalances) ||
    !Array.isArray(meta.preTokenBalances)
  )
    throw new PortalError("INVALID_RPC_RESPONSE", 502);
  const destination = solanaRecipient(b.address, token.contractAddress);
  const keys = message.accountKeys.map((k) =>
    typeof k === "string" ? k : object(k).pubkey,
  );
  const index = keys.indexOf(destination);
  const post = meta.postTokenBalances
    .map(object)
    .find(
      (p) =>
        p.accountIndex === index &&
        p.mint === token.contractAddress &&
        p.owner === b.address,
    );
  const pre = meta.preTokenBalances
    .map(object)
    .find((p) => p.accountIndex === index && p.mint === token.contractAddress);
  const instructions = [...message.instructions];
  if (Array.isArray(meta.innerInstructions))
    for (const inner of meta.innerInstructions) {
      const i = object(inner);
      if (!Array.isArray(i.instructions))
        throw new PortalError("INVALID_RPC_RESPONSE", 502);
      instructions.push(...i.instructions);
    }
  const incoming: { index: number; amount: string }[] = [];
  for (const [i, value] of instructions.entries()) {
    const instruction = object(value);
    if (
      instruction.programId !== TOKEN_PROGRAM_ID.toBase58() ||
      !instruction.parsed
    )
      continue;
    const parsed = object(instruction.parsed),
      info = object(parsed.info);
    if (
      !["transfer", "transferChecked"].includes(String(parsed.type)) ||
      info.destination !== destination
    )
      continue;
    if (info.source === destination)
      throw new PortalError("DEPOSIT_SELF_TRANSFER", 409);
    const sourceIndex = keys.indexOf(info.source);
    const source = meta.preTokenBalances
      .map(object)
      .find(
        (p) =>
          p.accountIndex === sourceIndex && p.mint === token.contractAddress,
      );
    if (
      parsed.type === "transferChecked"
        ? info.mint !== token.contractAddress
        : !source
    )
      throw new PortalError("DEPOSIT_TOKEN_MISMATCH", 409);
    const units =
      parsed.type === "transferChecked"
        ? object(info.tokenAmount).amount
        : info.amount;
    if (
      typeof units !== "string" ||
      !/^\d+$/.test(units) ||
      (parsed.type === "transferChecked" &&
        object(info.tokenAmount).decimals !== token.decimals)
    )
      throw new PortalError("INVALID_RPC_RESPONSE", 502);
    incoming.push({ index: i, amount: units });
  }
  if (!incoming.length) return null;
  if (incoming.length !== 1)
    throw new PortalError("DEPOSIT_MULTIPLE_TRANSFERS", 409);
  const readBalance = (v: Record<string, unknown> | undefined) => {
    if (!v) return 0n;
    const q = object(v.uiTokenAmount);
    if (
      q.decimals !== token.decimals ||
      typeof q.amount !== "string" ||
      !/^\d+$/.test(q.amount)
    )
      throw new PortalError("INVALID_RPC_RESPONSE", 502);
    return BigInt(q.amount);
  };
  const credited = readBalance(post) - readBalance(pre);
  if (
    !post ||
    credited !== BigInt(incoming[0].amount) ||
    credited !== tokenMinor(b.amount, b.precision)
  )
    throw new PortalError("DEPOSIT_AMOUNT_MISMATCH", 409);
  return {
    slot: integer(r.slot),
    logIndex: `ix:${incoming[0].index}`,
    amount: b.amount,
  };
}
export function solanaDepositExecutionAdapter(
  config: unknown,
  deps: NativeDeps,
): ExecutionAdapter {
  const c = parseConfig(solanaDepositConfigSchema, config),
    token = tokenAsset(c.network, c.identifier)!;
  const store: DepositStore | undefined = deps.deposits;
  if (!store) throw new PortalError("DEPOSIT_STORE_NOT_CONFIGURED", 409);
  const rpc = alchemyReader(c, deps),
    ref = (key: string) => `deposit-${stableId(key, 48)}`;
  async function action(b: DepositBinding) {
    const uri = `solana:${b.address}?amount=${b.amount}${token.contractAddress ? `&spl-token=${token.contractAddress}` : ""}`;
    return {
      kind: "deposit",
      provider: "PayRouta",
      text: `Send ${b.amount} ${token.symbol} on ${chain(c.network)!.name}`,
      address: b.address,
      network: b.network,
      identifier: b.identifier,
      amount: b.amount,
      symbol: token.symbol,
      image: await QRCode.toDataURL(uri, { width: 240, margin: 2 }),
      code: uri,
    };
  }
  return {
    operations: ["create-payment", "payment-status"],
    async create(a, i) {
      checkEnvironment(c, a);
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
      await checkSolanaNetwork(rpc, c.network);
      const old = await store.find(a.id);
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
          startBlock:
            BigInt(
              integer(await rpc("getSlot", [{ commitment: "confirmed" }])),
            ) + 1n,
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
      await checkSolanaNetwork(rpc, c.network);
      const head = integer(await rpc("getSlot", [{ commitment: "confirmed" }]));
      if (BigInt(head) < b.startBlock) return pending();
      const candidates: { signature: string; slot: number }[] = [];
      let before: string | undefined,
        complete = false;
      for (let page = 0; page < 20; page++) {
        const raw = await rpc("getSignaturesForAddress", [
          token.contractAddress
            ? solanaRecipient(b.address, token.contractAddress)
            : b.address,
          {
            commitment: "confirmed",
            limit: 100,
            ...(before ? { before } : {}),
          },
        ]);
        if (!Array.isArray(raw) || raw.length > 100)
          throw new PortalError("INVALID_RPC_RESPONSE", 502);
        for (const entry of raw) {
          const s = object(entry),
            slot = integer(s.slot);
          if (BigInt(slot) >= b.startBlock && s.err === null)
            candidates.push({ signature: signature(s.signature), slot });
        }
        if (
          raw.length < 100 ||
          raw.some((v) => BigInt(integer(object(v).slot)) < b.startBlock)
        ) {
          complete = true;
          break;
        }
        before = signature(object(raw.at(-1)).signature);
      }
      if (!complete || candidates.length > 20)
        throw new PortalError("DEPOSIT_SCAN_REQUIRES_INSPECTION", 409);
      const matching: {
        signature: string;
        slot: number;
        logIndex: string;
        amount: string;
      }[] = [];
      for (const candidate of candidates) {
        const tx = await rpc("getTransaction", [
          candidate.signature,
          {
            encoding: "jsonParsed",
            commitment: "confirmed",
            maxSupportedTransactionVersion: 0,
          },
        ]);
        if (!tx) continue;
        const verified = verifySolanaTransfer(tx, b, candidate.signature);
        if (verified) {
          if (verified.slot !== candidate.slot)
            throw new PortalError("DEPOSIT_RECEIPT_MISMATCH", 502);
          matching.push({ ...verified, signature: candidate.signature });
        }
      }
      if (!matching.length) return pending();
      if (matching.length !== 1)
        throw new PortalError("DEPOSIT_MULTIPLE_TRANSFERS", 409);
      const match = matching[0];
      const final = await rpc("getTransaction", [
        match.signature,
        {
          encoding: "jsonParsed",
          commitment: "finalized",
          maxSupportedTransactionVersion: 0,
        },
      ]);
      if (!final) return pending(true);
      const verified = verifySolanaTransfer(final, b, match.signature);
      if (
        !verified ||
        verified.slot !== match.slot ||
        verified.logIndex !== match.logIndex
      )
        throw new PortalError("DEPOSIT_RECEIPT_MISMATCH", 502);
      const block = await rpc("getBlock", [
        match.slot,
        {
          commitment: "finalized",
          transactionDetails: "signatures",
          rewards: false,
          maxSupportedTransactionVersion: 0,
        },
      ]);
      if (!block) return pending();
      const canonical = object(block);
      if (
        typeof canonical.blockhash !== "string" ||
        !Array.isArray(canonical.signatures) ||
        !canonical.signatures.includes(match.signature)
      )
        throw new PortalError("DEPOSIT_RECEIPT_MISMATCH", 502);
      if (
        b.acceptBefore &&
        integer(canonical.blockTime) * 1000 >= b.acceptBefore.getTime()
      )
        throw new PortalError("DEPOSIT_QUOTE_PAYMENT_LATE", 409);
      await store.claim(b, {
        txHash: match.signature,
        logIndex: match.logIndex,
        blockHash: canonical.blockhash,
        amount: match.amount,
      });
      return {
        state: "Confirmed",
        reference: ref(a.key),
        amount: b.amount,
        asset: {
          kind: "blockchain",
          identifier: b.identifier,
          network: b.network,
        },
      };
    },
  };
}
