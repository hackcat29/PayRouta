// Gatekeeper for company SSO management (/api/auth/sso/*). The SSO plugin
// only knows its own organisation model, so PayRouta checks its own:
// managing a provider needs a recent authenticator check, and registering one
// needs owner or admin rights in the PayRouta organisation it belongs to.
// The organisation id is stripped before the plugin sees the request (the
// plugin would look for its own member table) and saved afterwards.
import { db } from "./db";
import { stepUp } from "./access";
import { PortalError } from "./domain";
import { atomic, audit } from "./service";

const managed = [
  "/sso/register",
  "/sso/update-provider",
  "/sso/delete-provider",
  "/sso/request-domain-verification",
  "/sso/verify-domain",
];

const adminRoles = new Set(["Owner", "Admin"]);

export function ssoManagementPath(url: string) {
  const path = new URL(url).pathname.replace(/^\/api\/auth/, "");
  return managed.includes(path) ? path : undefined;
}

export async function guardSsoManagement(request: Request, path: string) {
  const session = await stepUp(request.headers);
  if (path !== "/sso/register") return { request, after: undefined };

  const body = (await request
    .clone()
    .json()
    .catch(() => null)) as Record<string, unknown> | null;
  const orgId =
    typeof body?.organizationId === "string" ? body.organizationId : "";
  if (!body || !orgId)
    throw new PortalError("Choose the organisation this sign-in is for", 400);
  const membership = await db.membership.findUnique({
    where: { orgId_userId: { orgId, userId: session.user.id } },
  });
  if (
    !membership ||
    !(
      adminRoles.has(membership.role) ||
      adminRoles.has(membership.merchantRole ?? "")
    )
  )
    throw new PortalError(
      "Only organisation owners and admins can set up single sign-on",
      403,
    );

  const { organizationId: _, ...forwarded } = body;
  void _;
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  const rewritten = new Request(request.url, {
    method: "POST",
    headers,
    body: JSON.stringify(forwarded),
  });
  const providerId = String(forwarded.providerId ?? "");
  return {
    request: rewritten,
    after: async (response: Response) => {
      if (!response.ok || !providerId) return;
      await atomic(async (tx) => {
        await tx.ssoProvider.update({
          where: { providerId },
          data: { organizationId: orgId },
        });
        await audit(
          tx,
          orgId,
          session.user.id,
          "sso.provider.registered",
          providerId,
          {
            domain: forwarded.domain,
            protocol: forwarded.samlConfig ? "saml" : "oidc",
          },
        );
      });
    },
  };
}
