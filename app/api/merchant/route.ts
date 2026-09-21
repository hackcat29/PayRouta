import { liveScopeCommand } from "@/lib/merchant/live-scope";
import { transitionRollout } from "@/lib/merchant/qualification";
import { teamCommand } from "@/lib/merchant/team";
import { saveApplication, operatorCommand } from "@/lib/merchant/onboarding";
import { z } from "zod";
import { configureWebhook, redeliver } from "@/lib/merchant/service";
import { atomic, audit } from "@/lib/portal/service";
import { csrf, stepUp } from "@/lib/portal/access";
import { issueKey, revokeKey, merchantMember } from "@/lib/merchant/access";
import { respond, rawBody } from "@/lib/payments/http";
import { db } from "@/lib/portal/db";
const command = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("webhook"),
      orgId: z.string(),
      input: z.unknown(),
    })
    .strict(),
  z
    .object({ action: z.literal("disable-webhook"), orgId: z.string() })
    .strict(),
  z
    .object({
      action: z.literal("redeliver"),
      orgId: z.string(),
      eventId: z.string(),
    })
    .strict(),
  z
    .object({
      action: z.literal("application"),
      orgId: z.string(),
      input: z.unknown(),
      version: z.number().int(),
      submit: z.boolean(),
    })
    .strict(),
  z
    .object({
      action: z.literal("issue-key"),
      orgId: z.string(),
      input: z.unknown(),
    })
    .strict(),
  z
    .object({
      action: z.literal("revoke-key"),
      orgId: z.string(),
      id: z.string(),
    })
    .strict(),
]);
export async function POST(request: Request) {
  return respond(async () => {
    csrf(request);
    const raw = JSON.parse(await rawBody(request));
    if (
      [
        "propose-live-scope",
        "approve-live-scope",
        "revoke-live-scope",
      ].includes(raw?.action)
    )
      return liveScopeCommand(raw, request.headers);
    if (raw?.action === "rollout-transition")
      return transitionRollout(raw, request.headers);
    if (["merchant-invite", "merchant-role"].includes(raw?.action))
      return teamCommand(raw, request.headers);
    if (["policy", "approve-risk", "review-application"].includes(raw?.action))
      return operatorCommand(raw, request.headers);
    const b = command.parse(raw);
    if (
      b.action === "webhook" ||
      b.action === "disable-webhook" ||
      b.action === "redeliver"
    ) {
      const { session, config } = await merchantMember(
        b.orgId,
        "configure",
        request.headers,
      );
      await stepUp(request.headers);
      const scope = { orgId: b.orgId, environment: config.environment };
      if (b.action === "webhook")
        return configureWebhook(scope, session.user.id, b.input);
      if (b.action === "redeliver")
        return redeliver(scope, b.eventId, session.user.id);
      return atomic(async (tx) => {
        await tx.merchantConfig.update({
          where: { orgId: b.orgId },
          data: { webhookUrl: null },
        });
        await audit(
          tx,
          b.orgId,
          session.user.id,
          "merchant.webhook.disabled",
          b.orgId,
        );
        return { disabled: true };
      });
    }
    if (b.action === "application")
      return saveApplication(
        b.orgId,
        b.input,
        b.version,
        b.submit,
        request.headers,
      );
    return b.action === "issue-key"
      ? issueKey(b.orgId, b.input, request.headers)
      : revokeKey(b.orgId, b.id, request.headers);
  });
}
export async function GET(request: Request) {
  return respond(async () => {
    const orgId = new URL(request.url).searchParams.get("orgId") || "";
    await merchantMember(orgId, "configure", request.headers);
    return db.merchantApiKey.findMany({
      where: { orgId },
      select: {
        id: true,
        environment: true,
        prefix: true,
        permissions: true,
        createdAt: true,
        expiresAt: true,
        revokedAt: true,
        lastUsedAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  });
}
