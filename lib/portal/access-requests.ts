// Provider access by invitation. A request from the public form waits for an
// operations admin; approving it creates the provider organization (with an
// empty application) and emails the contact an owner invitation, which they
// accept after setting up their login with the same email address.
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { Prisma } from "@/lib/generated/prisma/client";
import {
  renderProviderAccessAlertEmail,
  renderProviderAccessApprovedEmail,
  renderProviderAccessDeclinedEmail,
  renderProviderAccessReceivedEmail,
} from "@/lib/email/templates/transactional";
import { accessRequestSchema } from "./access-request-schema";
import { localMode, mail } from "./adapters";
import { db } from "./db";
import { PortalError } from "./domain";
import { atomic, audit } from "./service";

const INVITE_DAYS = 14;
const origin = () => process.env.BETTER_AUTH_URL || "http://127.0.0.1:3000";
const quietly = (what: string) => (e: unknown) =>
  console.error(`[provider-access] ${what}`, e instanceof Error ? e.message : e);

export async function submitAccessRequest(raw: unknown) {
  const value = accessRequestSchema.parse(raw);
  const received = { message: "Thanks. We've received your request and will reply by email." };
  if (value.companyFax) return received;
  const pending = await db.providerAccessRequest.findFirst({
    where: { email: value.email, state: "Pending" },
    select: { id: true },
  });
  if (pending)
    return { message: "You already have a request in review. We'll reply to the same email address." };
  const { companyFax, methods, ...fields } = value;
  void companyFax;
  try {
    await db.providerAccessRequest.create({
      data: { ...fields, methods: methods.join(", ") },
    });
  } catch (e) {
    // A retried submission (same submissionId) was already stored.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return received;
    throw e;
  }
  await mail
    .send(value.email, {
      ...renderProviderAccessReceivedEmail({ name: value.name, company: value.company }),
      tag: "provider_access_received",
      idempotencyKey: `provider-access-received/${value.submissionId}`,
    })
    .catch(quietly("acknowledgement email"));
  const team = process.env.PROVIDER_REQUESTS_EMAIL || process.env.CONTACT_EMAIL;
  if (team)
    await mail
      .send(team, {
        ...renderProviderAccessAlertEmail({
          company: value.company,
          providerType: value.providerType,
          country: value.country,
          url: `${origin()}/ops/provider-requests`,
        }),
        tag: "provider_access_alert",
        idempotencyKey: `provider-access-alert/${value.submissionId}`,
      })
      .catch(quietly("team alert"));
  return received;
}

export const reviewSchema = z.discriminatedUnion("decision", [
  z.object({
    decision: z.literal("approve"),
    requestId: z.string().min(1).max(100),
    orgName: z.string().trim().min(2).max(120),
    note: z.string().trim().max(1000).optional(),
  }),
  z.object({
    decision: z.literal("decline"),
    requestId: z.string().min(1).max(100),
    // Shared with the applicant when present.
    note: z.string().trim().max(1000).optional(),
  }),
]);

// Callers check that the actor is an operations admin.
export async function reviewAccessRequest(raw: unknown, actorId: string) {
  const input = reviewSchema.parse(raw);
  const token = randomBytes(32).toString("base64url");
  const result = await atomic(async (tx) => {
    const request = await tx.providerAccessRequest.findUnique({ where: { id: input.requestId } });
    if (!request) throw new PortalError("Request not found", 404);
    if (request.state !== "Pending") throw new PortalError(`This request was already ${request.state.toLowerCase()}`, 409);
    const reviewed = { reviewedBy: actorId, reviewedAt: new Date(), reviewNote: input.note || null };
    if (input.decision === "decline") {
      await tx.providerAccessRequest.update({
        where: { id: request.id },
        data: { ...reviewed, state: "Declined" },
      });
      await audit(tx, null, actorId, "Provider access declined", request.id, {}, true);
      return { request, orgId: null };
    }
    const org = await tx.organization.create({
      data: {
        name: input.orgName,
        fictional: localMode(),
        application: { create: {} },
      },
    });
    const invitation = await tx.invitation.create({
      data: {
        orgId: org.id,
        email: request.email,
        role: "Owner",
        participation: "provider",
        tokenHash: createHash("sha256").update(token).digest("hex"),
        expiresAt: new Date(Date.now() + INVITE_DAYS * 86400000),
      },
    });
    await tx.providerAccessRequest.update({
      where: { id: request.id },
      data: { ...reviewed, state: "Approved", orgId: org.id, invitationId: invitation.id },
    });
    await audit(tx, org.id, actorId, "Provider organization created from access request", request.id, {
      invitationId: invitation.id,
    });
    return { request, orgId: org.id };
  });
  const { request } = result;
  if (input.decision === "decline") {
    await mail
      .send(request.email, {
        ...renderProviderAccessDeclinedEmail({ name: request.name, company: request.company, note: input.note }),
        tag: "provider_access_declined",
        idempotencyKey: `provider-access-declined/${request.id}`,
      })
      .catch(quietly("decline email"));
    return { message: "Request declined. The applicant has been told by email." };
  }
  // New contacts create their login first; existing users just sign in.
  const next = `/provider/team?invitation=${token}`;
  const known = await db.user.findUnique({ where: { email: request.email }, select: { id: true } });
  const url = `${origin()}/provider/${known ? "sign-in" : "sign-up"}?next=${encodeURIComponent(next)}`;
  const delivery = await mail.send(request.email, {
    ...renderProviderAccessApprovedEmail({
      name: request.name,
      company: input.orgName,
      url,
      expires: `${INVITE_DAYS} days`,
    }),
    tag: "provider_access_approved",
    idempotencyKey: `provider-access-approved/${request.id}`,
  });
  return {
    orgId: result.orgId,
    message:
      delivery === "captured"
        ? "Approved. The invitation was captured in local mail; no email was sent."
        : `Approved. ${request.email} has been emailed an invitation to set up their login.`,
  };
}
