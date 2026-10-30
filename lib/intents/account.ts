// A merchant's NEAR Intents account (docs/near-intents.md).
//
// The merchant connects an account they own: a NEAR account (signs NEP-413
// with a full-access key) or an EVM address (signs ERC-191). Signing a
// one-time challenge proves control; PayRouta never holds the keys. Each
// stablecoin the merchant picks becomes a near-intents-deposit integration,
// so crypto checkouts for it settle into the account from any token on any
// chain, under the same live-scope review as receive-address pools. The
// merchant pays out and refunds from the account in payouts.ts.
import { createHash, randomBytes } from "node:crypto";
import bs58 from "bs58";
import { z } from "zod";
import { db } from "../portal/db";
import { atomic, audit, json } from "../portal/service";
import { stepUp, rateLimit } from "../portal/access";
import { PortalError } from "../portal/domain";
import { merchantMember } from "../merchant/access";
import { intentsDepositConfigSchema } from "../providers/adapters/native/near-intents-deposit";
import { chainNames, destinationFor, destinations } from "./oneclick";
import { fullAccessKey, intentsAccount, intentsBalances, intentsKeyRegistered } from "./near";
import { ed25519Signature, secp256k1Signature } from "./signing";
import { erc191Signer, verifyNep413 } from "./verify";

// NEP-413 `recipient`: who the signature is for.
export const signatureRecipient = "PayRouta";

export const units = (minor: string | bigint, decimals: number) => {
  const s = BigInt(minor).toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals),
    fraction = s.slice(s.length - decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
};

function liveOnly(environment: string) {
  // 1Click and NEAR Intents run on mainnet only.
  if (environment !== "production") throw new PortalError("INTENTS_LIVE_ONLY", 409);
}

export async function currentIntentsAccount(orgId: string, environment: string) {
  return db.intentsAccount.findFirst({ where: { orgId, environment, revokedAt: null }, orderBy: { createdAt: "desc" } });
}

// "network|identifier" of each stablecoin that settles into the connected
// account.
export async function intentsSettlementAssets(orgId: string, environment: string) {
  const account = await currentIntentsAccount(orgId, environment);
  if (!account) return new Set<string>();
  const integrations = await db.integration.findMany({ where: { orgId, environment } });
  return new Set(
    integrations.flatMap((i) => {
      const c = intentsDepositConfigSchema.safeParse(i.config);
      return c.success && c.data.intentsAccountId === account.id ? [`${c.data.network}|${c.data.identifier}`] : [];
    }),
  );
}

const challengeInput = z.object({ account: z.string().min(2).max(64) }).strict();
export async function intentsChallenge(orgId: string, raw: unknown, headers: Headers) {
  const { config } = await merchantMember(orgId, "configure", headers);
  liveOnly(config.environment);
  await rateLimit(`intents-challenge:${orgId}`, 20);
  const account = intentsAccount(challengeInput.parse(raw).account);
  if (!account) throw new PortalError("INTENTS_ACCOUNT_INVALID", 400);
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId } });
  const nonce = randomBytes(32).toString("base64"),
    expiresAt = new Date(Date.now() + 10 * 60000);
  const message = [
    `PayRouta: settle crypto payments for ${org.name} into NEAR Intents account ${account.accountId}.`,
    `Business: ${orgId}`,
    `Nonce: ${nonce}`,
    `Expires: ${expiresAt.toISOString()}`,
    "Signing proves you control this account. It does not move funds.",
  ].join("\n");
  const challenge = await db.intentsChallenge.create({
    data: { orgId, environment: config.environment, ...account, message, nonce, expiresAt },
  });
  return { id: challenge.id, ...account, message, nonce, recipient: signatureRecipient };
}

const connectInput = z
  .object({
    challengeId: z.string().min(1).max(100),
    // As the wallet returned them (lib/intents/signing.ts normalises).
    signature: z.string().min(10).max(200),
    publicKey: z.string().max(100).optional(),
    assets: z
      .array(z.object({ network: z.string().max(100), identifier: z.string().max(200) }).strict())
      .min(1)
      .max(destinations.length),
  })
  .strict();

export async function connectIntentsAccount(orgId: string, raw: unknown, headers: Headers, now = new Date()) {
  const { session, config } = await merchantMember(orgId, "configure", headers);
  liveOnly(config.environment);
  await stepUp(headers);
  await rateLimit(`intents-connect:${orgId}`, 10);
  const input = connectInput.parse(raw);
  const challenge = await db.intentsChallenge.findUnique({ where: { id: input.challengeId } });
  if (!challenge || challenge.orgId !== orgId || challenge.environment !== config.environment || challenge.usedAt || challenge.expiresAt <= now)
    throw new PortalError("INTENTS_CHALLENGE_EXPIRED", 409);
  const assets = input.assets.map((a) => destinationFor(a.network, a.identifier));
  if (assets.some((a) => !a) || new Set(assets).size !== assets.length) throw new PortalError("UNSUPPORTED_PAYMENT_ASSET", 409);

  let publicKey: string | null = null,
    signature: string;
  try {
    signature = challenge.standard === "erc191" ? secp256k1Signature(input.signature) : ed25519Signature(input.signature);
  } catch {
    throw new PortalError("INTENTS_SIGNATURE_INVALID", 403);
  }
  if (challenge.standard === "erc191") {
    if (erc191Signer(challenge.message, signature) !== challenge.accountId) throw new PortalError("INTENTS_SIGNATURE_INVALID", 403);
  } else {
    publicKey = input.publicKey ?? null;
    if (!publicKey || !verifyNep413({ message: challenge.message, nonce: challenge.nonce, recipient: signatureRecipient }, publicKey, signature))
      throw new PortalError("INTENTS_SIGNATURE_INVALID", 403);
    // An implicit account is its key; a named account must hold the key with
    // full access.
    const implicit = /^[0-9a-f]{64}$/.test(challenge.accountId);
    if (
      implicit
        ? Buffer.from(bs58.decode(publicKey.slice(8))).toString("hex") !== challenge.accountId
        : !(await fullAccessKey(challenge.accountId, publicKey))
    )
      throw new PortalError("INTENTS_KEY_NOT_ACCOUNT_OWNER", 403);
  }

  return atomic(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`stablecoins:${orgId}:${config.environment}`},0))`;
    const used = await tx.intentsChallenge.updateMany({ where: { id: challenge.id, usedAt: null }, data: { usedAt: now } });
    if (used.count !== 1) throw new PortalError("INTENTS_CHALLENGE_EXPIRED", 409);
    // One connected account per business: connecting another replaces it.
    await tx.intentsAccount.updateMany({ where: { orgId, environment: config.environment, revokedAt: null }, data: { revokedAt: now } });
    const account = await tx.intentsAccount.create({
      data: {
        orgId,
        environment: config.environment,
        accountId: challenge.accountId,
        standard: challenge.standard,
        publicKey,
        proof: json({ message: challenge.message, signature, verifiedAt: now.toISOString() }),
        createdBy: session.user.id,
      },
    });
    const latest = await tx.integration.findFirst({ where: { orgId, environment: config.environment }, orderBy: { version: "desc" } });
    let version = latest?.version ?? 0;
    const integrations = [];
    for (const asset of assets) {
      const settlement = intentsDepositConfigSchema.parse({
        mode: "NATIVE",
        adapter: "near-intents-deposit",
        environment: config.environment,
        network: asset!.network,
        identifier: asset!.identifier,
        account: account.accountId,
        intentsAccountId: account.id,
        accountId: `intents-${createHash("sha256").update(JSON.stringify([orgId, account.accountId, asset!.network, asset!.identifier])).digest("hex")}`,
      });
      integrations.push(
        await tx.integration.create({
          data: { orgId, environment: config.environment, version: ++version, config: json(settlement) },
        }),
      );
    }
    await audit(tx, orgId, session.user.id, "merchant.intents.connected", account.id, {
      accountId: account.accountId,
      standard: account.standard,
      assets: assets.map((a) => `${a!.symbol} ${a!.network}`),
      integrationIds: integrations.map((i) => i.id),
    });
    return { id: account.id, accountId: account.accountId, reviewRequired: true };
  });
}

export async function disconnectIntentsAccount(orgId: string, headers: Headers, now = new Date()) {
  const { session, config } = await merchantMember(orgId, "configure", headers);
  await stepUp(headers);
  return atomic(async (tx) => {
    const current = await tx.intentsAccount.findFirst({ where: { orgId, environment: config.environment, revokedAt: null } });
    if (!current) throw new PortalError("INTENTS_ACCOUNT_NOT_CONNECTED", 404);
    await tx.intentsAccount.update({ where: { id: current.id }, data: { revokedAt: now } });
    await audit(tx, orgId, session.user.id, "merchant.intents.disconnected", current.id, { accountId: current.accountId });
    return { ok: true };
  });
}

// The dashboard's view: the account, what it settles in, its balances, and
// recent intents payments that can be refunded.
export async function intentsOverview(orgId: string, environment: string) {
  const account = await currentIntentsAccount(orgId, environment);
  if (!account) return { account: null };
  const integrations = await db.integration.findMany({ where: { orgId, environment }, orderBy: { version: "desc" } });
  const settlement = integrations.flatMap((i) => {
    const c = intentsDepositConfigSchema.safeParse(i.config);
    return c.success && c.data.intentsAccountId === account.id ? [{ integrationId: i.id, ...destinationFor(c.data.network, c.data.identifier)! }] : [];
  });
  let balances: { assetId: string; symbol: string; chainName: string; amount: string }[] | null = null;
  try {
    const held = await intentsBalances(account.accountId, destinations.map((d) => d.assetId));
    balances = destinations
      .filter((d) => BigInt(held[d.assetId] ?? "0") > 0n)
      .map((d) => ({ assetId: d.assetId, symbol: d.symbol, chainName: chainNames[d.blockchain] ?? d.blockchain, amount: units(held[d.assetId], d.decimals) }));
  } catch {
    balances = null;
  }
  // NEAR accounts sign intents with a key intents.near knows; EVM and
  // implicit accounts need no registration.
  let keyRegistered = true;
  if (account.standard === "nep413" && account.publicKey && !/^[0-9a-f]{64}$/.test(account.accountId))
    keyRegistered = await intentsKeyRegistered(account.accountId, account.publicKey).catch(() => false);
  const paid = await db.paymentIntent.findMany({
    where: { orgId, environment, state: "Confirmed" },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, reference: true, amount: true, createdAt: true },
  });
  const swaps = await db.crossChainPayment.findMany({
    where: { recipientType: "INTENTS", status: "SUCCESS", intentId: { in: paid.map((p) => p.id) } },
    orderBy: { createdAt: "desc" },
  });
  const refunds = await db.intentsPayout.findMany({
    where: { orgId, environment, purpose: "refund", intentId: { in: swaps.map((s) => s.intentId) }, status: { notIn: ["FAILED", "REFUNDED", "EXPIRED"] } },
  });
  const payments = swaps.slice(0, 20).map((s) => {
    const p = paid.find((x) => x.id === s.intentId)!,
      d = destinations.find((x) => x.assetId === s.destinationAsset)!,
      refunded = refunds.filter((r) => r.intentId === s.intentId).reduce((n, r) => n + BigInt(r.amountIn), 0n);
    return {
      intentId: p.id,
      reference: p.reference,
      amount: units(s.amountOut, d.decimals),
      symbol: d.symbol,
      settlementAsset: d.assetId,
      paidWith: `${s.originSymbol} on ${chainNames[s.originChain] ?? s.originChain}`,
      originAsset: s.originAsset,
      refundTo: s.refundTo,
      refundable: units(BigInt(s.amountOut) - refunded, d.decimals),
      paidAt: p.createdAt.toISOString(),
    };
  });
  return {
    account: { id: account.id, accountId: account.accountId, standard: account.standard, publicKey: account.publicKey, keyRegistered, connectedAt: account.createdAt.toISOString() },
    settlement: settlement.map((s) => ({ integrationId: s.integrationId, symbol: s.symbol, network: s.network, identifier: s.identifier, chainName: chainNames[s.blockchain] ?? s.blockchain })),
    balances,
    payments,
  };
}
