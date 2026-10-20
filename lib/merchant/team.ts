import { randomBytes } from "node:crypto";
import { z } from "zod";
import { merchantMember, merchantRoles } from "./access";
import { stepUp, rateLimit } from "../portal/access";
import { atomic, audit } from "../portal/service";
import { mail } from "../portal/adapters";
import { renderInvitationEmail } from "../email/templates/transactional";
import { hash } from "../payments/contracts";
import { PortalError } from "../portal/domain";
export async function teamCommand(raw: unknown, headers: Headers) {
  const b = z
    .discriminatedUnion("action", [
      z
        .object({
          action: z.literal("merchant-invite"),
          orgId: z.string(),
          email: z.email(),
          role: z.enum(merchantRoles),
        })
        .strict(),
      z
        .object({
          action: z.literal("merchant-role"),
          orgId: z.string(),
          memberId: z.string(),
          role: z.enum(merchantRoles).nullable(),
        })
        .strict(),
    ])
    .parse(raw);
  const { session, membership } = await merchantMember(
    b.orgId,
    "team",
    headers,
  );
  await stepUp(headers);
  await rateLimit(`merchant-team:${session.user.id}`, 10);
  if (b.role === "Owner" && membership.role !== "Owner")
    throw new PortalError("OWNER_REQUIRED", 403);
  if (b.action === "merchant-invite") {
    const token = randomBytes(32).toString("base64url");
    const invite = await atomic(async (tx) => {
      const invitation = await tx.invitation.create({
        data: {
          orgId: b.orgId,
          email: b.email.toLowerCase(),
          role: b.role,
          participation: "merchant",
          tokenHash: hash(token),
          expiresAt: new Date(Date.now() + 7 * 86400000),
        },
      });
      await audit(
        tx,
        b.orgId,
        session.user.id,
        "merchant.invitation.created",
        invitation.id,
        { role: b.role },
      );
      return invitation;
    });
    await mail.send(b.email, {
      ...renderInvitationEmail({
        orgName: membership.org.name,
        role: b.role,
        url: `${process.env.BETTER_AUTH_URL}/merchant/team?orgId=${encodeURIComponent(b.orgId)}&invitation=${token}`,
        expires: "7 days",
      }),
      tag: "invitation",
      idempotencyKey: `invitation/${invite.id}`,
    });
    return { id: invite.id };
  }
  return atomic(async (tx) => {
    const target = await tx.membership.findFirst({
      where: { id: b.memberId, orgId: b.orgId },
    });
    if (!target?.merchantRole) throw new PortalError("NOT_FOUND", 404);
    if (target.merchantRole === "Owner") {
      if (membership.role !== "Owner")
        throw new PortalError("OWNER_REQUIRED", 403);
      if (
        b.role !== "Owner" &&
        (await tx.membership.count({
          where: { orgId: b.orgId, merchantRole: "Owner" },
        })) <= 1
      )
        throw new PortalError("LAST_OWNER_REQUIRED", 409);
    }
    await tx.membership.update({
      where: { id: target.id },
      data: { merchantRole: b.role },
    });
    await audit(
      tx,
      b.orgId,
      session.user.id,
      "merchant.membership.changed",
      target.id,
      { role: b.role },
    );
    return { ok: true };
  });
}
