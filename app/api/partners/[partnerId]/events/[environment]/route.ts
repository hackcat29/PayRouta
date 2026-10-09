import { z } from "zod";
import { PortalError } from "@/lib/portal/domain";
import { atomic } from "@/lib/portal/service";
import { hash } from "@/lib/payments/contracts";
import { queue } from "@/lib/payments/service";
import { respond, rawBody } from "@/lib/payments/http";
import { adapterFor } from "@/lib/partners/service";

// Partner account events. Verified with the partner's own scheme, deduplicated
// durably, then processed asynchronously as a prompt to re-read status.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ partnerId: string; environment: string }> },
) {
  return respond(async () => {
    const p = await params;
    const partnerId = z.string().regex(/^[a-z][a-z0-9-]{1,40}$/).parse(p.partnerId);
    const environment = z.enum(["sandbox", "production"]).parse(p.environment);
    const raw = await rawBody(request, 262144);
    const adapter = await adapterFor(partnerId, environment);
    const event = await adapter.verifyEvent({ rawBody: raw, headers: request.headers });
    if (!event) throw new PortalError("INVALID_SIGNATURE", 401);
    const fingerprint = hash(raw);
    return atomic(async (tx) => {
      const old = await tx.partnerEvent.findUnique({
        where: {
          partnerId_environment_eventId: { partnerId, environment, eventId: event.eventId },
        },
      });
      if (old) {
        if (old.fingerprint !== fingerprint) throw new PortalError("EVENT_ID_CONFLICT", 409);
        return { accepted: true, duplicate: true };
      }
      const row = await tx.partnerEvent.create({
        data: {
          partnerId,
          environment,
          eventId: event.eventId,
          fingerprint,
          type: event.type,
          accountRef: event.accountRef?.slice(0, 200),
          providerAccountId: event.providerAccountId?.slice(0, 200),
          objectRef: event.objectRef?.slice(0, 200),
        },
      });
      const application = await tx.partnerApplication.findFirst({
        where: {
          partnerId,
          environment,
          OR: [
            ...(event.accountRef ? [{ accountRef: event.accountRef }] : []),
            ...(event.providerAccountId ? [{ providerAccountId: event.providerAccountId }] : []),
          ],
        },
        select: { orgId: true },
      });
      const attempt =
        !application && event.objectRef
          ? await tx.paymentAttempt.findFirst({
              where: { providerReference: event.objectRef, environment },
              select: { intent: { select: { orgId: true } } },
            })
          : null;
      const owner = application?.orgId ?? attempt?.intent.orgId;
      // Unmatched events are retained for inspection; jobs need an owning org.
      if (owner)
        await queue(tx, owner, "partner-event", `partner-event:${row.id}`, {
          eventId: row.id,
        });
      else
        await tx.partnerEvent.update({ where: { id: row.id }, data: { state: "Unmatched" } });
      return { accepted: true };
    });
  });
}
