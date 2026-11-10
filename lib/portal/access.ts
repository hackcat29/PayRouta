import { validateRuntime } from "./config";
import { headers } from "next/headers";
import { auth } from "./auth";
import { db } from "./db";
import { can, Permission, PortalError } from "./domain";
export async function identity(h?: Headers) {
  validateRuntime();
  const session = await auth.api.getSession({
    headers: h || (await headers()),
  });
  if (!session || !session.user.emailVerified)
    throw new PortalError("Sign in with a verified account", 401);
  return session;
}
export async function member(
  orgId: string,
  permission: Permission = "read",
  h?: Headers,
) {
  const session = await identity(h);
  const membership = await db.membership.findUnique({
    where: { orgId_userId: { orgId, userId: session.user.id } },
    include: { org: true },
  });
  if (!membership || !can(membership.role, permission))
    throw new PortalError("You do not have access to this action", 403);
  return { session, membership };
}
export async function stepUp(h?: Headers) {
  const session = await identity(h);
  const grant = await db.stepUp.findUnique({
    where: { sessionId: session.session.id },
  });
  // Two-step verification is an authenticator app or a passkey (or both);
  // a confirmation with either lasts 15 minutes (lib/portal/step-up.ts).
  const protectedAccount =
    !!session.user.twoFactorEnabled ||
    (await db.passkey.count({ where: { userId: session.user.id } })) > 0;
  if (!protectedAccount) throw new PortalError("TWO_STEP_REQUIRED", 403);
  if (!grant || grant.expiresAt < new Date())
    throw new PortalError("STEP_UP_REQUIRED", 403);
  return session;
}
export async function internal(admin = false, h?: Headers) {
  const session = await stepUp(h);
  const user = await db.user.findUniqueOrThrow({
    where: { id: session.user.id },
  });
  if (!user.internalRole || (admin && user.internalRole !== "Operations admin"))
    throw new PortalError("Internal role required", 403);
  return session;
}
export async function rateLimit(key: string, max = 30) {
  const now = Date.now();
  const window = Math.floor(now / 60000);
  const record = await db.rateLimit.upsert({
    where: { key: `portal:${key}:${window}` },
    create: {
      key: `portal:${key}:${window}`,
      count: 1,
      lastRequest: BigInt(now),
    },
    update: { count: { increment: 1 }, lastRequest: BigInt(now) },
  });
  if (record.count > max)
    throw new PortalError("Too many attempts. Try again in a minute.", 429);
}
export function csrf(request: Request) {
  if (
    request.headers.get("origin") !==
    new URL(process.env.BETTER_AUTH_URL || request.url).origin
  )
    throw new PortalError("Request origin rejected", 403);
}
