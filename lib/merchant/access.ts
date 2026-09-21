import { randomBytes, timingSafeEqual } from "node:crypto";
import { db } from "../portal/db";
import { member, rateLimit, stepUp } from "../portal/access";
import { atomic, audit, json } from "../portal/service";
import { hash } from "../payments/contracts";
import { PortalError } from "../portal/domain";
import { environment, keyInput } from "./contracts";
export async function merchantMember(
  orgId: string,
  permission: "read" | "configure" = "read",
  headers?: Headers,
) {
  const actor = await member(orgId, permission, headers);
  const config = await db.merchantConfig.findUnique({ where: { orgId } });
  if (!config) throw new PortalError("MERCHANT_NOT_CONFIGURED", 403);
  return { ...actor, config };
}
export async function issueKey(orgId: string, raw: unknown, headers: Headers) {
  const { session, config } = await merchantMember(orgId, "configure", headers);
  await stepUp(headers);
  const input = keyInput.parse(raw);
  if (input.environment !== config.environment)
    throw new PortalError("ENVIRONMENT_NOT_CONFIGURED", 409);
  if (input.expiresAt && new Date(input.expiresAt) <= new Date())
    throw new PortalError("EXPIRY_MUST_BE_FUTURE");
  const secret = `pr_${input.environment}_${randomBytes(32).toString("base64url")}`;
  const key = await atomic(async (tx) => {
    const key = await tx.merchantApiKey.create({
      data: {
        orgId,
        environment: input.environment,
        prefix: secret.slice(0, 22),
        verifier: hash(secret),
        permissions: json(input.permissions),
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      },
    });
    await audit(tx, orgId, session.user.id, "merchant.key.created", key.id, {
      permissions: input.permissions,
      environment: input.environment,
    });
    return key;
  });
  return {
    id: key.id,
    secret,
    prefix: key.prefix,
    environment: key.environment,
    permissions: key.permissions,
  };
}
export async function revokeKey(orgId: string, id: string, headers: Headers) {
  const { session } = await merchantMember(orgId, "configure", headers);
  await stepUp(headers);
  return atomic(async (tx) => {
    const key = await tx.merchantApiKey.findFirst({ where: { id, orgId } });
    if (!key) throw new PortalError("NOT_FOUND", 404);
    await tx.merchantApiKey.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
    await audit(tx, orgId, session.user.id, "merchant.key.revoked", id);
    return { id, revoked: true };
  });
}
export async function authenticate(request: Request, scope: string) {
  const env = environment.parse(request.headers.get("payrouta-environment"));
  const token = request.headers
    .get("authorization")
    ?.match(/^Bearer (pr_(?:sandbox|production)_[\w-]{43})$/)?.[1];
  if (!token) throw new PortalError("UNAUTHORIZED", 401);
  const verifier = hash(token);
  const key = await db.merchantApiKey.findUnique({ where: { verifier } });
  if (
    !key ||
    !timingSafeEqual(Buffer.from(key.verifier), Buffer.from(verifier)) ||
    key.revokedAt ||
    (key.expiresAt && key.expiresAt <= new Date())
  )
    throw new PortalError("UNAUTHORIZED", 401);
  if (key.environment !== env || !(key.permissions as string[]).includes(scope))
    throw new PortalError("FORBIDDEN", 403);
  const config = await db.merchantConfig.findUnique({
    where: { orgId: key.orgId },
  });
  if (!config || config.environment !== env)
    throw new PortalError("ENVIRONMENT_NOT_CONFIGURED", 403);
  await rateLimit(`merchant-api:${key.orgId}:${env}`, 120);
  await db.merchantApiKey.update({
    where: { id: key.id },
    data: { lastUsedAt: new Date() },
  });
  return { orgId: key.orgId, environment: env, keyId: key.id };
}
