"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/components/portal/auth-screen";

type Provider = {
  providerId: string;
  domain: string;
  protocol: "oidc" | "saml";
  verified: boolean;
};

const slug = (domain: string) =>
  domain
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);

// Company single sign-on for a merchant organisation. Owners and admins add
// their identity provider (OIDC or SAML), prove they own the email domain
// with a DNS TXT record, and their team can then sign in with SSO. People
// who sign in this way join the organisation as analysts.
export function SsoSettings({
  orgId,
  origin,
  providers,
}: {
  orgId: string;
  origin: string;
  providers: Provider[];
}) {
  const router = useRouter();
  const [protocol, setProtocol] = useState<"oidc" | "saml">("oidc");
  const [domain, setDomain] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean }>();
  const [records, setRecords] = useState<Record<string, string>>({});
  const providerId = slug(domain) || "your-domain";

  async function act(
    action: () => Promise<{ error?: { message?: string } | null } | undefined>,
    ok: string,
  ) {
    setBusy(true);
    setMessage(undefined);
    try {
      const r = await action();
      if (r?.error)
        throw new Error(r.error.message || "That didn't work. Try again.");
      setMessage({ text: ok });
      router.refresh();
    } catch (e) {
      setMessage({
        text: e instanceof Error ? e.message : "That didn't work.",
        error: true,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2>Single sign-on</h2>

      {providers.length > 0 && (
        <table>
          <thead>
            <tr>
              <th scope="col">Domain</th>
              <th scope="col">Protocol</th>
              <th scope="col">Status</th>
              <th scope="col"></th>
            </tr>
          </thead>
          <tbody>
            {providers.map((p) => {
              const name = `_payrouta-verify-${p.providerId}.${p.domain}`;
              return (
                <tr key={p.providerId}>
                  <td>{p.domain}</td>
                  <td>{p.protocol.toUpperCase()}</td>
                  <td>{p.verified ? "Active" : "Waiting for DNS check"}</td>
                  <td>
                    {!p.verified && (
                      <>
                        <button
                          disabled={busy}
                          onClick={() =>
                            act(async () => {
                              const r =
                                await authClient.sso.requestDomainVerification({
                                  providerId: p.providerId,
                                });
                              if (!r.error && r.data)
                                setRecords((x) => ({
                                  ...x,
                                  [p.providerId]: (
                                    r.data as {
                                      domainVerificationToken: string;
                                    }
                                  ).domainVerificationToken,
                                }));
                              return r;
                            }, "Add the TXT record below at your DNS host, then check it.")
                          }
                        >
                          Show DNS record
                        </button>{" "}
                        <button
                          disabled={busy}
                          onClick={() =>
                            act(
                              () =>
                                authClient.sso.verifyDomain({
                                  providerId: p.providerId,
                                }),
                              "Domain verified. Your team can now sign in with SSO.",
                            )
                          }
                        >
                          Check DNS
                        </button>{" "}
                      </>
                    )}
                    <button
                      disabled={busy}
                      onClick={() =>
                        act(
                          () =>
                            authClient.sso.deleteProvider({
                              providerId: p.providerId,
                            }),
                          "Single sign-on removed.",
                        )
                      }
                    >
                      Remove
                    </button>
                    {records[p.providerId] && (
                      <dl className="sso-record">
                        <dt>TXT record name</dt>
                        <dd>
                          <code>{name}</code>
                        </dd>
                        <dt>Value</dt>
                        <dd>
                          <code>{`_payrouta-verify-${p.providerId}=${records[p.providerId]}`}</code>
                        </dd>
                      </dl>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const get = (k: string) => String(f.get(k) || "").trim();
          const body =
            protocol === "oidc"
              ? {
                  providerId,
                  domain: domain.toLowerCase(),
                  issuer: get("issuer"),
                  organizationId: orgId,
                  oidcConfig: {
                    clientId: get("clientId"),
                    clientSecret: get("clientSecret"),
                  },
                }
              : {
                  providerId,
                  domain: domain.toLowerCase(),
                  issuer: get("entityId"),
                  organizationId: orgId,
                  samlConfig: {
                    entryPoint: get("entryPoint"),
                    cert: get("cert") || undefined,
                    callbackUrl: `${origin}/api/auth/sso/saml2/sp/acs/${providerId}`,
                    idpMetadata: get("metadata")
                      ? { metadata: get("metadata") }
                      : {
                          entityID: get("entityId"),
                          cert: get("cert") || undefined,
                        },
                    spMetadata: {},
                  },
                };
          void act(
            () =>
              authClient.sso.register(
                body as Parameters<typeof authClient.sso.register>[0],
              ),
            "Added. Now show the DNS record and add it to your domain.",
          );
        }}
      >
        <h3>Add an identity provider</h3>
        <label>
          Email domain
          <input
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="yourcompany.com"
            required
          />
        </label>
        <label>
          Protocol
          <select
            value={protocol}
            onChange={(e) => setProtocol(e.target.value as "oidc" | "saml")}
          >
            <option value="oidc">OpenID Connect (OIDC)</option>
            <option value="saml">SAML 2.0</option>
          </select>
        </label>
        {protocol === "oidc" ? (
          <>
            <p>
              In your identity provider, create a web app with this redirect
              URI:{" "}
              <code>{`${origin}/api/auth/sso/callback/${providerId}`}</code>
            </p>
            <label>
              Issuer URL
              <input
                name="issuer"
                type="url"
                placeholder="https://yourcompany.okta.com"
                required
              />
            </label>
            <label>
              Client ID
              <input name="clientId" required />
            </label>
            <label>
              Client secret
              <input
                name="clientSecret"
                type="password"
                autoComplete="off"
                required
              />
            </label>
          </>
        ) : (
          <>
            <p>
              In your identity provider, create a SAML app with ACS URL{" "}
              <code>{`${origin}/api/auth/sso/saml2/sp/acs/${providerId}`}</code>{" "}
              and entity ID{" "}
              <code>{`${origin}/api/auth/sso/saml2/sp/metadata?providerId=${providerId}`}</code>
              .
            </p>
            <label>
              IdP entity ID (issuer URL)
              <input name="entityId" type="url" required />
            </label>
            <label>
              IdP sign-in URL
              <input name="entryPoint" type="url" required />
            </label>
            <label>
              IdP signing certificate (PEM)
              <textarea
                name="cert"
                rows={4}
                placeholder="-----BEGIN CERTIFICATE-----"
              />
            </label>
            <label>
              Or paste the IdP metadata XML
              <textarea name="metadata" rows={4} />
            </label>
          </>
        )}
        <button disabled={busy || !domain}>
          {busy ? "Please wait…" : "Add provider"}
        </button>
      </form>
      {message && <p role="status">{message.text}</p>}
    </section>
  );
}
