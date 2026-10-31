// Agent keys (docs/agents.md): a business gives an AI agent a key to pay
// through the agent API, and the limits it may spend within: a budget per
// day, week or month, a cap per payment, and optionally the merchants it may
// pay and the NEAR Intents account it pays from.
//
// The limits apply to payments made with the key. The agent's wallet stays
// the agent owner's: PayRouta never holds its funds or keys, so the limits
// bound what PayRouta prepares and submits, and revoking the key stops it.
import { randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { db } from "../portal/db";
import { atomic, audit, json } from "../portal/service";
import { stepUp, rateLimit } from "../portal/access";
import { PortalError } from "../portal/domain";
import { merchantMember } from "../merchant/access";
import { hash, minor } from "../payments/contracts";
import { intentsAccount } from "../intents/near";
import type { Tx } from "../payments/service";

export const periods = ["day", "week", "month"] as const;
export type Period = (typeof periods)[number];

const dollars = z
  .string()
  .trim()
  .regex(/^\d{1,9}(\.\d{1,2})?$/, "INVALID_AMOUNT");
export const agentKeyInput = z
  .object({
    name: z.string().trim().min(1).max(60),
    budget: dollars,
    period: z.enum(periods),
    perPayment: dollars,
    // Payment link URLs or slugs, or merchant ids. Empty: any merchant.
    merchants: z.array(z.string().trim().min(1).max(300)).max(50).default([]),
    payer: z.string().trim().max(64).optional(),
  })
  .strict();

const cents = (value: string) => minor(value, 2);

// Start of the current budget period, in UTC. Weeks start on Monday.
export function periodStart(period: Period, now: Date) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (period === "week") d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  if (period === "month") d.setUTCDate(1);
  return d;
}

export type Policy = {
  budgetMinor: bigint;
  perPaymentMinor: bigint;
  merchants: string[];
  payer: string | null;
};
// Whether one more payment fits the key's limits.
export function checkPolicy(policy: Policy, payment: { merchant: string; amountMinor: bigint; payer?: string | null; spentMinor: bigint }) {
  if (policy.merchants.length && !policy.merchants.includes(payment.merchant)) throw new PortalError("AGENT_MERCHANT_NOT_ALLOWED", 403);
  if (policy.payer && payment.payer && policy.payer !== payment.payer) throw new PortalError("AGENT_PAYER_NOT_ALLOWED", 403);
  if (payment.amountMinor > policy.perPaymentMinor) throw new PortalError("AGENT_PAYMENT_OVER_LIMIT", 403);
  if (payment.spentMinor + payment.amountMinor > policy.budgetMinor) throw new PortalError("AGENT_BUDGET_EXCEEDED", 403);
}

// A payment link (URL or slug) or merchant id, as the merchant's org id.
async function merchantOf(entry: string) {
  const slug = entry.match(/\/pay\/([A-Za-z0-9]{6,40})(?:[/?#]|$)/)?.[1] ?? (/^[A-Za-z0-9]{6,40}$/.test(entry) ? entry : null);
  if (slug) {
    const link = await db.paymentLink.findUnique({ where: { slug } });
    if (link) return link.orgId;
  }
  const org = await db.organization.findUnique({ where: { id: entry } });
  if (org) return org.id;
  throw new PortalError("AGENT_MERCHANT_UNKNOWN", 400);
}

export async function issueAgentKey(orgId: string, raw: unknown, headers: Headers) {
  const { session, config } = await merchantMember(orgId, "configure", headers);
  await stepUp(headers);
  await rateLimit(`agent-key:${orgId}`, 20);
  const input = agentKeyInput.parse(raw);
  const budgetMinor = cents(input.budget),
    perPaymentMinor = cents(input.perPayment);
  if (budgetMinor <= 0n || perPaymentMinor <= 0n || perPaymentMinor > budgetMinor) throw new PortalError("AGENT_LIMITS_INVALID", 400);
  const payer = input.payer ? intentsAccount(input.payer) : null;
  if (input.payer && !payer) throw new PortalError("INTENTS_ACCOUNT_INVALID", 400);
  const merchants = [...new Set(await Promise.all(input.merchants.map(merchantOf)))];
  const secret = `pra_${config.environment}_${randomBytes(32).toString("base64url")}`;
  const key = await atomic(async (tx) => {
    const key = await tx.agentKey.create({
      data: {
        orgId,
        environment: config.environment,
        name: input.name,
        prefix: secret.slice(0, 22),
        verifier: hash(secret),
        budgetMinor: budgetMinor.toString(),
        period: input.period,
        perPaymentMinor: perPaymentMinor.toString(),
        merchants: json(merchants),
        payer: payer?.accountId ?? null,
        createdBy: session.user.id,
      },
    });
    await audit(tx, orgId, session.user.id, "merchant.agent_key.created", key.id, {
      name: input.name,
      budget: input.budget,
      period: input.period,
      perPayment: input.perPayment,
      merchants,
      payer: key.payer,
    });
    return key;
  });
  return { id: key.id, secret, prefix: key.prefix };
}

export async function revokeAgentKey(orgId: string, id: string, headers: Headers) {
  const { session } = await merchantMember(orgId, "configure", headers);
  await stepUp(headers);
  return atomic(async (tx) => {
    const key = await tx.agentKey.findFirst({ where: { id, orgId } });
    if (!key) throw new PortalError("NOT_FOUND", 404);
    await tx.agentKey.update({ where: { id }, data: { revokedAt: new Date() } });
    await audit(tx, orgId, session.user.id, "merchant.agent_key.revoked", id);
    return { id, revoked: true };
  });
}

// The agent key on a request, if it sent one. A malformed or revoked key is
// refused rather than ignored, so an agent never pays without its limits.
export async function agentKeyFrom(request: Request) {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const secret = header.match(/^Bearer (pra_(?:sandbox|production)_[\w-]{43})$/)?.[1];
  if (!secret) throw new PortalError("UNAUTHORIZED", 401);
  const verifier = hash(secret);
  const key = await db.agentKey.findUnique({ where: { verifier } });
  if (!key || !timingSafeEqual(Buffer.from(key.verifier), Buffer.from(verifier)) || key.revokedAt) throw new PortalError("UNAUTHORIZED", 401);
  await db.agentKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } });
  return key;
}
export type AgentKey = NonNullable<Awaited<ReturnType<typeof agentKeyFrom>>>;

// Reserved spends settle as their payments do: spent once confirmed,
// released once the checkout ends unpaid or its swap is refunded.
async function settleSpends(tx: Tx, keyId: string, now: Date) {
  const reserved = await tx.agentSpend.findMany({ where: { keyId, state: "Reserved" } });
  for (const s of reserved) {
    const intent = await tx.paymentIntent.findUnique({ where: { id: s.intentId } });
    const payment = s.paymentId ? await tx.crossChainPayment.findUnique({ where: { id: s.paymentId } }) : null;
    const state =
      intent?.state === "Confirmed"
        ? "Spent"
        : !intent ||
            ["Rejected", "Cancelled"].includes(intent.state) ||
            intent.expiresAt <= now ||
            ["REFUNDED", "FAILED"].includes(payment?.status ?? "")
          ? "Released"
          : null;
    if (state) await tx.agentSpend.update({ where: { id: s.id }, data: { state } });
  }
}

export async function spentThisPeriod(tx: Tx, key: { id: string; period: string }, now: Date) {
  await settleSpends(tx, key.id, now);
  const rows = await tx.agentSpend.findMany({
    where: { keyId: key.id, state: { in: ["Reserved", "Spent"] }, createdAt: { gte: periodStart(key.period as Period, now) } },
    select: { amountMinor: true },
  });
  return rows.reduce((n, r) => n + BigInt(r.amountMinor.toFixed(0)), 0n);
}

// Reserve a payment against the key's limits, once per checkout.
export async function reserveSpend(
  key: AgentKey,
  payment: { intentId: string; environment: string; merchant: string; amountMinor: bigint; payer?: string | null; paymentId?: string },
  now = new Date(),
) {
  if (key.environment !== payment.environment) throw new PortalError("ENVIRONMENT_MISMATCH", 403);
  return atomic(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`agent-key:${key.id}`},0))`;
    const existing = await tx.agentSpend.findUnique({ where: { keyId_intentId: { keyId: key.id, intentId: payment.intentId } } });
    const spent = (await spentThisPeriod(tx, key, now)) - (existing && existing.state !== "Released" ? BigInt(existing.amountMinor.toFixed(0)) : 0n);
    checkPolicy(
      {
        budgetMinor: BigInt(key.budgetMinor.toFixed(0)),
        perPaymentMinor: BigInt(key.perPaymentMinor.toFixed(0)),
        merchants: key.merchants as string[],
        payer: key.payer,
      },
      { merchant: payment.merchant, amountMinor: payment.amountMinor, payer: payment.payer, spentMinor: spent },
    );
    const data = { amountMinor: payment.amountMinor.toString(), state: "Reserved", ...(payment.paymentId ? { paymentId: payment.paymentId } : {}) };
    return tx.agentSpend.upsert({
      where: { keyId_intentId: { keyId: key.id, intentId: payment.intentId } },
      create: { keyId: key.id, intentId: payment.intentId, ...data },
      update: data,
    });
  });
}

// The dashboard's list: each key, its limits and what it has spent this period.
export async function agentKeys(orgId: string, environment: string, now = new Date()) {
  const keys = await db.agentKey.findMany({ where: { orgId, environment }, orderBy: { createdAt: "desc" }, take: 50 });
  return Promise.all(
    keys.map(async (k) => ({
      id: k.id,
      name: k.name,
      prefix: k.prefix,
      period: k.period,
      budgetMinor: k.budgetMinor.toFixed(0),
      perPaymentMinor: k.perPaymentMinor.toFixed(0),
      merchants: (k.merchants as string[]).length,
      payer: k.payer,
      spentMinor: k.revokedAt ? "0" : (await atomic((tx) => spentThisPeriod(tx, k, now))).toString(),
      lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
      revoked: !!k.revokedAt,
      createdAt: k.createdAt.toISOString(),
    })),
  );
}
