// The aggregator path through PayRouta's launch scope (lib/payments/launch.ts).
//
// The launch scope keeps every running server to stablecoin and crypto
// deposits, plus one more path: fiat payments for a merchant that is Live on
// PayRouta's own platform accounts. Those rails have their own gates (the
// merchant's underwriting and live gate; in production, a qualified platform
// account), so they do not reopen registry providers or merchant-owned
// partner accounts, which stay closed until they are qualified.
import { randomUUID } from "node:crypto";
import { db } from "../portal/db";
import { PortalError } from "../portal/domain";
import { json } from "../portal/service";
import { fingerprint } from "../portal/registry";
import { labelOf, type PaymentMethodId } from "../providers/normalized";
import { platformCandidates } from "./routes";

export const isFiatAsset = (asset: unknown) => (asset as { kind?: string } | null)?.kind === "fiat";

// Every requested method is offered by one of the merchant's platform accounts.
export async function platformCovers(orgId: string, environment: string, methods: readonly string[]) {
  if (!methods.length) return false;
  const offered = new Set<string>((await platformCandidates(orgId, environment)).map((c) => c.method));
  return methods.every((m) => offered.has(m));
}

// Availability for a fiat intent under the launch scope: only the merchant's
// platform rails, in a short-lived evaluation like the deposit path's.
export async function evaluatePlatformContext(
  intent: { orgId: string; contextId: string; environment: string; methods: unknown },
  now = new Date(),
) {
  const context = await db.availabilityContext.findFirst({
    where: { id: intent.contextId, orgId: intent.orgId, environment: intent.environment },
  });
  if (!context || context.expiresAt <= now) throw new PortalError("CONTEXT_EXPIRED", 409);
  const candidates = await platformCandidates(intent.orgId, intent.environment);
  const evaluationId = randomUUID();
  const expiresAt = new Date(Math.min(context.expiresAt.getTime(), now.getTime() + 60000));
  const safe = {
    evaluationId,
    evaluatedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    methods: (intent.methods as string[]).map((method) => {
      const available = candidates.some((c) => c.method === method);
      return {
        method,
        label: labelOf(method as PaymentMethodId),
        status: available ? "AVAILABLE" : "UNAVAILABLE",
        explanation: available ? "Through PayRouta" : "Not available for this payment",
      };
    }),
  };
  await db.availabilityEvaluation.create({
    data: {
      id: evaluationId,
      contextId: context.id,
      orgId: intent.orgId,
      environment: intent.environment,
      policyVersion: context.policyVersion,
      contextFingerprint: fingerprint(context.context),
      safe: json(safe),
      trace: json({ source: "platform-accounts", candidateIds: candidates.map((c) => c.profileId) }),
      expiresAt,
      retentionUntil: new Date(now.getTime() + 7 * 86400000),
      createdAt: now,
    },
  });
  return safe;
}

export async function revalidatePlatformEvaluation(
  intent: { orgId: string; contextId: string; environment: string },
  evaluationId: string,
  method: string,
  now: Date,
) {
  const [e, c] = await Promise.all([
    db.availabilityEvaluation.findFirst({
      where: { id: evaluationId, orgId: intent.orgId, contextId: intent.contextId, environment: intent.environment },
    }),
    db.availabilityContext.findFirst({ where: { id: intent.contextId, orgId: intent.orgId } }),
  ]);
  if (!e || !c || e.expiresAt <= now || c.expiresAt <= now || e.contextFingerprint !== fingerprint(c.context))
    throw new PortalError("EVALUATION_EXPIRED_OR_MISMATCHED", 409);
  const platform = await platformCandidates(intent.orgId, intent.environment, method);
  if (!platform.length) throw new PortalError("SELECTED_METHOD_NOT_AVAILABLE", 409);
  return platform;
}
