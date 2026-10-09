import QRCode from "qrcode";
import { z } from "zod";
import { createHash } from "node:crypto";
import {
  StrKey,
  Keypair,
  Asset,
  TransactionBuilder,
  FeeBumpTransaction,
  xdr,
} from "@stellar/stellar-sdk";
import { chain } from "../../../blockchain/chains";
import { tokenMinor, validTokenAmount } from "../../../blockchain/assets";
import { paymentAsset, onchainMethod } from "../../../blockchain/crypto-assets";
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
  checkEnvironment,
  object,
  stableId,
  type NativeDeps,
} from "./common";
import type { ExecutionAdapter } from "../../normalized";
export const stellarDepositConfigSchema = z
  .object({
    ...nativeFields,
    adapter: z.literal("stellar-deposit").default("stellar-deposit"),
    network: z.enum(["stellar:pubnet", "stellar:testnet"]),
    identifier: z.string(),
    rpcKeyRef: secretRef.optional(),
    publicRpc: z.boolean().default(false),
    accountId: z.string().min(1).max(200).optional(),
    addresses: z
      .array(z.string().refine((v) => StrKey.isValidEd25519PublicKey(v)))
      .min(1)
      .max(1000)
      .refine((a) => new Set(a).size === a.length),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (
      (!c.rpcKeyRef && !c.publicRpc) ||
      !paymentAsset(c.network, c.identifier) ||
      chain(c.network)?.testnet !== (c.environment === "sandbox")
    )
      ctx.addIssue({
        code: "custom",
        message: "Unsupported Stellar token or network/environment mismatch",
      });
  });
export async function checkStellarNetwork(rpc: Rpc, network: string) {
  const n = object(await rpc("getNetwork", {}));
  if (n.passphrase !== chain(network)?.passphrase)
    throw new PortalError("RPC_CHAIN_MISMATCH", 502);
}
export async function stellarClosedLedger(rpc: Rpc) {
  const health = object(await rpc("getHealth", {}));
  if (health.status !== "healthy")
    throw new PortalError("STELLAR_RPC_NOT_HEALTHY", 503);
  return ledgerNumber(health.latestLedger);
}
export async function canonicalStellarLedger(
  rpc: Rpc,
  deps: NativeDeps,
  network: string,
  sequence: number,
  acceptBefore?: Date | null,
) {
  try {
    const r = object(
      await rpc("getLedgers", {
        startLedger: sequence,
        pagination: { limit: 1 },
        xdrFormat: "base64",
      }),
    );
    if (!Array.isArray(r.ledgers) || r.ledgers.length !== 1)
      throw new PortalError("INVALID_RPC_RESPONSE", 502);
    const header = xdr.LedgerHeaderHistoryEntry.fromXDR(
      String(object(r.ledgers[0]).headerXdr),
      "base64",
    );
    if (
      header.header.ledgerSeq !== sequence ||
      createHash("sha256").update(header.header.toXDR()).digest("hex") !==
        header.hash.toString()
    )
      throw new PortalError("DEPOSIT_RECEIPT_MISMATCH", 502);
    if (
      acceptBefore &&
      BigInt(header.header.scpValue.closeTime.toString()) * 1000n >=
        BigInt(acceptBefore.getTime())
    )
      throw new PortalError("DEPOSIT_QUOTE_PAYMENT_LATE", 409);
    return header.hash.toString();
  } catch (error) {
    if (!(error instanceof PortalError) || !error.message.startsWith("RPC_"))
      throw error;
    // Busy mainnet ledgers carry metadata larger than the bounded RPC response.
    // Horizon provides the same closed-ledger hash in a compact indexed response.
    const host = chain(network)?.testnet
      ? "https://horizon-testnet.stellar.org"
      : "https://horizon.stellar.org";
    const root = await deps.http(host, {
      method: "GET",
      path: "/",
      maxResponseBytes: 65536,
      timeoutMs: 8000,
    });
    if (
      root.status !== 200 ||
      object(JSON.parse(root.body)).network_passphrase !==
        chain(network)?.passphrase
    )
      throw new PortalError("RPC_CHAIN_MISMATCH", 502);
    const response = await deps.http(host, {
      method: "GET",
      path: `/ledgers/${sequence}`,
      maxResponseBytes: 65536,
      timeoutMs: 8000,
    });
    if (response.status !== 200)
      throw new PortalError("STELLAR_LEDGER_PROOF_UNAVAILABLE", 503);
    const ledger = object(JSON.parse(response.body));
    if (
      ledger.sequence !== sequence ||
      typeof ledger.hash !== "string" ||
      !/^[0-9a-f]{64}$/.test(ledger.hash)
    )
      throw new PortalError("DEPOSIT_RECEIPT_MISMATCH", 502);
    if (
      acceptBefore &&
      (typeof ledger.closed_at !== "string" ||
        !Number.isFinite(Date.parse(ledger.closed_at)) ||
        Date.parse(ledger.closed_at) >= acceptBefore.getTime())
    )
      throw new PortalError("DEPOSIT_QUOTE_PAYMENT_LATE", 409);
    return ledger.hash;
  }
}
export function stellarLedgerKeys(
  address: string,
  issuer: string,
  code = "USDC",
) {
  const accountId = Keypair.fromPublicKey(address).xdrPublicKey();
  return [
    xdr.LedgerKey.account(new xdr.LedgerKeyAccount({ accountId })).toXDR(
      "base64",
    ),
    xdr.LedgerKey.trustline(
      new xdr.LedgerKeyTrustLine({
        accountId,
        asset: new Asset(code, issuer).toTrustLineXDRObject(),
      }),
    ).toXDR("base64"),
  ];
}
export async function stellarAccount(rpc: Rpc, address: string) {
  const accountId = Keypair.fromPublicKey(address).xdrPublicKey();
  const key = xdr.LedgerKey.account(
    new xdr.LedgerKeyAccount({ accountId }),
  ).toXDR("base64");
  const r = object(await rpc("getLedgerEntries", { keys: [key] }));
  if (!Array.isArray(r.entries) || r.entries.length !== 1)
    throw new PortalError("STELLAR_ACCOUNT_NOT_FUNDED", 409);
  if (object(r.entries[0]).key !== key)
    throw new PortalError("INVALID_RPC_RESPONSE", 502);
  const data = xdr.LedgerEntryData.fromXDR(
    String(object(r.entries[0]).xdr),
    "base64",
  );
  if (
    data.type !== "account" ||
    StrKey.encodeEd25519PublicKey(data.account.accountId.ed25519.toBytes()) !==
      address
  )
    throw new PortalError("INVALID_RPC_RESPONSE", 502);
  return data.account;
}
export async function ensureStellarReceivable(
  rpc: Rpc,
  address: string,
  issuer: string,
  amount = "0",
  code = "USDC",
) {
  if (!issuer) {
    await stellarAccount(rpc, address);
    return;
  }
  const keys = stellarLedgerKeys(address, issuer, code),
    r = object(await rpc("getLedgerEntries", { keys }));
  if (!Array.isArray(r.entries) || r.entries.length !== 2)
    throw new PortalError(
      "STELLAR_RECEIVER_NEEDS_ACCOUNT_AND_TOKEN_TRUSTLINE",
      409,
    );
  const account = r.entries.map(object).find((e) => e.key === keys[0]),
    trust = r.entries.map(object).find((e) => e.key === keys[1]);
  if (!account || !trust)
    throw new PortalError(
      "STELLAR_RECEIVER_NEEDS_ACCOUNT_AND_TOKEN_TRUSTLINE",
      409,
    );
  const ad = xdr.LedgerEntryData.fromXDR(String(account.xdr), "base64");
  const td = xdr.LedgerEntryData.fromXDR(String(trust.xdr), "base64");
  if (ad.type !== "account" || td.type !== "trustline")
    throw new PortalError("INVALID_RPC_RESPONSE", 502);
  const a = ad.account,
    t = td.trustLine;
  if (
    StrKey.encodeEd25519PublicKey(a.accountId.ed25519.toBytes()) !== address ||
    StrKey.encodeEd25519PublicKey(t.accountId.ed25519.toBytes()) !== address ||
    t.asset.toXDR("base64") !==
      new Asset(code, issuer).toTrustLineXDRObject().toXDR("base64") ||
    !(t.flags & 1) ||
    BigInt(t.limit.toString()) - BigInt(t.balance.toString()) <
      tokenMinor(amount, 7)
  )
    throw new PortalError("STELLAR_TRUSTLINE_NOT_RECEIVABLE", 409);
}
export function verifyStellarTransfer(raw: unknown, b: DepositBinding) {
  const entry = object(raw);
  if (entry.status !== "SUCCESS") return [];
  const hash = String(entry.txHash),
    ledger = Number(entry.ledger);
  if (
    !/^[0-9a-f]{64}$/.test(hash) ||
    !Number.isSafeInteger(ledger) ||
    BigInt(ledger) < b.startBlock ||
    typeof entry.envelopeXdr !== "string" ||
    typeof entry.resultXdr !== "string"
  )
    throw new PortalError("DEPOSIT_RECEIPT_MISMATCH", 502);
  const parsed = TransactionBuilder.fromXDR(
    entry.envelopeXdr,
    chain(b.network)!.passphrase!,
  );
  if (Buffer.from(parsed.hash()).toString("hex") !== hash)
    throw new PortalError("DEPOSIT_RECEIPT_MISMATCH", 502);
  const result = xdr.TransactionResult.fromXDR(entry.resultXdr, "base64");
  const tx =
    parsed instanceof FeeBumpTransaction ? parsed.innerTransaction : parsed;
  let operationResults: xdr.OperationResult[];
  if (parsed instanceof FeeBumpTransaction) {
    if (
      result.result.type !== "txFeeBumpInnerSuccess" ||
      !Buffer.from(
        result.result.innerResultPair.transactionHash.toBytes(),
      ).equals(Buffer.from(tx.hash())) ||
      result.result.innerResultPair.result.result.type !== "txSuccess"
    )
      throw new PortalError("DEPOSIT_RECEIPT_MISMATCH", 502);
    operationResults = result.result.innerResultPair.result.result.results;
  } else {
    if (result.result.type !== "txSuccess")
      throw new PortalError("DEPOSIT_RECEIPT_MISMATCH", 502);
    operationResults = result.result.results;
  }
  if (operationResults.length !== tx.operations.length)
    throw new PortalError("DEPOSIT_RECEIPT_MISMATCH", 502);
  const token = paymentAsset(b.network, b.identifier)!;
  const out: {
    txHash: string;
    ledger: number;
    logIndex: string;
    amount: string;
  }[] = [];
  for (const [index, op] of tx.operations.entries()) {
    if (
      op.type !== "payment" ||
      op.destination !== b.address ||
      (token.contractAddress
        ? op.asset.isNative() ||
          op.asset.getCode() !== token.symbol ||
          op.asset.getIssuer() !== token.contractAddress
        : !op.asset.isNative())
    )
      continue;
    const operationResult = operationResults[index];
    if (
      operationResult.type !== "opInner" ||
      operationResult.tr.type !== "payment" ||
      operationResult.tr.paymentResult.type !== "paymentSuccess"
    )
      throw new PortalError("DEPOSIT_RECEIPT_MISMATCH", 502);
    if ((op.source || tx.source) === b.address)
      throw new PortalError("DEPOSIT_SELF_TRANSFER", 409);
    if (
      !validTokenAmount(op.amount, 7) ||
      tokenMinor(op.amount, 7) !== tokenMinor(b.amount, b.precision)
    )
      throw new PortalError("DEPOSIT_AMOUNT_MISMATCH", 409);
    out.push({
      txHash: hash,
      ledger,
      logIndex: `op:${index}`,
      amount: op.amount,
    });
  }
  return out;
}
function ledgerNumber(raw: unknown) {
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 0)
    throw new PortalError("INVALID_RPC_RESPONSE", 502);
  return n;
}
export function stellarDepositExecutionAdapter(
  config: unknown,
  deps: NativeDeps,
): ExecutionAdapter {
  const c = parseConfig(stellarDepositConfigSchema, config),
    token = paymentAsset(c.network, c.identifier)!;
  const store: DepositStore | undefined = deps.deposits;
  if (!store) throw new PortalError("DEPOSIT_STORE_NOT_CONFIGURED", 409);
  const rpc = alchemyReader(c, deps),
    ref = (key: string) => `deposit-${stableId(key, 48)}`;
  async function action(b: DepositBinding) {
    const uri = `web+stellar:pay?destination=${b.address}&amount=${b.amount}${token.contractAddress ? `&asset_code=${token.symbol}&asset_issuer=${token.contractAddress}` : ""}`;
    return {
      kind: "deposit",
      provider: "PayRouta",
      text: `Send ${b.amount} ${token.symbol} on ${chain(c.network)!.name}`,
      address: b.address,
      network: b.network,
      identifier: b.identifier,
      amount: b.amount,
      symbol: token.symbol,
      code: uri,
      image: await QRCode.toDataURL(uri, { width: 240, margin: 2 }),
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
        i.precision !== 7 ||
        !validTokenAmount(i.amount, 7) ||
        tokenMinor(i.amount, 7) <= 0n
      )
        throw new PortalError("UNSUPPORTED_PAYMENT_ASSET", 409);
      await checkStellarNetwork(rpc, c.network);
      const old = await store.find(a.id),
        head = await stellarClosedLedger(rpc);
      const b =
        old ??
        (await store.allocate({
          attemptId: a.id,
          attemptKey: a.key,
          environment: a.environment,
          network: c.network,
          identifier: c.identifier,
          amount: i.amount,
          precision: 7,
          startBlock: BigInt(head) + 1n,
          addresses: c.addresses,
        }));
      if (
        b.attemptKey !== a.key ||
        b.network !== c.network ||
        b.identifier !== c.identifier ||
        b.environment !== c.environment ||
        b.amount !== i.amount ||
        b.precision !== 7
      )
        throw new PortalError("DEPOSIT_BINDING_MISMATCH", 409);
      await ensureStellarReceivable(
        rpc,
        b.address,
        token.contractAddress,
        b.amount,
        token.symbol,
      );
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
      const pending = async () => ({
        state: "Requires action",
        reference: ref(a.key),
        amount: b.amount,
        asset: {
          kind: "blockchain",
          identifier: b.identifier,
          network: b.network,
        },
        action: await action(b),
      });
      await checkStellarNetwork(rpc, c.network);
      const latest = await stellarClosedLedger(rpc);
      const checkpoint = store.checkpoint
        ? await store.checkpoint(b)
        : { nextBlock: b.startBlock, cursor: null };
      if (checkpoint.nextBlock > BigInt(latest)) return pending();
      let cursor = checkpoint.cursor ?? undefined,
        complete = false;
      const matches: ReturnType<typeof verifyStellarTransfer> = [];
      for (let page = 0; page < 20; page++) {
        const batch = object(
          await rpc("getTransactions", {
            ...(cursor ? {} : { startLedger: Number(checkpoint.nextBlock) }),
            pagination: { limit: 25, ...(cursor ? { cursor } : {}) },
            xdrFormat: "base64",
          }),
        );
        if (checkpoint.nextBlock < BigInt(ledgerNumber(batch.oldestLedger)))
          throw new PortalError(
            "DEPOSIT_HISTORY_EXPIRED_REQUIRES_INSPECTION",
            409,
          );
        if (
          !Array.isArray(batch.transactions) ||
          batch.transactions.length > 25
        )
          throw new PortalError("INVALID_RPC_RESPONSE", 502);
        for (const raw of batch.transactions) {
          const t = object(raw);
          if (ledgerNumber(t.ledger) <= latest)
            matches.push(...verifyStellarTransfer(t, b));
        }
        if (
          batch.transactions.length < 25 ||
          batch.transactions.some(
            (t) => ledgerNumber(object(t).ledger) > latest,
          )
        ) {
          complete = true;
          break;
        }
        if (typeof batch.cursor !== "string" || batch.cursor === cursor)
          throw new PortalError("INVALID_RPC_RESPONSE", 502);
        cursor = batch.cursor;
      }
      if (matches.length > 1)
        throw new PortalError("DEPOSIT_MULTIPLE_TRANSFERS", 409);
      if (!complete) {
        if (matches.length)
          throw new PortalError("DEPOSIT_SCAN_REQUIRES_INSPECTION", 409);
        if (store.advanceCheckpoint && cursor)
          await store.advanceCheckpoint(
            b,
            checkpoint.nextBlock,
            cursor,
            checkpoint,
          );
        return pending();
      }
      if (!matches.length) {
        if (store.advanceCheckpoint)
          await store.advanceCheckpoint(
            b,
            BigInt(latest) + 1n,
            null,
            checkpoint,
          );
        return pending();
      }
      const match = matches[0];
      const final = object(
        await rpc("getTransaction", {
          hash: match.txHash,
          xdrFormat: "base64",
        }),
      );
      if (final.status === "NOT_FOUND") return pending();
      const verified = verifyStellarTransfer(
        { ...final, txHash: match.txHash },
        b,
      );
      if (
        verified.length !== 1 ||
        verified[0].ledger !== match.ledger ||
        verified[0].logIndex !== match.logIndex
      )
        throw new PortalError("DEPOSIT_RECEIPT_MISMATCH", 502);
      const blockHash = await canonicalStellarLedger(
        rpc,
        deps,
        c.network,
        match.ledger,
        b.acceptBefore,
      );
      await store.claim(b, {
        txHash: match.txHash,
        logIndex: match.logIndex,
        blockHash,
        amount: match.amount,
      });
      return {
        state: "Confirmed",
        reference: ref(a.key),
        amount: match.amount,
        asset: {
          kind: "blockchain",
          identifier: b.identifier,
          network: b.network,
        },
      };
    },
  };
}
