import { z } from "zod";
import { db } from "@/lib/portal/db";
import { secretManager, localMode } from "@/lib/portal/adapters";
import { PortalError } from "@/lib/portal/domain";
import { atomic, json } from "@/lib/portal/service";
import { hash, verify, providerFact } from "@/lib/payments/contracts";
import { queue } from "@/lib/payments/service";
import { respond, rawBody } from "@/lib/payments/http";
export async function POST(
  r: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return respond(async () => {
    const { id } = await params;
    const integration = await db.integration.findUniqueOrThrow({
      where: { id },
    });
    if (
      integration.environment !== "sandbox" ||
      !localMode() ||
      (integration.config as { adapter: string }).adapter !== "simulator"
    )
      throw new PortalError("ADAPTER_UNCONFIGURED", 409);
    const credential = await db.credential.findFirst({
      where: {
        orgId: integration.orgId,
        environment: "sandbox",
        kind: "payment-webhook",
        revokedAt: null,
      },
      orderBy: { createdAt: "desc" },
    });
    if (!credential?.secretRef)
      throw new PortalError("EVENT_VERIFIER_UNCONFIGURED", 409);
    const raw = await rawBody(r),
      eventId = r.headers.get("payrouta-event-id") || "";
    if (
      !/^[\w-]{1,100}$/.test(eventId) ||
      !verify(
        await secretManager.get(credential.secretRef),
        r.headers.get("payrouta-timestamp") || "",
        eventId,
        raw,
        r.headers.get("payrouta-signature") || "",
        new Date(),
      )
    )
      throw new PortalError("INVALID_SIGNATURE", 401);
    const payload = z
      .object({ type: z.string().max(100), reference: z.string().max(200) })
      .passthrough()
      .parse(JSON.parse(raw));
    if (payload.type === "payment.status") {
      const { type: _, ...fact } = payload;
      void _;
      providerFact.parse(fact);
    }
    return atomic(async (tx) => {
      const old = await tx.paymentInbox.findUnique({
        where: {
          integrationId_environment_eventId: {
            integrationId: id,
            environment: "sandbox",
            eventId,
          },
        },
      });
      if (old) {
        if (old.fingerprint !== hash(raw))
          throw new PortalError("EVENT_ID_CONFLICT", 409);
        return { accepted: true, duplicate: true };
      }
      const inbox = await tx.paymentInbox.create({
        data: {
          integrationId: id,
          environment: "sandbox",
          eventId,
          fingerprint: hash(raw),
          payload: json(payload),
        },
      });
      await queue(tx, integration.orgId, "payment-inbox", `inbox:${inbox.id}`, {
        inboxId: inbox.id,
      });
      return { accepted: true };
    });
  });
}
