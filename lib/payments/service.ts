import { enforceRisk } from "../merchant/policy";
import { randomBytes, randomUUID } from "node:crypto";
import { db } from "../portal/db";
import { atomic, json } from "../portal/service";
import { localMode } from "../portal/adapters";
import { PortalError } from "../portal/domain";
import { fingerprint } from "../portal/registry";
import {
  createTrustedContext,
  evaluateContext,
  revalidateSelectedMethod,
} from "../portal/availability-service";
import { trustedContextSchema } from "../portal/availability-engine";
import {
  activeStates,
  assetKey,
  hash,
  intentInput,
  minor,
  rank,
} from "./contracts";
import type { Prisma } from "../generated/prisma/client";
export type Tx = Prisma.TransactionClient;
export async function queue(
  tx: Tx,
  orgId: string,
  kind: string,
  key: string,
  payload: unknown,
  availableAt = new Date(),
) {
  await tx.job.upsert({
    where: { key },
    create: { orgId, kind, key, payload: json(payload), availableAt },
    update: {},
  });
}
export async function createIntent(
  orgId: string,
  key: string,
  input: unknown,
  now = new Date(),
) {
  if (!/^[\w-]{8,100}$/.test(key))
    throw new PortalError("INVALID_IDEMPOTENCY_KEY");
  const value = intentInput.parse(input);
  const config = await db.merchantConfig.findUniqueOrThrow({
    where: { orgId },
  });
  if (config.environment !== "sandbox" || !localMode())
    throw new PortalError("EXECUTION_ADAPTER_NOT_CONFIGURED", 409);
  if (
    new URL(value.returnUrl).origin !== config.returnOrigin ||
    new URL(value.returnUrl).username ||
    new URL(value.returnUrl).password
  )
    throw new PortalError("RETURN_ORIGIN_NOT_REGISTERED");
  if (
    minor(value.amount, value.precision) <= 0n ||
    assetKey(value.asset) !== assetKey(value.settlement)
  )
    throw new PortalError("SANDBOX_REQUIRES_POSITIVE_SAME_ASSET_PAYMENT");
  const requestHash = fingerprint(value);
  const existing = await db.paymentIntent.findUnique({
    where: {
      orgId_environment_key: { orgId, environment: config.environment, key },
    },
  });
  if (existing) {
    if (existing.fingerprint !== requestHash)
      throw new PortalError("IDEMPOTENCY_CONFLICT", 409);
    return existing;
  }
  const expiresAt = new Date(now.getTime() + 30 * 60000);
  const context = await createTrustedContext(
    orgId,
    {
      merchantId: orgId,
      reference: value.reference,
      environment: config.environment,
      amount: value.amount,
      input: value.asset,
      precision: value.precision,
      payerCountry: config.country,
      merchantCountry: config.country,
      methods: value.methods,
      operation: "pay-in",
      settlement: value.settlement,
      verified: true, // Explicit fictional sandbox identity; production creation is disabled.
      ...((config.providerAllowlist as string[]).length
        ? { providerAllowlist: config.providerAllowlist as string[] }
        : {}),
      verificationAction: false,
      blockedMethods: [],
      policyVersion: "payments-v1",
      validUntil: expiresAt.toISOString(),
    },
    "merchant-server",
    now,
  );
  return atomic(async (tx) => {
    const prior = await tx.paymentIntent.findUnique({
      where: {
        orgId_environment_key: { orgId, environment: config.environment, key },
      },
    });
    if (prior) {
      if (prior.fingerprint !== requestHash)
        throw new PortalError("IDEMPOTENCY_CONFLICT", 409);
      return prior;
    }
    return tx.paymentIntent.create({
      data: {
        orgId,
        environment: config.environment,
        reference: value.reference,
        amount: value.amount,
        asset: json(value.asset),
        precision: value.precision,
        methods: value.methods,
        settlement: json(value.settlement),
        returnUrl: value.returnUrl,
        metadata: value.metadata,
        key,
        fingerprint: requestHash,
        contextId: context.contextId,
        expiresAt,
        scenario: value.scenario,
      },
    });
  });
}
export async function createSession(
  orgId: string,
  intentId: string,
  now = new Date(),
) {
  const intent = await db.paymentIntent.findFirst({
    where: { id: intentId, orgId, expiresAt: { gt: now }, state: "Open" },
  });
  if (!intent) throw new PortalError("INTENT_NOT_OPEN", 409);
  const token = randomBytes(32).toString("base64url");
  const session = await db.checkoutSession.create({
    data: { intentId, verifier: hash(token), expiresAt: intent.expiresAt },
  });
  return {
    sessionId: session.id,
    token,
    checkoutPath: `/checkout/${session.id}#${token}`,
  };
}
export async function authorizeSession(
  id: string,
  token: string,
  now = new Date(),
) {
  const session = await db.checkoutSession.findUnique({
    where: { id },
    include: { intent: true },
  });
  if (
    !session ||
    session.revokedAt ||
    session.expiresAt <= now ||
    hash(token) !== session.verifier
  )
    throw new PortalError("CHECKOUT_EXPIRED_OR_UNAUTHORIZED", 401);
  return session;
}
export async function progress(id: string, token: string, now = new Date()) {
  const { intent } = await authorizeSession(id, token, now);
  const merchant = await db.organization.findUniqueOrThrow({
    where: { id: intent.orgId },
  });
  const attempt = await db.paymentAttempt.findFirst({
    where: { intentId: intent.id },
    orderBy: { number: "desc" },
  });
  const allocations = await db.settlementAllocation.findMany({
    where: { intentId: intent.id },
    include: { settlement: true },
  });
  return {
    merchant: merchant.name,
    reference: intent.reference,
    amount: intent.amount,
    asset: intent.asset,
    state: intent.state,
    selectedMethod: intent.selectedMethod,
    attemptState: attempt?.state,
    attemptId: attempt?.id,
    action: attempt?.action,
    returnUrl: intent.returnUrl,
    settlement:
      allocations.reduce((n, a) => n + BigInt(a.amount), 0n) <
      minor(intent.amount, intent.precision)
        ? []
        : allocations.map((a) => a.settlement.state),
    sandbox: intent.environment === "sandbox",
  };
}
export async function methods(id: string, token: string, now = new Date()) {
  const { intent } = await authorizeSession(id, token, now);
  const evaluation = await evaluateContext(intent.orgId, intent.contextId, now);
  await db.paymentIntent.update({
    where: { id: intent.id },
    data: { evaluationId: evaluation.evaluationId },
  });
  return evaluation;
}
export async function selectMethod(
  id: string,
  token: string,
  method: string,
  now = new Date(),
) {
  const { intent } = await authorizeSession(id, token, now);
  if (!intent.evaluationId) throw new PortalError("REFRESH_METHODS", 409);
  const eligible = await revalidateSelectedMethod(
    intent.orgId,
    intent.contextId,
    intent.evaluationId,
    method,
    now,
  );
  const config = await db.merchantConfig.findUniqueOrThrow({
    where: { orgId: intent.orgId },
  });
  // Simulator economics are explicit fixture quotes, never estimates for a live provider.
  const discovered = await db.publishedProfile.findMany({
    where: { id: { in: eligible.candidateIds } },
    orderBy: { id: "asc" },
    take: 8,
  });
  const integrations = await db.integration.findMany({
    where: { id: { in: discovered.map((p) => p.integrationId) } },
  });
  const profiles = discovered.filter(
    (p) =>
      integrations.some(
        (i) =>
          i.id === p.integrationId &&
          (i.config as { adapter: string }).adapter === "simulator",
      ) && p.environment === "sandbox",
  );
  const ranked = rank(
    profiles.map((p, i) => ({
      profileId: p.id,
      fee: String((i + 1) * 10),
      seconds: (profiles.length - i) * 60,
      reliability: null,
      capacity: 10000,
    })),
    config.policy,
  );
  if (!ranked.length) throw new PortalError("NO_COMPARABLE_QUOTES", 409);
  const expiry = new Date(now.getTime() + 60000);
  const route = await atomic(async (tx) => {
    const current = await tx.paymentIntent.findUniqueOrThrow({
      where: { id: intent.id },
    });
    if (
      current.state !== "Open" ||
      (await tx.paymentAttempt.count({
        where: { intentId: intent.id, state: { in: activeStates } },
      }))
    )
      throw new PortalError("PAYMENT_ALREADY_IN_PROGRESS", 409);
    const r = await tx.paymentRoute.create({
      data: {
        intentId: intent.id,
        method,
        evaluationId: intent.evaluationId!,
        policy: config.policy,
        policyVersion: "payments-v1",
        profileId: ranked[0].profileId,
        snapshot: json({
          ranked,
          quoteId: randomUUID(),
          input: intent.amount,
          asset: intent.asset,
          settlement: intent.settlement,
          payerAmount: intent.amount,
          providerFeeMinor: ranked[0].fee,
          feeDeductedFromSettlement: true,
          rounding: "exact minor units",
          contextFingerprint: intent.fingerprint,
        }),
        expiresAt: expiry,
      },
    });
    await tx.paymentIntent.update({
      where: { id: intent.id },
      data: {
        selectedMethod: method,
        routeId: r.id,
        version: { increment: 1 },
      },
    });
    return r;
  });
  return {
    routeId: route.id,
    expiresAt: route.expiresAt,
    payerAmount: intent.amount,
    asset: intent.asset,
    providerFeeMinor: ranked[0].fee,
    feeDeductedFromSettlement: true,
  };
}
export async function confirm(
  id: string,
  token: string,
  routeId: string,
  now = new Date(),
) {
  const { intent } = await authorizeSession(id, token, now);
  const prior = await db.paymentAttempt.findFirst({
    where: { intentId: intent.id, routeId },
  });
  if (prior) return { attemptId: prior.id, state: prior.state };
  const route = await db.paymentRoute.findFirst({
    where: { id: routeId, intentId: intent.id },
  });
  if (
    !route ||
    route.expiresAt <= now ||
    intent.routeId !== route.id ||
    intent.selectedMethod !== route.method
  )
    throw new PortalError("QUOTE_EXPIRED_RESELECT_METHOD", 409);
  const eligible = await revalidateSelectedMethod(
    intent.orgId,
    intent.contextId,
    route.evaluationId,
    route.method,
    now,
  );
  if (!eligible.candidateIds.includes(route.profileId))
    throw new PortalError("PROVIDER_NO_LONGER_ELIGIBLE", 409);
  const result = await atomic(async (tx) => {
    const current = await tx.paymentIntent.findUniqueOrThrow({
      where: { id: intent.id },
    });
    const old = await tx.paymentAttempt.findFirst({
      where: { intentId: intent.id },
      orderBy: { number: "desc" },
    });
    if (old && old.routeId === routeId)
      return { attemptId: old.id, state: old.state };
    if (
      current.state !== "Open" ||
      current.routeId !== routeId ||
      (old && activeStates.includes(old.state))
    )
      throw new PortalError("PAYMENT_ALREADY_IN_PROGRESS", 409);
    const stillValid = await tx.checkoutSession.findFirst({
      where: {
        id,
        intentId: current.id,
        revokedAt: null,
        expiresAt: { gt: now },
      },
    });
    if (!stillValid || current.expiresAt <= now)
      throw new PortalError("CHECKOUT_EXPIRED_OR_UNAUTHORIZED", 401);
    const profile = await tx.publishedProfile.findUniqueOrThrow({
      where: { id: route.profileId },
    });
    if (!profile.current)
      throw new PortalError("PROVIDER_NO_LONGER_ELIGIBLE", 409);
    const risk = await enforceRisk(tx, current, now, true);
    if (risk.decision !== "Allow") return { state: "Review required" };
    const attempt = await tx.paymentAttempt.create({
      data: {
        intentId: intent.id,
        number: (old?.number ?? 0) + 1,
        profileId: profile.id,
        providerOrgId: profile.orgId,
        integrationId: profile.integrationId,
        environment: intent.environment,
        routeId,
        key: `attempt:${randomUUID()}`,
        fingerprint: intent.fingerprint,
      },
    });
    await tx.paymentIntent.update({
      where: { id: intent.id },
      data: { state: "Processing", version: { increment: 1 } },
    });
    await queue(
      tx,
      intent.orgId,
      "payment-dispatch",
      `dispatch:${attempt.id}`,
      { attemptId: attempt.id },
    );
    return { attemptId: attempt.id, state: attempt.state };
  });
  if (!result.attemptId) throw new PortalError("REVIEW_REQUIRED", 409);
  return { attemptId: result.attemptId, state: result.state };
}
export async function customerAction(
  id: string,
  token: string,
  now = new Date(),
) {
  const { intent } = await authorizeSession(id, token, now);
  if (!localMode() || intent.environment !== "sandbox")
    throw new PortalError("SANDBOX_ONLY", 403);
  const attempt = await db.paymentAttempt.findFirst({
    where: { intentId: intent.id, state: "Requires action" },
  });
  if (!attempt) throw new PortalError("NO_CUSTOMER_ACTION", 409);
  await db.simulatorPayment.update({
    where: { key: attempt.key },
    data: { state: "Confirmed" },
  });
  await atomic((tx) =>
    queue(tx, intent.orgId, "payment-poll", `action:${attempt.id}`, {
      attemptId: attempt.id,
    }),
  );
}
export async function event(
  tx: Tx,
  intentId: string,
  type: string,
  now = new Date(),
) {
  const intent = await tx.paymentIntent.findUniqueOrThrow({
    where: { id: intentId },
  });
  const id = randomUUID();
  const payload = {
    id,
    type,
    schemaVersion: "1",
    objectId: intentId,
    objectVersion: intent.version,
    environment: intent.environment,
    occurredAt: now.toISOString(),
    amount: intent.amount,
    asset: intent.asset,
    state: intent.state,
  };
  const e = await tx.merchantEvent.upsert({
    where: {
      intentId_type_version: { intentId, type, version: intent.version },
    },
    create: {
      id,
      intentId,
      orgId: intent.orgId,
      environment: intent.environment,
      type,
      version: intent.version,
      payload: json(payload),
    },
    update: {},
  });
  await tx.merchantDelivery.upsert({
    where: { eventId: e.id },
    create: { eventId: e.id },
    update: {},
  });
  await queue(tx, intent.orgId, "payment-delivery", `delivery:${e.id}`, {
    eventId: e.id,
  });
}
export async function refreshContext(intentId: string, now = new Date()) {
  const intent = await db.paymentIntent.findUniqueOrThrow({
    where: { id: intentId },
  });
  const context = await db.availabilityContext.findUniqueOrThrow({
    where: { id: intent.contextId },
  });
  return trustedContextSchema.parse({
    ...(context.context as object),
    validUntil: new Date(now.getTime() + 60000).toISOString(),
  });
}
