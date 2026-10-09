import { assertLaunchMethod } from "../payments/launch";
import { merchantRequirements } from "./evidence";
import { z } from "zod";
import { merchantMember } from "./access";
import { internal } from "../portal/access";
import { atomic, audit, json } from "../portal/service";
import { PortalError } from "../portal/domain";
import { riskPolicySchema } from "./policy";
import { queue } from "../payments/service";
import { randomUUID } from "node:crypto";
export const applicationSchema = z
  .object({
    legalName: z.string().min(2).max(200),
    tradingName: z.string().max(200),
    country: z.string().regex(/^[A-Z]{2}$/),
    website: z.url().max(500),
    activity: z.string().min(10).max(2000),
    businessContact: z.email(),
    technicalContact: z.email(),
    methods: z
      .array(z.enum(["bank-transfer", "card", "stablecoin", "mobile-money"]))
      .min(1)
      .max(4),
    volumeRange: z.string().min(1).max(100),
    settlementCurrencies: z
      .array(z.string().regex(/^[A-Z]{3}$/))
      .min(1)
      .max(10),
    payerMarkets: z
      .array(z.string().regex(/^[A-Z]{2}$/))
      .min(1)
      .max(30),
  })
  .strict();
export async function saveApplication(
  orgId: string,
  raw: unknown,
  version: number,
  submit: boolean,
  headers: Headers,
) {
  const { session } = await merchantMember(orgId, "configure", headers);
  const value = submit
    ? applicationSchema.parse(raw)
    : applicationSchema.partial().parse(raw);
  for (const method of value.methods ?? []) assertLaunchMethod(method);
  const requirements = submit ? await merchantRequirements(value) : [];
  return atomic(async (tx) => {
    const config = await tx.merchantConfig.findUniqueOrThrow({
      where: { orgId },
    });
    if (
      config.applicationVersion !== version ||
      !["Draft", "Changes requested"].includes(config.applicationState)
    )
      throw new PortalError("APPLICATION_CONFLICT", 409);
    const updated = await tx.merchantConfig.update({
      where: { orgId },
      data: {
        application: json({
          ...value,
          ...(submit ? { requirementIds: requirements.map((r) => r.id) } : {}),
        }),
        applicationState: submit ? "Submitted" : config.applicationState,
        applicationVersion: { increment: 1 },
      },
    });
    await audit(
      tx,
      orgId,
      session.user.id,
      submit ? "merchant.application.submitted" : "merchant.application.saved",
      orgId,
      {
        version: updated.applicationVersion,
        ...(submit ? { snapshot: updated.application } : {}),
      },
      true,
    );
    return {
      state: updated.applicationState,
      version: updated.applicationVersion,
    };
  });
}
export async function operatorCommand(raw: unknown, headers: Headers) {
  const actor = await internal(true, headers);
  const b = z
    .discriminatedUnion("action", [
      z
        .object({
          action: z.literal("policy"),
          orgId: z.string(),
          reason: z.string().min(10).max(1000),
          policy: riskPolicySchema,
        })
        .strict(),
      z
        .object({
          action: z.literal("review-application"),
          orgId: z.string(),
          reason: z.string().min(10).max(1000),
          version: z.number().int(),
          state: z.enum(["Under review", "Changes requested"]),
        })
        .strict(),
      z
        .object({
          action: z.literal("approve-risk"),
          orgId: z.string(),
          reason: z.string().min(10).max(1000),
          intentId: z.string(),
        })
        .strict(),
    ])
    .parse(raw);
  return atomic(async (tx) => {
    const config = await tx.merchantConfig.findUniqueOrThrow({
      where: { orgId: b.orgId },
    });
    if (b.action === "policy") {
      const policy = { ...b.policy, version: randomUUID() };
      await tx.merchantConfig.update({
        where: { orgId: b.orgId },
        data: { riskPolicy: json(policy) },
      });
      await audit(
        tx,
        b.orgId,
        actor.user.id,
        "merchant.policy.changed",
        b.orgId,
        { reason: b.reason, previous: config.riskPolicy, policy },
        true,
      );
    } else if (b.action === "review-application") {
      if (
        config.applicationVersion !== b.version ||
        (b.state === "Under review"
          ? config.applicationState !== "Submitted"
          : config.applicationState !== "Under review")
      )
        throw new PortalError("APPLICATION_CONFLICT", 409);
      await tx.merchantConfig.update({
        where: { orgId: b.orgId },
        data: {
          applicationState: b.state,
          application: json({
            ...(config.application as object),
            reviewFeedback: b.reason,
          }),
          applicationVersion: { increment: 1 },
        },
      });
      await audit(
        tx,
        b.orgId,
        actor.user.id,
        "merchant.application.review",
        b.orgId,
        { reason: b.reason, state: b.state },
        true,
      );
    } else {
      const intent = await tx.paymentIntent.findFirst({
        where: { id: b.intentId, orgId: b.orgId },
      });
      if (!intent) throw new PortalError("NOT_FOUND", 404);
      const version = riskPolicySchema.parse(config.riskPolicy).version;
      const hold = await tx.merchantRiskDecision.findFirst({
        where: {
          intentId: b.intentId,
          policyVersion: version,
          decision: "Hold for review",
          expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: "desc" },
      });
      if (!hold) throw new PortalError("NO_CURRENT_REVIEW_HOLD", 409);
      await tx.merchantRiskDecision.create({
        data: {
          intentId: b.intentId,
          policyVersion: version,
          decision: "Review approved",
          reasons: ["MANUAL_AMOUNT_REVIEW"],
          expiresAt: new Date(Date.now() + 15 * 60000),
        },
      });
      await audit(
        tx,
        b.orgId,
        actor.user.id,
        "merchant.risk.review-approved",
        b.intentId,
        { reason: b.reason, policyVersion: version },
        true,
      );
      const pending = await tx.paymentAttempt.findFirst({
        where: { intentId: b.intentId, state: "Created" },
      });
      if (pending)
        await queue(
          tx,
          b.orgId,
          "payment-dispatch",
          `risk-resume:${randomUUID()}`,
          { attemptId: pending.id },
        );
    }
    return { ok: true };
  });
}
