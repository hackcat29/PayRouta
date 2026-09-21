import { z } from "zod";
import { member, csrf, internal, rateLimit } from "@/lib/portal/access";
import { createIntent, createSession, queue } from "@/lib/payments/service";
import { db } from "@/lib/portal/db";
import { atomic, json } from "@/lib/portal/service";
import { secretManager } from "@/lib/portal/adapters";
import { validateEndpoint } from "@/lib/portal/ssrf";
import { respond, rawBody } from "@/lib/payments/http";
const schema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("create"),
      orgId: z.string(),
      key: z.string(),
      intent: z.unknown(),
    })
    .strict(),
  z
    .object({
      action: z.literal("session"),
      orgId: z.string(),
      intentId: z.string(),
    })
    .strict(),
  z
    .object({
      action: z.literal("webhook"),
      orgId: z.string(),
      url: z.url(),
      secret: z.string().min(32).max(200),
      keyId: z.string().min(1).max(40),
    })
    .strict(),
  z.object({ action: z.literal("reconcile"), attemptId: z.string() }).strict(),
  z.object({ action: z.literal("redeliver"), eventId: z.string() }).strict(),
  z
    .object({
      action: z.literal("resolve"),
      exceptionId: z.string(),
      reason: z.string().min(10).max(1000),
    })
    .strict(),
]);
export async function POST(r: Request) {
  return respond(async () => {
    csrf(r);
    const b = schema.parse(JSON.parse(await rawBody(r)));
    if ("orgId" in b) {
      const m = await member(
        b.orgId,
        b.action === "webhook" ? "configure" : "integration",
        r.headers,
      );
      await rateLimit(`payments:${m.session.user.id}`);
      if (b.action === "create") return createIntent(b.orgId, b.key, b.intent);
      if (b.action === "session") return createSession(b.orgId, b.intentId);
      await validateEndpoint(b.url);
      const ref = await secretManager.put(b.secret);
      await db.merchantConfig.update({
        where: { orgId: b.orgId },
        data: {
          webhookUrl: b.url,
          webhookSecretRef: ref,
          webhookKeyId: b.keyId,
        },
      });
      return { ok: true };
    }
    const actor = await internal(true, r.headers);
    if (b.action === "reconcile") {
      const a = await db.paymentAttempt.findUniqueOrThrow({
        where: { id: b.attemptId },
        include: { intent: true },
      });
      await atomic((tx) =>
        queue(
          tx,
          a.intent.orgId,
          "payment-reconcile",
          `manual:${crypto.randomUUID()}`,
          { attemptId: a.id },
        ),
      );
    }
    if (b.action === "redeliver") {
      const e = await db.merchantEvent.findUniqueOrThrow({
        where: { id: b.eventId },
      });
      await db.merchantDelivery.update({
        where: { eventId: e.id },
        data: { state: "Pending" },
      });
      await atomic((tx) =>
        queue(
          tx,
          e.orgId,
          "payment-delivery",
          `redelivery:${crypto.randomUUID()}`,
          { eventId: e.id },
        ),
      );
    }
    if (b.action === "resolve")
      await atomic(async (tx) => {
        const e = await tx.paymentException.findUniqueOrThrow({
          where: { id: b.exceptionId },
        });
        await tx.paymentException.update({
          where: { id: e.id },
          data: {
            state: "Resolved",
            timeline: json([
              ...(e.timeline as object[]),
              {
                at: new Date().toISOString(),
                actor: actor.user.id,
                reason: b.reason,
              },
            ]),
          },
        });
      });
    return { ok: true };
  });
}
export async function GET(r: Request) {
  return respond(async () => {
    const url = new URL(r.url);
    const orgId = url.searchParams.get("orgId") || "";
    await member(orgId, "read", r.headers);
    const id = url.searchParams.get("id") || "";
    return db.paymentIntent.findFirstOrThrow({
      where: { id, orgId },
      include: { attempts: true },
    });
  });
}
