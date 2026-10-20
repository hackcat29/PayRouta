import { z } from "zod";
import { db } from "../portal/db";
import { identity, rateLimit } from "../portal/access";
import { atomic, audit } from "../portal/service";
import { localMode } from "../portal/adapters";
import { PortalError, countries } from "../portal/domain";
import { MarketingService } from "../email/marketing-service";

const countryIds = new Set(countries.map((c) => c.id));
const input = z
  .object({
    name: z.string().trim().min(2).max(120),
    country: z.string().refine((v) => countryIds.has(v), "Unknown country"),
    returnOrigin: z.url().max(300),
  })
  .strict();

// Self-serve merchant workspace. New workspaces start in sandbox; production
// needs business review, an approved provider account and live-scope review.
export async function createMerchantWorkspace(raw: unknown, headers: Headers) {
  const who = await identity(headers);
  await rateLimit(`merchant-workspace:${who.user.id}`, 5);
  const value = input.parse(raw);
  const url = new URL(value.returnOrigin);
  const loopback = localMode() && url.protocol === "http:" && url.hostname === "127.0.0.1";
  if ((url.protocol !== "https:" && !loopback) || url.username || url.password)
    throw new PortalError("RETURN_ORIGIN_MUST_BE_HTTPS");
  const owned = await db.membership.count({
    where: { userId: who.user.id, merchantRole: "Owner" },
  });
  if (owned >= 5) throw new PortalError("WORKSPACE_LIMIT_REACHED", 409);
  return atomic(async (tx) => {
    const org = await tx.organization.create({
      data: {
        name: value.name,
        fictional: localMode(),
        memberships: {
          create: { userId: who.user.id, role: "Owner", merchantRole: "Owner" },
        },
      },
    });
    await tx.merchantConfig.create({
      data: {
        orgId: org.id,
        environment: "sandbox",
        country: value.country,
        returnOrigin: url.origin,
      },
    });
    await audit(tx, org.id, who.user.id, "merchant.workspace.created", org.id, {
      country: value.country,
      returnOrigin: url.origin,
    });
    // Onboarding emails for the new workspace owner. Their address is already
    // verified, so no confirmation email; a past unsubscribe is respected.
    MarketingService.subscribe({
      email: who.user.email,
      name: who.user.name,
      orgId: org.id,
      role: "merchant",
      source: "merchant_workspace_created",
      sendWelcome: true,
      confirmed: true,
    }).catch(console.error);
    return { orgId: org.id };
  });
}
