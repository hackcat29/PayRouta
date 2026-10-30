import { stablecoinDepositConfig as depositConfigSchema } from "@/lib/blockchain/deposit-config";
import { onchainMethod } from "@/lib/blockchain/crypto-assets";
import Link from "next/link";
import { internal } from "@/lib/portal/access";
import { db } from "@/lib/portal/db";
import { riskPolicySchema } from "@/lib/merchant/policy";
import { QualificationForm } from "./qualification-form";
import { storedLiveScope } from "@/lib/merchant/live-scope";
import { OperatorAction } from "./controls";
import "@/components/portal/portal.css";
export const dynamic = "force-dynamic";
export default async function Page() {
  await internal(true);
  const merchants = await db.merchantConfig.findMany({
    take: 100,
    orderBy: { orgId: "asc" },
  });
  const decisions = await db.merchantRiskDecision.findMany({
    where: {
      decision: { in: ["Deny", "Hold for review"] },
      expiresAt: { gt: new Date() },
    },
    take: 100,
    orderBy: { createdAt: "desc" },
  });
  const depositAccounts = (
    await db.integration.findMany({
      where: {
        orgId: { in: merchants.map((m) => m.orgId) },
        environment: "production",
      },
      orderBy: { version: "desc" },
    })
  ).flatMap((i) => {
    const c = depositConfigSchema.safeParse(i.config);
    return c.success
      ? [
          {
            method: onchainMethod(c.data.network, c.data.identifier),
            orgId: i.orgId,
            integrationId: i.id,
            accountReference: c.data.accountId || "",
            asset: `blockchain:${c.data.identifier}:${c.data.network}`,
          },
        ]
      : [];
  });
  const intents = await db.paymentIntent.findMany({
    where: { id: { in: decisions.map((d) => d.intentId) } },
    select: { id: true, orgId: true, reference: true },
  });
  return (
    <div className="portal p-simple">
      <Link href="/ops">← Operations</Link>
      <h1>Merchant readiness and review</h1>
      <Link href="/ops/coverage">Coverage qualification</Link>
      {merchants.map((m) => {
        const policy = riskPolicySchema.parse(m.riskPolicy);
        const scope = storedLiveScope.safeParse(m.liveScope);
        const nextReview = new Date();
        nextReview.setUTCDate(nextReview.getUTCDate() + 30);
        return (
          <section key={m.orgId}>
            <h2>
              {m.orgId} · {m.environment}
            </h2>
            <p>
              Application: {m.applicationState} · version {m.applicationVersion}
            </p>
            <p>
              {policy.paused
                ? "New execution paused"
                : "New execution subject to policy"}
            </p>
            <OperatorAction
              label={
                policy.paused ? "Resume new execution" : "Pause new execution"
              }
              command={{
                action: "policy",
                orgId: m.orgId,
                policy: { ...policy, paused: !policy.paused },
              }}
            />
            {m.applicationState === "Submitted" && (
              <OperatorAction
                label="Begin application review"
                command={{
                  action: "review-application",
                  orgId: m.orgId,
                  version: m.applicationVersion,
                  state: "Under review",
                }}
              />
            )}
            {m.applicationState === "Under review" && (
              <OperatorAction
                label="Request application changes"
                command={{
                  action: "review-application",
                  orgId: m.orgId,
                  version: m.applicationVersion,
                  state: "Changes requested",
                }}
              />
            )}
            <h3>Specified live scope</h3>
            <p>
              {scope.success
                ? `${scope.data.status} · review due ${scope.data.input.nextReviewAt}`
                : "No live scope proposed"}
            </p>
            {["Under review", "Approved"].includes(m.applicationState) && (
              <details>
                <summary>Propose or revise live scope</summary>
                <QualificationForm
                  label="Save proposed scope"
                  command={{
                    action: "propose-live-scope",
                    orgId: m.orgId,
                    applicationVersion: m.applicationVersion,
                    expectedScopeVersion: scope.success
                      ? scope.data.version
                      : null,
                  }}
                  initial={
                    scope.success
                      ? scope.data.input
                      : {
                          environment: "production",
                          merchantCountry: m.country,
                          payerCountries: [m.country],
                          methods: [
                            ...new Set(
                              depositAccounts
                                .filter((a) => a.orgId === m.orgId)
                                .map((a) => a.method),
                            ),
                          ],
                          asset:
                            depositAccounts.find((a) => a.orgId === m.orgId)
                              ?.asset ??
                            "Configure a production on-chain receive pool first",
                          settlementAsset:
                            depositAccounts.find((a) => a.orgId === m.orgId)
                              ?.asset ??
                            "Configure a production on-chain receive pool first",
                          maximumMinor: "10000",
                          dailyMaximumMinor: "100000",
                          additionalAssets: [
                            ...new Set(
                              depositAccounts
                                .filter((a) => a.orgId === m.orgId)
                                .map((a) => a.asset),
                            ),
                          ]
                            .slice(1)
                            .map((asset) => ({
                              asset,
                              maximumMinor: "10000",
                              dailyMaximumMinor: "100000",
                            })),
                          profileIds: [],
                          accounts: depositAccounts
                            .filter((a) => a.orgId === m.orgId)
                            .slice(0, 200)
                            .map((a) => ({
                              integrationId: a.integrationId,
                              accountReference: a.accountReference,
                              permissionEvidenceId: "",
                              settlementDestinationEvidenceId: "",
                              refundResponsibilityEvidenceId: "",
                            })),
                          evidenceIds: [],
                          nextReviewAt: nextReview.toISOString(),
                        }
                  }
                />
              </details>
            )}
            {scope.success && scope.data.status === "Proposed" && (
              <OperatorAction
                label="Approve specified scope"
                command={{
                  action: "approve-live-scope",
                  orgId: m.orgId,
                  version: scope.data.version,
                }}
              />
            )}
            {scope.success && scope.data.status !== "Revoked" && (
              <OperatorAction
                label="Revoke specified scope"
                command={{
                  action: "revoke-live-scope",
                  orgId: m.orgId,
                  version: scope.data.version,
                }}
              />
            )}
            <details>
              <summary>Submitted business information</summary>
              <dl>
                {Object.entries(m.application as Record<string, unknown>).map(
                  ([k, v]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd>{Array.isArray(v) ? v.join(", ") : String(v)}</dd>
                    </div>
                  ),
                )}
              </dl>
            </details>
          </section>
        );
      })}
      <h2>Current policy decisions</h2>
      {!decisions.length && <p>No current review holds or denials.</p>}
      {decisions.map((d) => {
        const i = intents.find((i) => i.id === d.intentId);
        return (
          <section key={d.id}>
            <h3>
              {i?.reference || d.intentId} · {d.decision}
            </h3>
            <p>
              {(d.reasons as string[]).join(", ")} · expires{" "}
              {d.expiresAt.toISOString()}
            </p>
            {d.decision === "Hold for review" && i && (
              <OperatorAction
                label="Approve amount review for 15 minutes"
                command={{
                  action: "approve-risk",
                  orgId: i.orgId,
                  intentId: i.id,
                }}
              />
            )}
          </section>
        );
      })}
    </div>
  );
}
