import {
  validPaymentAmount as validStablecoinAmount,
  paymentAsset as tokenAsset,
  onchainMethod,
} from "../blockchain/crypto-assets";
import type { QuotedCryptoTerms } from "./crypto-checkout";
import { currentMerchantScreening } from "../merchant/screening";
import { storedLiveScope } from "../merchant/live-scope";
import {
  assertLaunchMethod,
  assertLaunchAsset,
  enforceLaunchScope,
  comingSoonMethods,
} from "./launch";
import {
  evaluateDepositContext,
  stablecoinCandidates,
} from "./stablecoin-routes";
import { snapshotFees } from "./pricing";
import { enforceRisk } from "../merchant/policy";
import {
  blocksExecution,
  evaluateTransactionCompliance,
} from "../compliance/service";
import { randomBytes, randomUUID } from "node:crypto";
import {
  evaluatePlatformContext,
  isFiatAsset,
  platformCovers,
} from "../treasury/launch";
import { db } from "../portal/db";
import { atomic, json } from "../portal/service";
import { sandboxSimulation } from "../portal/adapters";
import { PortalError } from "../portal/domain";
import { fingerprint } from "../portal/registry";
import {
  createTrustedContext,
  evaluateContext,
} from "../portal/availability-service";
import { scopeReviewCurrent } from "../merchant/live-scope";
import {
  attemptTarget,
  mergeAvailability,
  partnerCandidates,
  revalidateRoute,
} from "./partner-routes";
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
export type StoredPaymentOption = {
  id: string;
  amount: string;
  precision: number;
  asset: { kind: string; identifier: string; network: string };
  settlement: { kind: string; identifier: string; network: string };
  contextId: string;
  feeSnapshot: unknown;
};
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
  cryptoQuoteId?: string,
) {
  if (!/^[\w-]{8,100}$/.test(key))
    throw new PortalError("INVALID_IDEMPOTENCY_KEY");
  const value = intentInput.parse(input);
  const quote = cryptoQuoteId
    ? await db.cryptoQuote.findFirst({ where: { id: cryptoQuoteId, orgId } })
    : null;
  const quoteTerms = quote?.terms as unknown as QuotedCryptoTerms | undefined;
  const isCrypto = [
    value.asset,
    ...(value.paymentOptions ?? []).map((o) => o.asset),
  ].some((a) => onchainMethod(a.network, a.identifier) === "crypto-app");
  // Fiat under the launch scope is only the aggregator path: the merchant's
  // own platform rails (lib/treasury/launch.ts).
  const aggregator = enforceLaunchScope() && isFiatAsset(value.asset);
  if (aggregator) {
    if (value.paymentOptions?.length)
      throw new PortalError("PAYMENT_OPTIONS_STABLECOIN_ONLY", 409);
    const env = (await db.merchantConfig.findUniqueOrThrow({ where: { orgId } }))
      .environment;
    if (!(await platformCovers(orgId, env, value.methods)))
      throw new PortalError("PAYMENT_METHOD_COMING_SOON", 409);
  }
  if (
    enforceLaunchScope() &&
    (isCrypto || cryptoQuoteId) &&
    (!quote ||
      !quoteTerms ||
      quote.environment !==
        (await db.merchantConfig.findUniqueOrThrow({ where: { orgId } }))
          .environment ||
      fingerprint(intentInput.parse(quoteTerms.input)) !== fingerprint(value))
  )
    throw new PortalError("CRYPTO_QUOTE_REQUIRED", 409);
  if (
    enforceLaunchScope() &&
    !aggregator &&
    (() => {
      const offered = new Set(
        [value.asset, ...(value.paymentOptions ?? []).map((o) => o.asset)].map(
          (a) => onchainMethod(a.network, a.identifier),
        ),
      );
      return (
        value.methods.some(
          (m) => !offered.has(m as "stablecoin" | "crypto-app"),
        ) || [...offered].some((m) => !value.methods.includes(m))
      );
    })()
  )
    throw new PortalError("PAYMENT_METHOD_ASSET_MISMATCH", 409);
  const config = await db.merchantConfig.findUniqueOrThrow({
    where: { orgId },
  });
  if (!aggregator) {
    for (const method of value.methods) assertLaunchMethod(method);
    assertLaunchAsset(value.asset, value.precision, config.environment);
  }
  if (enforceLaunchScope() && value.scenario !== "success")
    throw new PortalError(
      "SCENARIO_NOT_SUPPORTED_FOR_STABLECOIN_CHECKOUT",
      409,
    );
  if (config.environment === "production")
    await assertProductionReady(orgId, config, {
      ...value,
      aggregator,
      methods:
        enforceLaunchScope() && !aggregator
          ? [onchainMethod(value.asset.network, value.asset.identifier)]
          : value.methods,
    });
  else if (
    !aggregator &&
    !sandboxSimulation() &&
    !(await stablecoinCandidates(orgId, "sandbox", value.asset)).length
  )
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
  // Transaction-level compliance eligibility runs before availability. A
  // blocking decision prevents an intent from ever exposing payment methods.
  const compliance = evaluateTransactionCompliance({
    operation: "pay-in",
    originCountry: value.payerCountry ?? config.country,
    merchantCountry: config.country,
    amount: value.amount,
    asset: value.asset,
    currency: value.asset.identifier,
  });
  if (blocksExecution(compliance.decision))
    throw new PortalError(`COMPLIANCE_DECISION:${compliance.decision}`, 403);
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
  const expiresAt = quote?.expiresAt ?? new Date(now.getTime() + 30 * 60000);
  if (expiresAt <= now) throw new PortalError("CRYPTO_QUOTE_EXPIRED", 409);
  const optionInputs = [
    {
      asset: value.asset,
      amount: value.amount,
      precision: value.precision,
      settlement: value.settlement,
    },
    ...(value.paymentOptions ?? []),
  ];
  if (
    new Set(optionInputs.map((o) => assetKey(o.asset))).size !==
    optionInputs.length
  )
    throw new PortalError("DUPLICATE_PAYMENT_OPTION", 409);
  const quoted: StoredPaymentOption[] = [];
  for (const option of optionInputs) {
    if (!aggregator)
      assertLaunchAsset(option.asset, option.precision, config.environment);
    if (
      enforceLaunchScope() &&
      !aggregator &&
      !validStablecoinAmount(
        option.asset.network,
        option.asset.identifier,
        option.amount,
      )
    )
      throw new PortalError("STABLECOIN_AMOUNT_OUT_OF_RANGE", 409);
    if (
      minor(option.amount, option.precision) <= 0n ||
      assetKey(option.asset) !== assetKey(option.settlement)
    )
      throw new PortalError(
        "PAYMENT_OPTION_REQUIRES_POSITIVE_SAME_ASSET_PAYMENT",
        409,
      );
    if (config.environment === "production")
      await assertProductionReady(orgId, config, {
        ...value,
        aggregator,
        asset: option.asset,
        methods:
          enforceLaunchScope() && !aggregator
            ? [onchainMethod(option.asset.network, option.asset.identifier)]
            : value.methods,
      });
    else if (
      enforceLaunchScope() &&
      option !== optionInputs[0] &&
      !(await stablecoinCandidates(orgId, "sandbox", option.asset)).length
    )
      throw new PortalError("PAYMENT_OPTION_NOT_CONFIGURED", 409);
    const decision = evaluateTransactionCompliance({
      operation: "pay-in",
      originCountry: value.payerCountry ?? config.country,
      merchantCountry: config.country,
      amount: option.amount,
      asset: option.asset,
      currency: option.asset.identifier,
    });
    if (blocksExecution(decision.decision))
      throw new PortalError(`COMPLIANCE_DECISION:${decision.decision}`, 403);
    const feeSnapshot =
      quoteTerms?.options.find(
        (o) => assetKey(o.asset) === assetKey(option.asset),
      )?.feeSnapshot ??
      snapshotFees(
        {
          orgId,
          environment: config.environment,
          asset: option.asset,
          precision: option.precision,
        },
        now,
      );
    const context = await createTrustedContext(
      orgId,
      {
        merchantId: orgId,
        reference: value.reference,
        environment: config.environment,
        amount: option.amount,
        input: option.asset,
        precision: option.precision,
        payerCountry: value.payerCountry ?? config.country,
        merchantCountry: config.country,
        methods:
          enforceLaunchScope() && !aggregator
            ? [onchainMethod(option.asset.network, option.asset.identifier)]
            : value.methods,
        operation: "pay-in",
        settlement: option.settlement,
        verified: config.environment === "sandbox",
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
    quoted.push({
      ...option,
      id: hash(assetKey(option.asset)).slice(0, 24),
      contextId: context.contextId,
      feeSnapshot,
    });
  }
  const feeSnapshot = quoted[0].feeSnapshot;
  const context = { contextId: quoted[0].contextId };
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
    const created = await tx.paymentIntent.create({
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
        cryptoQuoteId: quote?.id,
        feeSnapshot: json(feeSnapshot),
        paymentOptions: json(quoted),
        selectedOption: quoted[0].id,
      },
    });
    await tx.complianceDecision.create({
      data: {
        intentId: created.id,
        policyVersion: "compliance-v1",
        decision: compliance.decision,
        reasons: json(compliance.reasons),
        context: json({
          operation: "pay-in",
          originCountry: value.payerCountry ?? config.country,
          merchantCountry: config.country,
          amount: value.amount,
          asset: value.asset,
        }),
        expiresAt,
      },
    });
    return created;
  });
}
// Live payments need: a real (non-fictional) organisation, a current approved
// live scope, a clear PayRouta screening of the latest business profile, and
// at least one approved merchant-owned provider account able to take one of
// the requested methods. Sandbox-only scenarios are refused. On the
// aggregator path the merchant's PayRouta underwriting (a Live merchant
// account on a qualified platform account) replaces the live-scope review.
async function assertProductionReady(
  orgId: string,
  config: { liveScope: unknown; country: string },
  value: {
    methods: string[];
    scenario: string;
    payerCountry?: string;
    asset?: unknown;
    aggregator?: boolean;
  },
) {
  if (value.scenario !== "success")
    throw new PortalError("SCENARIO_SANDBOX_ONLY", 400);
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId } });
  if (org.fictional) throw new PortalError("FICTIONAL_ORGANIZATION", 409);
  if (value.aggregator) {
    if (!(await platformCovers(orgId, "production", value.methods)))
      throw new PortalError("EXECUTION_ADAPTER_NOT_CONFIGURED", 409);
    return;
  }
  if (!scopeReviewCurrent(config.liveScope))
    throw new PortalError("LIVE_SCOPE_NOT_APPROVED", 409);
  const scope = storedLiveScope.parse(config.liveScope);
  if (
    !value.payerCountry ||
    !scope.input.payerCountries.includes(value.payerCountry)
  )
    throw new PortalError("PAYER_COUNTRY_OUTSIDE_LIVE_SCOPE", 409);
  await currentMerchantScreening(db, orgId, config.country);
  const candidates = [
    ...(await stablecoinCandidates(orgId, "production", value.asset)),
    ...(await partnerCandidates(orgId, "production")),
  ];
  if (!candidates.some((c) => value.methods.includes(c.method)))
    throw new PortalError("EXECUTION_ADAPTER_NOT_CONFIGURED", 409);
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
  readOnly = false,
) {
  const session = await db.checkoutSession.findUnique({
    where: { id },
    include: { intent: true },
  });
  if (
    !session ||
    session.revokedAt ||
    session.expiresAt.getTime() + (readOnly ? 86400000 : 0) <= now.getTime() ||
    hash(token) !== session.verifier
  )
    throw new PortalError("CHECKOUT_EXPIRED_OR_UNAUTHORIZED", 401);
  return session;
}
export async function handoffSession(
  id: string,
  token: string,
  now = new Date(),
) {
  await authorizeSession(id, token, now, true);
  return atomic(async (tx) => {
    const source = await tx.checkoutSession.findUniqueOrThrow({
      where: { id },
      include: { intent: true },
    });
    if (source.revokedAt || hash(token) !== source.verifier)
      throw new PortalError("CHECKOUT_EXPIRED_OR_UNAUTHORIZED", 401);
    if (source.expiresAt <= now || source.intent.expiresAt <= now)
      throw new PortalError("CHECKOUT_EXPIRED", 409);
    if (!["Open", "Processing"].includes(source.intent.state))
      throw new PortalError("PAYMENT_ALREADY_IN_PROGRESS", 409);
    const credential = randomBytes(32).toString("base64url");
    const session = await tx.checkoutSession.create({
      data: {
        intentId: source.intentId,
        verifier: hash(credential),
        expiresAt: source.expiresAt,
      },
    });
    return {
      checkoutPath: `/checkout/${session.id}#${credential}`,
      expiresAt: session.expiresAt.toISOString(),
    };
  });
}
export async function progress(id: string, token: string, now = new Date()) {
  const { intent } = await authorizeSession(id, token, now, true);
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
  const options = await checkoutOptions(intent, !!attempt);
  return {
    paymentOptions: options,
    paymentMethods: checkoutMethodSummary(options, !!attempt),
    chainLocked: !!attempt,
    selectedOption: intent.selectedOption,
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
    method: onchainMethod(
      (intent.asset as { network: string }).network,
      (intent.asset as { identifier: string }).identifier,
    ),
    cryptoQuote: intent.cryptoQuoteId
      ? await db.cryptoQuote
          .findUnique({
            where: { id: intent.cryptoQuoteId },
            select: { terms: true },
          })
          .then((q) =>
            q
              ? {
                  usdAmount: (q.terms as unknown as QuotedCryptoTerms)
                    .usdAmount,
                  source: "CoinGecko",
                }
              : null,
          )
      : null,
    symbol: tokenAsset(
      (intent.asset as { network: string }).network,
      (intent.asset as { identifier: string }).identifier,
    )?.symbol,
    network: (intent.asset as { network: string }).network,
    expiresAt: intent.expiresAt.toISOString(),
  };
}
export async function checkoutOptions(
  intent: Awaited<ReturnType<typeof authorizeSession>>["intent"],
  locked = false,
) {
  const quotes = (intent.paymentOptions as StoredPaymentOption[] | null) ?? [];
  return Promise.all(
    quotes.map(async (o) => ({
      id: o.id,
      amount: o.amount,
      precision: o.precision,
      network: o.asset.network,
      symbol: tokenAsset(o.asset.network, o.asset.identifier)?.symbol,
      identifier: o.asset.identifier,
      method: onchainMethod(o.asset.network, o.asset.identifier),
      available:
        (!locked || intent.selectedOption === o.id) &&
        (
          await stablecoinCandidates(
            intent.orgId,
            intent.environment,
            o.asset,
            db,
            intent.id,
          )
        ).length > 0,
    })),
  );
}
function checkoutMethodSummary(
  options: { method: string; available: boolean }[],
  locked = false,
) {
  return ["stablecoin", "crypto-app"]
    .map((method) => {
      const offered = options.filter((o) => o.method === method);
      return {
        method,
        label: method === "stablecoin" ? "Stablecoins" : "Crypto wallet",
        status: !offered.length
          ? "NOT_OFFERED"
          : locked
            ? "LOCKED"
            : offered.some((o) => o.available)
              ? "AVAILABLE"
              : "UNAVAILABLE",
        explanation: !offered.length
          ? "Not offered for this checkout"
          : "Choose an offered token and network before preparing payment instructions",
      };
    })
    .concat(comingSoonMethods);
}
export async function choosePaymentOption(
  id: string,
  token: string,
  optionId: string,
  now = new Date(),
) {
  const { intent } = await authorizeSession(id, token, now);
  const option = (
    (intent.paymentOptions as StoredPaymentOption[] | null) ?? []
  ).find((o) => o.id === optionId);
  if (!option) throw new PortalError("PAYMENT_OPTION_NOT_OFFERED", 409);
  const config = await db.merchantConfig.findUniqueOrThrow({
    where: { orgId: intent.orgId },
  });
  const trusted = await db.availabilityContext.findUniqueOrThrow({
    where: { id: option.contextId },
  });
  if (trusted.expiresAt <= now)
    throw new PortalError("PAYMENT_OPTION_EXPIRED", 409);
  if (intent.environment === "production")
    await assertProductionReady(intent.orgId, config, {
      methods: enforceLaunchScope()
        ? [onchainMethod(option.asset.network, option.asset.identifier)]
        : (intent.methods as string[]),
      scenario: intent.scenario,
      asset: option.asset,
      payerCountry: (trusted.context as { payerCountry?: string }).payerCountry,
    });
  if (
    !(
      await stablecoinCandidates(intent.orgId, intent.environment, option.asset)
    ).length
  )
    throw new PortalError("PAYMENT_OPTION_UNAVAILABLE", 409);
  return atomic(async (tx) => {
    const current = await tx.paymentIntent.findUniqueOrThrow({
      where: { id: intent.id },
    });
    const session = await tx.checkoutSession.findUniqueOrThrow({
      where: { id },
    });
    if (
      session.revokedAt ||
      session.expiresAt <= now ||
      current.expiresAt <= now
    )
      throw new PortalError("CHECKOUT_EXPIRED_OR_UNAUTHORIZED", 401);
    if (await tx.paymentAttempt.count({ where: { intentId: intent.id } }))
      throw new PortalError("PAYMENT_CHAIN_LOCKED", 409);
    if (current.state !== "Open")
      throw new PortalError("PAYMENT_ALREADY_IN_PROGRESS", 409);
    await tx.paymentIntent.update({
      where: { id: intent.id },
      data: {
        amount: option.amount,
        asset: json(option.asset),
        precision: option.precision,
        settlement: json(option.settlement),
        contextId: option.contextId,
        feeSnapshot: json(option.feeSnapshot),
        selectedOption: option.id,
        routeId: null,
        evaluationId: null,
        selectedMethod: null,
        version: { increment: 1 },
      },
    });
    return { optionId: option.id };
  });
}
export async function methods(id: string, token: string, now = new Date()) {
  const { intent } = await authorizeSession(id, token, now);
  return intentAvailability(intent, now);
}
export async function intentAvailability(
  intent: Awaited<ReturnType<typeof authorizeSession>>["intent"],
  now = new Date(),
) {
  const aggregator = enforceLaunchScope() && isFiatAsset(intent.asset);
  const evaluation = aggregator
    ? await evaluatePlatformContext(intent, now)
    : enforceLaunchScope()
      ? await evaluateDepositContext(intent, now)
      : await evaluateContext(intent.orgId, intent.contextId, now);
  const updated = await db.paymentIntent.updateMany({
    where: {
      id: intent.id,
      contextId: intent.contextId,
      version: intent.version,
    },
    data: { evaluationId: evaluation.evaluationId },
  });
  if (updated.count !== 1) throw new PortalError("REFRESH_METHODS", 409);
  if (aggregator) return evaluation;
  const merged = mergeAvailability(
    evaluation,
    await partnerCandidates(intent.orgId, intent.environment),
    intent.methods as string[],
  );
  const asset = intent.asset as { network: string; identifier: string };
  const method = onchainMethod(asset.network, asset.identifier);
  const deposits = (intent.methods as string[]).includes(method)
    ? await stablecoinCandidates(intent.orgId, intent.environment, intent.asset)
    : [];
  if (enforceLaunchScope())
    return {
      ...merged,
      methods: checkoutMethodSummary(await checkoutOptions(intent)),
    };
  if (deposits.length) {
    const existing = merged.methods.find((m) => m.method === method);
    if (existing) existing.status = "AVAILABLE";
    else
      merged.methods.push({
        method,
        label: method === "crypto-app" ? "Crypto wallet" : "Stablecoins",
        status: "AVAILABLE",
        explanation: "Pay directly to the merchant’s receive address",
      });
  }
  return merged;
}
export async function selectMethod(
  id: string,
  token: string,
  method: string,
  now = new Date(),
) {
  const { intent } = await authorizeSession(id, token, now);
  // The aggregator path is checked against platform accounts in
  // revalidateRoute; everything else must be a launched method.
  if (!(enforceLaunchScope() && isFiatAsset(intent.asset)))
    assertLaunchMethod(method);
  if (!intent.evaluationId) throw new PortalError("REFRESH_METHODS", 409);
  if (!(intent.methods as string[]).includes(method))
    throw new PortalError("SELECTED_METHOD_NOT_AVAILABLE", 409);
  const eligible = await revalidateRoute(
    intent,
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
  const ranked: { profileId: string; fee: string | null }[] = [
    ...eligible.deposits.map((p) => ({ profileId: p.profileId, fee: "0" })),
    ...rank(
      (enforceLaunchScope() ? [] : profiles).map((p, i) => ({
        profileId: p.id,
        fee: String((i + 1) * 10),
        seconds: (profiles.length - i) * 60,
        reliability: null,
        capacity: 10000,
      })),
      config.policy,
    ),
    // The merchant's own accounts, in the order they were approved. Their
    // fees are set by the merchant's contract with each provider, so no fee
    // is quoted by PayRouta.
    ...eligible.partners.map((p) => ({ profileId: p.profileId, fee: null })),
  ];
  if (!ranked.length) throw new PortalError("NO_COMPARABLE_QUOTES", 409);
  const expiry = new Date(now.getTime() + 60000);
  const route = await atomic(async (tx) => {
    const current = await tx.paymentIntent.findUniqueOrThrow({
      where: { id: intent.id },
    });
    if (
      current.state !== "Open" ||
      current.contextId !== intent.contextId ||
      current.version !== intent.version ||
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
  const eligible = await revalidateRoute(
    intent,
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
    const target = await attemptTarget(tx, route.profileId, current.orgId);
    const risk = await enforceRisk(tx, current, now, true);
    if (risk.decision !== "Allow") return { state: "Review required" };
    const attempt = await tx.paymentAttempt.create({
      data: {
        intentId: intent.id,
        number: (old?.number ?? 0) + 1,
        profileId: target.profileId,
        providerOrgId: target.providerOrgId,
        integrationId: target.integrationId,
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
  if (!sandboxSimulation() || intent.environment !== "sandbox")
    throw new PortalError("SANDBOX_ONLY", 403);
  const attempt = await db.paymentAttempt.findFirst({
    where: { intentId: intent.id, state: "Requires action" },
  });
  if (!attempt) throw new PortalError("NO_CUSTOMER_ACTION", 409);
  const integration = await db.integration.findUniqueOrThrow({
    where: { id: attempt.integrationId },
  });
  const binding = integration.config as { adapter?: string; mode?: string };
  if (
    binding.adapter !== "simulator" &&
    !(binding.mode === "PARTNER" && binding.adapter === "sandbox") &&
    !(
      binding.mode === "PLATFORM" &&
      ["sandbox-platform", "sandbox-split"].includes(binding.adapter ?? "")
    )
  )
    throw new PortalError("EXTERNAL_CUSTOMER_ACTION_REQUIRED", 409);
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
// Queue a provider status read for the current attempt (at most one per
// attempt every ten seconds). Never changes state by itself.
export async function refreshAttempt(
  id: string,
  token: string,
  now = new Date(),
) {
  const { intent } = await authorizeSession(id, token, now, true);
  const attempt = await db.paymentAttempt.findFirst({
    where: {
      intentId: intent.id,
      state: { in: ["Requires action", "Pending", "Unknown"] },
    },
    orderBy: { number: "desc" },
  });
  if (!attempt) return { queued: false };
  const bucket = Math.floor(now.getTime() / 10000);
  await queue(
    db,
    intent.orgId,
    "payment-poll",
    `refresh:${attempt.id}:${bucket}`,
    {
      attemptId: attempt.id,
    },
  );
  return { queued: true };
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
