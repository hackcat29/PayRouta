import { createCryptoCheckout } from "@/lib/payments/crypto-checkout";
import { createUniversalCheckout } from "@/lib/payments/universal";
import { merchantConfiguration } from "@/lib/merchant/configuration";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { authenticate } from "@/lib/merchant/access";
import {
  operations,
  responseContract,
  openapi,
  toPublicIntent,
  sessionInput,
} from "@/lib/merchant/contracts";
import {
  intents,
  settlements,
  session,
  pagination,
  page,
  configureWebhook,
  redeliver,
  cancelIntent,
} from "@/lib/merchant/service";
import { db } from "@/lib/portal/db";
import { atomic, audit } from "@/lib/portal/service";
import { PortalError } from "@/lib/portal/domain";
import { createIntent, intentAvailability } from "@/lib/payments/service";
import {
  advanceTestPeriod,
  cancelSubscription,
  createPlan,
  createSubscription,
  getSubscription,
  listPlans,
  listSubscriptions,
  recordUsage,
} from "@/lib/subscriptions/service";

import { rawBody } from "@/lib/payments/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handle(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const requestId = randomUUID();
  const started = Date.now();
  let actor: Awaited<ReturnType<typeof authenticate>> | undefined;
  let status = 200;
  let response: unknown;
  const { path } = await context.params;
  const [resource, id, action] = path;
  const operation = `${request.method} ${resource}`;
  try {
    if (operation === "GET openapi.json" && path.length === 1)
      return Response.json(openapi());
    const scope = operations[operation as keyof typeof operations];
    if (!scope || path.length > 3) throw new PortalError("NOT_FOUND", 404);
    actor = await authenticate(request, scope);
    const tenant = { orgId: actor.orgId, environment: actor.environment };
    const params = new URL(request.url).searchParams;
    const body = async () => JSON.parse(await rawBody(request));
    const key = request.headers.get("idempotency-key") || "";
    if (
      action &&
      !(
        ((resource === "webhook-deliveries" && action === "redeliver") ||
          (resource === "payment-intents" && action === "cancel") ||
          (resource === "subscriptions" && ["cancel", "usage", "advance"].includes(action))) &&
        request.method === "POST"
      )
    )
      throw new PortalError("NOT_FOUND", 404);
    if (
      ["payment-intents", "payments"].includes(resource) &&
      request.method === "GET"
    )
      response = await intents(tenant, params, id);
    else if (operation === "POST payment-intents" && id && action === "cancel")
      response = await cancelIntent(tenant, id, actor.keyId);
    else if (operation === "GET available-methods" && id) {
      const intent = await db.paymentIntent.findFirst({
        where: { ...tenant, id },
      });
      if (!intent) throw new PortalError("NOT_FOUND", 404);
      const availability = await intentAvailability(intent);
      // Hosted checkout has two display-only states; the public contract
      // keeps its documented statuses (docs/api-reference.md).
      const publicStatus: Record<string, string> = {
        NOT_OFFERED: "UNAVAILABLE",
        LOCKED: "AVAILABLE",
      };
      response = {
        ...availability,
        methods: availability.methods.map((m) => ({
          ...m,
          status: publicStatus[m.status] ?? m.status,
        })),
      };
    } else if (operation === "POST payment-intents" && !id) {
      response = toPublicIntent(
        await createIntent(actor.orgId, key, await body()),
      );
      status = 201;
    } else if (operation === "POST checkouts" && !id) {
      response = await createUniversalCheckout(
        actor.orgId,
        actor.environment,
        key,
        await body(),
      );
      status = 201;
    } else if (operation === "POST crypto-checkouts" && !id) {
      response = await createCryptoCheckout(
        actor.orgId,
        actor.environment,
        key,
        await body(),
      );
      status = 201;
    } else if (operation === "POST checkout-sessions" && !id) {
      response = await session(
        tenant,
        sessionInput.parse(await body()).intentId,
        key,
      );
      status = 201;
    } else if (operation === "GET checkout-sessions" && id) {
      response = await db.checkoutSession.findFirst({
        where: { id, intent: tenant },
        select: { id: true, intentId: true, expiresAt: true, revokedAt: true },
      });
      if (!response) throw new PortalError("NOT_FOUND", 404);
    } else if (operation === "GET settlements")
      response = await settlements(tenant, params, id);
    else if (operation === "GET configuration" && !id)
      response = await merchantConfiguration(actor.orgId, actor.environment);
    else if (operation === "GET fee-settings" && !id)
      response = await db.merchantConfig.findUnique({
        where: { orgId: actor.orgId },
        select: { feeBearer: true },
      });
    else if (operation === "GET webhook-endpoint" && !id)
      response = await db.merchantConfig.findUnique({
        where: { orgId: actor.orgId },
        select: { webhookUrl: true, webhookKeyId: true },
      });
    else if (operation === "PUT webhook-endpoint" && !id)
      response = await configureWebhook(tenant, actor.keyId, await body());
    else if (operation === "DELETE webhook-endpoint" && !id)
      response = await atomic(async (tx) => {
        await tx.merchantConfig.update({
          where: { orgId: actor!.orgId },
          data: { webhookUrl: null },
        });
        await audit(
          tx,
          actor!.orgId,
          actor!.keyId,
          "merchant.webhook.disabled",
          actor!.orgId,
        );
        return { disabled: true };
      });
    else if (
      operation === "POST webhook-deliveries" &&
      id &&
      action === "redeliver"
    )
      response = await redeliver(tenant, id, actor.keyId);
    else if (operation === "GET webhook-deliveries") {
      const p = pagination(params);
      const events = await db.merchantEvent.findMany({
        where: { ...tenant, ...(id ? { id } : p.after) },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: id ? 1 : p.limit + 1,
      });
      const deliveries = await db.merchantDelivery.findMany({
        where: { eventId: { in: events.map((e) => e.id) } },
        select: { eventId: true, state: true, attempts: true, updatedAt: true },
      });
      const rows = events.map((e) => ({
        id: e.id,
        intentId: e.intentId,
        type: e.type,
        version: e.version,
        createdAt: e.createdAt,
        delivery: deliveries.find((d) => d.eventId === e.id) || null,
      }));
      if (id && !rows.length) throw new PortalError("NOT_FOUND", 404);
      response = id ? rows[0] : page(rows, p.limit);
    } else if (operation === "GET plans" && !id)
      response = { data: await listPlans(tenant), nextCursor: null };
    else if (operation === "POST plans" && !id) {
      response = await createPlan(tenant, await body(), actor.keyId);
      status = 201;
    } else if (operation === "GET subscriptions")
      response = id ? await getSubscription(tenant, id) : await listSubscriptions(tenant, params);
    else if (operation === "POST subscriptions" && !id) {
      response = await createSubscription(tenant, await body(), actor.keyId);
      status = 201;
    } else if (operation === "POST subscriptions" && id && action === "usage") {
      response = await recordUsage(tenant, id, await body(), key || undefined);
      status = 201;
    } else if (operation === "POST subscriptions" && id && action === "cancel")
      response = await cancelSubscription(
        tenant,
        id,
        JSON.parse((request.body ? await rawBody(request) : "") || "{}"),
        actor.keyId,
      );
    else if (operation === "POST subscriptions" && id && action === "advance")
      response = await advanceTestPeriod(tenant, id);
    else throw new PortalError("NOT_FOUND", 404);
    const validated = responseContract(operation, id, action).safeParse(
      JSON.parse(JSON.stringify(response)),
    );
    if (!validated.success)
      throw new PortalError("INVALID_SERVICE_RESPONSE", 503);
    response = validated.data;
  } catch (error) {
    status =
      error instanceof PortalError
        ? error.status
        : error instanceof ZodError || error instanceof SyntaxError
          ? 400
          : 503;
    const code =
      error instanceof PortalError && /^[A-Z_]+$/.test(error.message)
        ? error.message
        : status === 429
          ? "RATE_LIMITED"
          : status === 400
            ? "INVALID_REQUEST"
            : "SERVICE_UNAVAILABLE";
    // The merchant sees only the code and requestId; the cause goes to the
    // server log under that requestId so support can trace it.
    if (code === "SERVICE_UNAVAILABLE" || status >= 500)
      console.error(`[merchant-api ${requestId}] ${operation} ${status} ${code}`, error);
    response = { error: { code, requestId } };
  }
  if (actor) {
    try {
      await db.merchantRequest.create({
        data: {
          id: requestId,
          orgId: actor.orgId,
          environment: actor.environment,
          operation,
          status,
          durationMs: Date.now() - started,
        },
      });
    } catch {
      console.warn(
        JSON.stringify({
          event: "merchant.request_log_failed",
          operation,
          status,
        }),
      );
    }
  }
  return Response.json(response, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Request-Id": requestId,
      ...(status === 429 ? { "Retry-After": "60" } : {}),
    },
  });
}
export { handle as GET, handle as POST, handle as PUT, handle as DELETE };
