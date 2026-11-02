import { createPaymentLink, setPaymentLinkActive } from "@/lib/merchant/payment-links";
import { createMerchantCryptoCheckout } from "@/lib/merchant/crypto-checkout";
import { setFeeBearer } from "@/lib/merchant/fees";
import { createStablecoinCheckout } from "@/lib/merchant/stablecoin-checkout";
import { configureStablecoins } from "@/lib/merchant/stablecoins";
import { connectIntentsAccount, disconnectIntentsAccount, intentsChallenge } from "@/lib/intents/account";
import { setSwapSettlement } from "@/lib/intents/checkout";
import { PortalError } from "@/lib/portal/domain";
import { addBridgeBank, cashOutsFor, quoteCashOut, setYellowCard, startBridge, yellowCardNetworks } from "@/lib/treasury/offramp/cashout";
import { payoutsFor, quotePayout, submitPayout } from "@/lib/intents/payouts";
import { issueAgentKey, revokeAgentKey } from "@/lib/agents/keys";
import { liveScopeCommand } from "@/lib/merchant/live-scope";
import { createMerchantWorkspace } from "@/lib/merchant/workspace";
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
    if (raw?.action === "payment-link")
      return createPaymentLink(z.string().min(1).parse(raw.orgId), raw.input, request.headers);
    if (raw?.action === "payment-link-active")
      return setPaymentLinkActive(
        z.string().min(1).parse(raw.orgId),
        z.string().min(1).parse(raw.id),
        z.boolean().parse(raw.active),
        request.headers,
      );
    if (raw?.action === "crypto-checkout")
      return createMerchantCryptoCheckout(
        z.string().min(1).parse(raw.orgId),
        raw.input,
        request.headers,
      );
    if (raw?.action === "crypto-wallets")
      return configureStablecoins(
        z.string().min(1).parse(raw.orgId),
        raw.input,
        request.headers,
        true,
      );
    if (raw?.action === "stablecoin-checkout")
      return createStablecoinCheckout(
        z.string().min(1).parse(raw.orgId),
        raw.input,
        request.headers,
      );
    // Cashing out crypto to a bank or mobile money (lib/treasury/offramp).
    if (typeof raw?.action === "string" && raw.action.startsWith("cashout-")) {
      const orgId = z.string().min(1).parse(raw.orgId);
      if (raw.action === "cashout-bridge-start") return startBridge(orgId, raw.input, request.headers);
      if (raw.action === "cashout-bridge-bank") return addBridgeBank(orgId, raw.input, request.headers);
      if (raw.action === "cashout-yellowcard-networks") return yellowCardNetworks(orgId, raw.input, request.headers);
      if (raw.action === "cashout-yellowcard-account") return setYellowCard(orgId, raw.input, request.headers);
      if (raw.action === "cashout-quote") return quoteCashOut(orgId, raw.input, request.headers);
      if (raw.action === "cashout-list") return cashOutsFor(orgId, request.headers);
      throw new PortalError("UNKNOWN_ACTION", 400);
    }
    // Which receive stablecoin payments in other tokens settle into.
    if (raw?.action === "swap-settlement")
      return setSwapSettlement(z.string().min(1).parse(raw.orgId), raw.input ?? null, request.headers);
    if (raw?.action === "stablecoins")
      return configureStablecoins(
        z.string().min(1).parse(raw.orgId),
        raw.input,
        request.headers,
      );
    // Keys AI agents pay with, and their spending limits (lib/agents).
    if (raw?.action === "agent-key-create")
      return issueAgentKey(z.string().min(1).parse(raw.orgId), raw.input, request.headers);
    if (raw?.action === "agent-key-revoke")
      return revokeAgentKey(z.string().min(1).parse(raw.orgId), z.string().min(1).parse(raw.id), request.headers);
    // NEAR Intents settlement account, payouts and refunds (lib/intents).
    if (typeof raw?.action === "string" && raw.action.startsWith("intents-")) {
      const orgId = z.string().min(1).parse(raw.orgId);
      if (raw.action === "intents-challenge")
        return intentsChallenge(orgId, raw.input, request.headers);
      if (raw.action === "intents-connect")
        return connectIntentsAccount(orgId, raw.input, request.headers);
      if (raw.action === "intents-disconnect")
        return disconnectIntentsAccount(orgId, request.headers);
      if (raw.action === "intents-payout-quote")
        return quotePayout(orgId, raw.input, request.headers);
      if (raw.action === "intents-payout-submit")
        return submitPayout(orgId, raw.input, request.headers);
      if (raw.action === "intents-payouts")
        return payoutsFor(orgId, request.headers);
    }
    if (raw?.action === "rollout-transition")
      return transitionRollout(raw, request.headers);
    if (raw?.action === "create-workspace")
      return createMerchantWorkspace(raw.input, request.headers);
    if (["merchant-invite", "merchant-role"].includes(raw?.action))
      return teamCommand(raw, request.headers);
    if (["policy", "approve-risk", "review-application"].includes(raw?.action))
      return operatorCommand(raw, request.headers);
    if (raw?.action === "fee-bearer") {
      const orgId = z.string().parse(raw.orgId);
      const { session, config } = await merchantMember(orgId, "configure", request.headers);
      await stepUp(request.headers);
      return setFeeBearer({ orgId, environment: config.environment }, session.user.id, raw.input);
    }
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
