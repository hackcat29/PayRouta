import { PublicKey, Transaction, SystemProgram } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
} from "./solana-token";
import {
  Account,
  Asset,
  Operation,
  StrKey,
  TransactionBuilder,
  FeeBumpTransaction,
  Keypair,
} from "@stellar/stellar-sdk";
import bs58 from "bs58";
import { chain } from "./chains";
import { tokenMinor } from "./assets";
import { alchemyReader, type Rpc } from "./alchemy-rpc";
import { checkSolanaNetwork } from "../providers/adapters/native/solana-deposit";
import {
  checkStellarNetwork,
  stellarAccount,
  ensureStellarReceivable,
} from "../providers/adapters/native/stellar-deposit";
import { stablecoinDepositConfig } from "./deposit-config";
import { providerRequest } from "../providers/adapters/http";
import { secretManager } from "../portal/adapters";
import { enforceRisk } from "../merchant/policy";
import { stablecoinCandidates } from "../payments/stablecoin-routes";
import { queue, authorizeSession } from "../payments/service";
import { db } from "../portal/db";
import { atomic } from "../portal/service";
import { hash } from "../payments/contracts";
import { PortalError } from "../portal/domain";
import { object } from "../providers/adapters/native/common";
async function scope(id: string, token: string, now: Date) {
  const session = await authorizeSession(id, token, now);
  const attempt = await db.paymentAttempt.findFirst({
    where: { intentId: session.intent.id },
    orderBy: { number: "desc" },
  });
  if (!attempt || !["Requires action", "Unknown"].includes(attempt.state))
    throw new PortalError("PAYMENT_NOT_AWAITING_TRANSFER", 409);
  const binding = await db.depositBinding.findUniqueOrThrow({
    where: { attemptId: attempt.id },
  });
  const integration = await db.integration.findUniqueOrThrow({
    where: { id: attempt.integrationId },
  });
  const config = stablecoinDepositConfig.parse(integration.config);
  const network = chain(binding.network)!;
  if (
    network.family === "evm" ||
    binding.integrationId !== integration.id ||
    binding.environment !== session.intent.environment ||
    attempt.providerOrgId !== session.intent.orgId ||
    integration.orgId !== session.intent.orgId ||
    binding.network !== config.network ||
    binding.identifier !== config.identifier
  )
    throw new PortalError("WALLET_SCOPE_MISMATCH", 409);
  await allowWalletPayment(session.intent, attempt.integrationId, now);
  const rpc = alchemyReader(config, {
    http: providerRequest,
    credentials: secretManager,
  });
  if (network.family === "solana") await checkSolanaNetwork(rpc, network.id);
  else await checkStellarNetwork(rpc, network.id);
  return { intent: session.intent, attempt, binding, network, rpc };
}
async function allowWalletPayment(
  intent: Parameters<typeof enforceRisk>[1],
  integrationId: string,
  now: Date,
) {
  const risk = await atomic((tx) => enforceRisk(tx, intent, now, false));
  if (risk.decision !== "Allow")
    throw new PortalError("PAYMENT_REQUIRES_REVIEW", 409);
  const candidates = await stablecoinCandidates(
    intent.orgId,
    intent.environment,
    intent.asset,
    db,
    intent.id,
  );
  if (!candidates.some((c) => c.integrationId === integrationId))
    throw new PortalError("PROVIDER_RESTRICTED", 409);
}
export async function buildSolanaWalletTransaction(
  rpc: Rpc,
  payer: string,
  payment: {
    address: string;
    identifier: string;
    amount: string;
    precision: number;
  },
) {
  const owner = new PublicKey(payer),
    destination = new PublicKey(payment.address),
    mint = payment.identifier.startsWith("native:")
      ? null
      : new PublicKey(payment.identifier.slice(4));
  if (!PublicKey.isOnCurve(owner.toBytes()) || owner.equals(destination))
    throw new PortalError("INVALID_PAYER_ADDRESS", 409);
  const source = mint ? getAssociatedTokenAddressSync(mint, owner) : null,
    target = mint ? getAssociatedTokenAddressSync(mint, destination) : null;
  const latest = object(
      await rpc("getLatestBlockhash", [{ commitment: "confirmed" }]),
    ),
    value = object(latest.value);
  if (typeof value.blockhash !== "string")
    throw new PortalError("INVALID_RPC_RESPONSE", 502);
  const tx = new Transaction({
    feePayer: owner,
    recentBlockhash: value.blockhash,
  });
  if (!mint)
    tx.add(
      SystemProgram.transfer({
        fromPubkey: owner,
        toPubkey: destination,
        lamports: tokenMinor(payment.amount, payment.precision),
      }),
    );
  else
    tx.add(
      createAssociatedTokenAccountIdempotentInstruction(
        owner,
        target!,
        destination,
        mint,
      ),
      createTransferCheckedInstruction(
        source!,
        mint,
        target!,
        owner,
        tokenMinor(payment.amount, payment.precision),
        payment.precision,
      ),
    );
  return {
    unsigned: tx
      .serialize({ requireAllSignatures: false, verifySignatures: false })
      .toString("base64"),
    messageHash: hash(tx.serializeMessage().toString("base64")),
  };
}
export async function buildStellarWalletTransaction(
  rpc: Rpc,
  network: string,
  payer: string,
  payment: { address: string; identifier: string; amount: string },
) {
  if (!StrKey.isValidEd25519PublicKey(payer) || payer === payment.address)
    throw new PortalError("INVALID_PAYER_ADDRESS", 409);
  const [code, issuer] =
    payment.identifier === "native:XLM"
      ? ["XLM", ""]
      : payment.identifier.slice("stellar:".length).split(".");
  await ensureStellarReceivable(
    rpc,
    payment.address,
    issuer,
    payment.amount,
    code,
  );
  const account = await stellarAccount(rpc, payer);
  const stats = object(await rpc("getFeeStats", {})),
    fees = object(stats.inclusionFee);
  const fee = String(fees.p70 ?? "100");
  if (!/^\d+$/.test(fee) || BigInt(fee) > 100000n)
    throw new PortalError("STELLAR_FEE_REQUIRES_REVIEW", 409);
  const tx = new TransactionBuilder(
    new Account(payer, account.seqNum.toString()),
    {
      fee: BigInt(fee) < 100n ? "100" : fee,
      networkPassphrase: chain(network)!.passphrase!,
    },
  )
    .addOperation(
      Operation.payment({
        destination: payment.address,
        asset: issuer ? new Asset(code, issuer) : Asset.native(),
        amount: payment.amount,
      }),
    )
    .setTimeout(60)
    .build();
  return {
    unsigned: tx.toXDR(),
    messageHash: Buffer.from(tx.hash()).toString("hex"),
  };
}
export async function prepareWalletTransaction(
  id: string,
  token: string,
  payer: string,
  now = new Date(),
) {
  const { intent, attempt, binding, network, rpc } = await scope(
    id,
    token,
    now,
  );
  const old = await db.walletSubmission.findUnique({
    where: { attemptId: attempt.id },
  });
  if (old && old.state !== "Prepared")
    throw new PortalError("WALLET_SUBMISSION_UNCERTAIN", 409);
  if (old && old.expiresAt > now) {
    if (old.payer !== payer) throw new PortalError("WALLET_PAYER_LOCKED", 409);
    return {
      submissionId: old.id,
      unsigned: old.unsigned,
      network: old.network,
      payer: old.payer,
      expiresAt: old.expiresAt.toISOString(),
    };
  }
  const built =
    network.family === "solana"
      ? await buildSolanaWalletTransaction(rpc, payer, binding)
      : await buildStellarWalletTransaction(rpc, network.id, payer, binding);
  const expiry = new Date(
    Math.min(intent.expiresAt.getTime(), now.getTime() + 60000),
  );
  return atomic(async (tx) => {
    const currentAttempt = await tx.paymentAttempt.findUniqueOrThrow({
      where: { id: attempt.id },
    });
    if (!["Requires action", "Unknown"].includes(currentAttempt.state))
      throw new PortalError("PAYMENT_NOT_AWAITING_TRANSFER", 409);
    const current = await tx.walletSubmission.findUnique({
      where: { attemptId: attempt.id },
    });
    if (current && current.state !== "Prepared")
      throw new PortalError("WALLET_SUBMISSION_UNCERTAIN", 409);
    if (current && current.expiresAt > now) {
      if (current.payer !== payer)
        throw new PortalError("WALLET_PAYER_LOCKED", 409);
      return {
        submissionId: current.id,
        unsigned: current.unsigned,
        network: current.network,
        payer: current.payer,
        expiresAt: current.expiresAt.toISOString(),
      };
    }
    const data = {
      orgId: intent.orgId,
      network: network.id,
      payer,
      ...built,
      expiresAt: expiry,
    };
    const record = await tx.walletSubmission.upsert({
      where: { attemptId: attempt.id },
      create: { attemptId: attempt.id, ...data },
      update: data,
    });
    return {
      submissionId: record.id,
      unsigned: record.unsigned,
      network: record.network,
      payer: record.payer,
      expiresAt: record.expiresAt.toISOString(),
    };
  });
}
export function verifySignedWalletTransaction(
  network: string,
  payer: string,
  messageHash: string,
  signed: string,
) {
  if (signed.length > 30000)
    throw new PortalError("INVALID_SIGNED_TRANSACTION", 400);
  if (chain(network)?.family === "solana") {
    const tx = Transaction.from(Buffer.from(signed, "base64"));
    if (
      !tx.feePayer ||
      tx.feePayer.toBase58() !== payer ||
      hash(tx.serializeMessage().toString("base64")) !== messageHash ||
      !tx.verifySignatures()
    )
      throw new PortalError("SIGNED_TRANSACTION_MISMATCH", 409);
    if (!tx.signature) throw new PortalError("INVALID_SIGNED_TRANSACTION", 409);
    return bs58.encode(tx.signature);
  }
  const tx = TransactionBuilder.fromXDR(signed, chain(network)!.passphrase!);
  if (
    tx instanceof FeeBumpTransaction ||
    tx.source !== payer ||
    Buffer.from(tx.hash()).toString("hex") !== messageHash ||
    !tx.signatures.some((s) =>
      Keypair.fromPublicKey(payer).verify(tx.hash(), s.signature.toBytes()),
    )
  )
    throw new PortalError("SIGNED_TRANSACTION_MISMATCH", 409);
  return Buffer.from(tx.hash()).toString("hex");
}
export async function submitWalletTransaction(
  id: string,
  token: string,
  submissionId: string,
  signed: string,
  now = new Date(),
) {
  const { intent, attempt, network } = await scope(id, token, now);
  const prepared = await db.walletSubmission.findFirst({
    where: {
      id: submissionId,
      attemptId: attempt.id,
      orgId: intent.orgId,
      network: network.id,
    },
  });
  if (!prepared) throw new PortalError("WALLET_SCOPE_MISMATCH", 409);
  const txHash = verifySignedWalletTransaction(
    network.id,
    prepared.payer,
    prepared.messageHash,
    signed,
  );
  if (prepared.state === "Submitted" && prepared.transactionHash === txHash)
    return { transactionHash: txHash };
  if (prepared.expiresAt <= now)
    throw new PortalError("WALLET_TRANSACTION_EXPIRED", 409);
  await atomic(async (tx) => {
    const reserved = await tx.walletSubmission.updateMany({
      where: { id: prepared.id, state: "Prepared", expiresAt: { gt: now } },
      data: { state: "Sending", transactionHash: txHash, signed },
    });
    if (reserved.count !== 1)
      throw new PortalError("WALLET_SUBMISSION_UNCERTAIN", 409);
    await queue(
      tx,
      intent.orgId,
      "payment-wallet-relay",
      `wallet-relay:${prepared.id}`,
      { submissionId: prepared.id },
      new Date(now.getTime() + 3000),
    );
  });
  await relayWalletSubmission(prepared.id);
  return { transactionHash: txHash };
}
export async function relayWalletSubmission(
  submissionId: string,
  now = new Date(),
) {
  const prepared = await db.walletSubmission.findUniqueOrThrow({
    where: { id: submissionId },
  });
  if (prepared.state === "Submitted" || prepared.expiresAt <= now) return;
  if (
    !prepared.signed ||
    !prepared.transactionHash ||
    !["Sending", "Unknown"].includes(prepared.state)
  )
    throw new PortalError("INVALID_WALLET_RELAY", 409);
  const attempt = await db.paymentAttempt.findUniqueOrThrow({
    where: { id: prepared.attemptId },
    include: { intent: true },
  });
  if (
    attempt.intent.orgId !== prepared.orgId ||
    attempt.intent.expiresAt <= now ||
    attempt.intent.state === "Confirmed"
  )
    return;
  const integration = await db.integration.findUniqueOrThrow({
    where: { id: attempt.integrationId },
  });
  if (
    integration.orgId !== prepared.orgId ||
    integration.environment !== attempt.environment
  )
    throw new PortalError("WALLET_SCOPE_MISMATCH", 409);
  await allowWalletPayment(attempt.intent, integration.id, now);
  const config = stablecoinDepositConfig.parse(integration.config),
    network = chain(prepared.network)!;
  if (config.network !== prepared.network)
    throw new PortalError("WALLET_SCOPE_MISMATCH", 409);
  const rpc = alchemyReader(config, {
    http: providerRequest,
    credentials: secretManager,
  });
  if (network.family === "solana") await checkSolanaNetwork(rpc, network.id);
  else await checkStellarNetwork(rpc, network.id);
  const signed = prepared.signed,
    txHash = verifySignedWalletTransaction(
      prepared.network,
      prepared.payer,
      prepared.messageHash,
      signed,
    );
  if (txHash !== prepared.transactionHash)
    throw new PortalError("SIGNED_TRANSACTION_MISMATCH", 409);
  try {
    if (network.family === "solana") {
      const returned = await rpc("sendTransaction", [
        signed,
        {
          encoding: "base64",
          skipPreflight: false,
          preflightCommitment: "confirmed",
          maxRetries: 0,
        },
      ]);
      if (returned !== txHash)
        throw new PortalError("WALLET_SUBMISSION_UNCERTAIN", 409);
    } else {
      const result = object(
        await rpc("sendTransaction", { transaction: signed }),
      );
      if (
        !["PENDING", "DUPLICATE"].includes(String(result.status)) ||
        result.hash !== txHash
      )
        throw new PortalError("WALLET_SUBMISSION_UNCERTAIN", 409);
    }
    await db.walletSubmission.update({
      where: { id: prepared.id },
      data: { state: "Submitted" },
    });
    return;
  } catch {
    await db.walletSubmission.updateMany({
      where: { id: prepared.id, state: { in: ["Sending", "Unknown"] } },
      data: { state: "Unknown" },
    });
    throw new PortalError("WALLET_SUBMISSION_UNCERTAIN", 409);
  }
}
