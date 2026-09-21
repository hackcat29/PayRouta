import Link from "next/link";
import { internal } from "@/lib/portal/access";
import { db } from "@/lib/portal/db";
import { riskPolicySchema } from "@/lib/merchant/policy";
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
  const intents = await db.paymentIntent.findMany({
    where: { id: { in: decisions.map((d) => d.intentId) } },
    select: { id: true, orgId: true, reference: true },
  });
  return (
    <div className="portal p-simple">
      <Link href="/ops">← Operations</Link>
      <h1>Merchant readiness and review</h1>
      <p>
        Stopping new execution does not stop provider status checks, settlement
        tracking, or merchant notifications.
      </p>
      {merchants.map((m) => {
        const policy = riskPolicySchema.parse(m.riskPolicy);
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
      <p>
        Live activation remains unavailable until provider integration and
        account qualification are complete. Approval of an amount review cannot
        override a pause, a limit, expired evidence, or live qualification.
      </p>
    </div>
  );
}
