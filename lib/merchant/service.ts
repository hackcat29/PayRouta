import { randomBytes } from "node:crypto";
import { db } from "../portal/db";
import { PortalError } from "../portal/domain";
import { atomic, audit } from "../portal/service";
import { secretManager } from "../portal/adapters";
import { validateEndpoint } from "../portal/ssrf";
import { hash } from "../payments/contracts";
import { queue } from "../payments/service";
import { pageInput, toPublicIntent, webhookInput } from "./contracts";
import { z } from "zod";
export type Scope = { orgId: string; environment: string };
export function pagination(params: URLSearchParams) {
  const p = pageInput.parse(Object.fromEntries(params));
  if (p.from && p.to && new Date(p.from) >= new Date(p.to))
    throw new PortalError("INVALID_DATE_RANGE");
  let after: { createdAt: Date; id: string } | undefined;
  if (p.cursor) {
    try {
      const v = z
        .object({ at: z.iso.datetime(), id: z.string().min(1).max(100) })
        .strict()
        .parse(JSON.parse(Buffer.from(p.cursor, "base64url").toString()));
      after = { createdAt: new Date(v.at), id: v.id };
    } catch {
      throw new PortalError("INVALID_CURSOR");
    }
  }
  return {
    ...p,
    after: after
      ? {
          OR: [
            { createdAt: { lt: after.createdAt } },
            { createdAt: after.createdAt, id: { lt: after.id } },
          ],
        }
      : {},
  };
}
export function page<T extends { id: string; createdAt: Date }>(
  rows: T[],
  limit: number,
) {
  const data = rows.slice(0, limit);
  const last = data.at(-1);
  return {
    data,
    nextCursor:
      rows.length > limit && last
        ? Buffer.from(
            JSON.stringify({ at: last.createdAt.toISOString(), id: last.id }),
          ).toString("base64url")
        : null,
  };
}
export async function intents(
  scope: Scope,
  params: URLSearchParams,
  id?: string,
) {
  if (id) {
    const record = await db.paymentIntent.findFirst({
      where: { ...scope, id },
    });
    if (!record) throw new PortalError("NOT_FOUND", 404);
    return toPublicIntent(record);
  }
  const p = pagination(params);
  const rows = await db.paymentIntent.findMany({
    where: {
      ...scope,
      ...p.after,
      ...(p.state ? { state: p.state } : {}),
      ...(p.reference ? { reference: p.reference } : {}),
      ...(p.method ? { selectedMethod: p.method } : {}),
      ...(p.from || p.to
        ? {
            createdAt: {
              ...(p.from ? { gte: new Date(p.from) } : {}),
              ...(p.to ? { lt: new Date(p.to) } : {}),
            },
          }
        : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: p.limit + 1,
  });
  return page(
    rows.map((row) => toPublicIntent(row)),
    p.limit,
  );
}
export async function settlements(
  scope: Scope,
  params: URLSearchParams,
  id?: string,
) {
  const p = pagination(params);
  // A provider settlement may contain multiple merchants. Only return this merchant's allocations and totals.
  const owned = { intent: scope };
  const rows = await db.paymentSettlement.findMany({
    where: {
      environment: scope.environment,
      ...(id ? { id } : p.after),
      allocations: { some: owned },
    },
    include: {
      allocations: {
        where: owned,
        select: { intentId: true, amount: true, fee: true },
      },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: id ? 1 : p.limit + 1,
  });
  const results = rows.map((s) => {
    const gross = s.allocations.reduce((v, a) => v + BigInt(a.amount), 0n);
    const fee = s.allocations.reduce((v, a) => v + BigInt(a.fee), 0n);
    return {
      id: s.id,
      environment: s.environment,
      asset: s.asset,
      gross: gross.toString(),
      fee: fee.toString(),
      net: (gross - fee).toString(),
      amountUnit: "minor",
      state: s.state,
      reconciliation: s.reconciliation,
      createdAt: s.createdAt,
      allocations: s.allocations,
    };
  });
  if (id) {
    if (!results[0]) throw new PortalError("NOT_FOUND", 404);
    return results[0];
  }
  return page(results, p.limit);
}
export async function session(scope: Scope, intentId: string, key: string) {
  if (!/^[\w-]{8,100}$/.test(key))
    throw new PortalError("INVALID_IDEMPOTENCY_KEY");
  const requestKey = hash(`${scope.orgId}:${scope.environment}:${key}`);
  const intent = await db.paymentIntent.findFirst({
    where: { ...scope, id: intentId },
  });
  if (!intent) throw new PortalError("NOT_FOUND", 404);
  const existing = await db.checkoutSession.findUnique({
    where: { requestKey },
  });
  const result = async (s: {
    id: string;
    tokenRef: string | null;
    expiresAt: Date;
    revokedAt: Date | null;
  }) => {
    if (!s.tokenRef || s.revokedAt || s.expiresAt <= new Date())
      throw new PortalError("SESSION_EXPIRED", 409);
    const token = await secretManager.get(s.tokenRef);
    return {
      id: s.id,
      intentId,
      expiresAt: s.expiresAt,
      checkoutPath: `/checkout/${s.id}#${token}`,
    };
  };
  if (existing) {
    if (existing.intentId !== intentId)
      throw new PortalError("IDEMPOTENCY_CONFLICT", 409);
    return result(existing);
  }
  if (intent.state !== "Open" || intent.expiresAt <= new Date())
    throw new PortalError("INTENT_NOT_OPEN", 409);
  const token = randomBytes(32).toString("base64url");
  const tokenRef = await secretManager.put(token);
  // Unique intent/key binds retries to the same limited credential; losing concurrent calls read the winner.
  try {
    return await result(
      await db.checkoutSession.create({
        data: {
          intentId,
          requestKey,
          tokenRef,
          verifier: hash(token),
          expiresAt: intent.expiresAt,
        },
      }),
    );
  } catch (error) {
    const winner = await db.checkoutSession.findUnique({
      where: { requestKey },
    });
    if (winner) {
      if (winner.tokenRef !== tokenRef) await secretManager.revoke(tokenRef);
      if (winner.intentId !== intentId)
        throw new PortalError("IDEMPOTENCY_CONFLICT", 409);
      return result(winner);
    }
    await secretManager.revoke(tokenRef);
    throw error;
  }
}
export async function configureWebhook(
  scope: Scope,
  actor: string,
  raw: unknown,
) {
  const value = webhookInput.parse(raw);
  await validateEndpoint(value.url);
  const ref = await secretManager.put(value.secret);
  return atomic(async (tx) => {
    const updated = await tx.merchantConfig.updateMany({
      where: scope,
      data: {
        webhookUrl: value.url,
        webhookSecretRef: ref,
        webhookKeyId: value.keyId,
      },
    });
    if (!updated.count) throw new PortalError("NOT_FOUND", 404);
    await audit(
      tx,
      scope.orgId,
      actor,
      "merchant.webhook.configured",
      scope.orgId,
      { environment: scope.environment, keyId: value.keyId },
    );
    return { url: value.url, keyId: value.keyId };
  });
}
export async function redeliver(scope: Scope, eventId: string, actor: string) {
  return atomic(async (tx) => {
    const event = await tx.merchantEvent.findFirst({
      where: { ...scope, id: eventId },
    });
    if (!event) throw new PortalError("NOT_FOUND", 404);
    await tx.merchantDelivery.update({
      where: { eventId },
      data: { state: "Pending" },
    });
    await queue(
      tx,
      scope.orgId,
      "payment-delivery",
      `redelivery:${eventId}:${Math.floor(Date.now() / 60000)}`,
      { eventId },
    );
    await audit(tx, scope.orgId, actor, "merchant.webhook.redelivery", eventId);
    return { eventId, state: "Pending" };
  });
}
export async function cancelIntent(scope: Scope, id: string, actor: string) {
  return atomic(async (tx) => {
    const intent = await tx.paymentIntent.findFirst({
      where: { ...scope, id },
    });
    if (!intent) throw new PortalError("NOT_FOUND", 404);
    if (intent.state === "Cancelled") return toPublicIntent(intent);
    // Local cancellation is available only before any provider attempt exists.
    if (
      intent.state !== "Open" ||
      (await tx.paymentAttempt.count({ where: { intentId: id } }))
    )
      throw new PortalError("CANCELLATION_NOT_PERMITTED", 409);
    await tx.checkoutSession.updateMany({
      where: { intentId: id },
      data: { revokedAt: new Date() },
    });
    const updated = await tx.paymentIntent.update({
      where: { id },
      data: { state: "Cancelled", version: { increment: 1 } },
    });
    await audit(tx, scope.orgId, actor, "merchant.intent.cancelled", id);
    return toPublicIntent(updated);
  });
}
