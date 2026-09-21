import Link from "next/link";
import { internal } from "@/lib/portal/access";
import { db } from "@/lib/portal/db";
import { rolloutSchema } from "@/lib/merchant/rollout";
import { QualificationForm } from "../merchants/qualification-form";
import { capabilitySchema } from "@/lib/portal/domain";
import "@/components/portal/portal.css";
export const dynamic = "force-dynamic";
export default async function Page() {
  await internal(true);
  const profiles = await db.publishedProfile.findMany({
    where: { current: true },
    orderBy: [{ environment: "asc" }, { id: "asc" }],
    take: 100,
  });
  const due = new Date();
  due.setUTCDate(due.getUTCDate() + 30);
  return (
    <div className="portal p-simple">
      <Link href="/ops">← Operations</Link>
      <h1>Coverage qualification</h1>
      <p>
        Each row is one published directional capability. Real execution remains
        unavailable. Simulator evidence cannot qualify a real provider.
        Re-publication creates a new candidate requiring review.
      </p>
      <p>
        Showing up to 100 current profiles. Pausing blocks new selection and
        dispatch; existing attempts retain reconciliation and notification
        processing.
      </p>
      {!profiles.length && <p>No published profiles.</p>}
      {profiles.map((p) => {
        const policy = rolloutSchema.safeParse(p.rollout);
        const capability = capabilitySchema.safeParse(p.definition);
        const stored = policy.success ? policy.data : null;
        return (
          <section key={p.id}>
            <h2>
              {p.method} · {p.origin} → {p.destination} · {p.environment}
            </h2>
            <dl>
              <dt>Profile / provider</dt>
              <dd>
                {p.id} / {p.orgId}
              </dd>
              <dt>Input / settlement</dt>
              <dd>
                {p.inputAsset} {p.inputNetwork} /{" "}
                {capability.success
                  ? capability.data.fulfillment?.settlementAsset.identifier
                  : "Unverified"}
              </dd>
              <dt>Integration / operation</dt>
              <dd>
                {p.integrationId} / {p.operation}
              </dd>
              <dt>Rollout</dt>
              <dd>
                {stored?.stage ||
                  "Candidate (sandbox fixtures may use legacy qualification)"}
              </dd>
              <dt>Review due</dt>
              <dd>{stored?.nextReviewAt || "Not scheduled"}</dd>
            </dl>
            <details>
              <summary>Review rollout transition</summary>
              <p>
                Advance one stage at a time. Paused profiles restart at
                Candidate for fresh qualification. Proof gates: account,
                adapter-conformance, sandbox, risk, monitoring, runbook, pilot,
                settlement, reconciliation.
              </p>
              <QualificationForm
                label="Apply rollout transition"
                command={{
                  action: "rollout-transition",
                  profileId: p.id,
                  expectedVersion: stored?.version || null,
                }}
                initial={{
                  stage:
                    stored?.stage === "Candidate"
                      ? "Sandbox qualified"
                      : "Paused",
                  merchantAllowlist: stored?.merchantAllowlist || [],
                  maximumMinor: stored?.maximumMinor || "10000",
                  nextReviewAt: due.toISOString(),
                  qualificationKind: stored?.qualificationKind || "simulator",
                  proofs: stored?.proofs || [],
                  sandboxRunIds: stored?.sandboxRunIds || [],
                }}
              />
            </details>
          </section>
        );
      })}
    </div>
  );
}
