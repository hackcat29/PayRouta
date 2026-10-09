import Link from "next/link";
import { internal } from "@/lib/portal/access";
import { db } from "@/lib/portal/db";
import { partnerManifests } from "@/lib/partners/registry";
import { ConnectionForm, QualifyForm, ScreeningReviewForm } from "./controls";
import "@/components/portal/portal.css";
export const dynamic = "force-dynamic";

// Operations view of PayRouta's partner programmes: platform connections,
// application pipeline, screening holds and unmatched provider events.
export default async function Page() {
  await internal(true);
  const [connections, grouped, held, unmatched, failed] = await Promise.all([
    db.partnerConnection.findMany({ orderBy: [{ partnerId: "asc" }, { environment: "asc" }] }),
    db.partnerApplication.groupBy({
      by: ["partnerId", "environment", "state"],
      _count: { _all: true },
    }),
    db.partnerApplication.findMany({
      where: { state: "Queued", reason: "PAYROUTA_SCREENING_REVIEW" },
      orderBy: { updatedAt: "asc" },
      take: 50,
    }),
    db.partnerEvent.findMany({
      where: { state: "Unmatched" },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    db.partnerApplication.findMany({
      where: { state: "Failed" },
      orderBy: { updatedAt: "desc" },
      take: 20,
    }),
  ]);
  const screenings = await db.merchantScreening.findMany({
    where: {
      OR: held.map((h) => ({ orgId: h.orgId, profileVersion: h.profileVersion })),
    },
    orderBy: { createdAt: "desc" },
  });
  const manifests = partnerManifests();
  return (
    <div className="portal p-simple">
      <Link href="/ops/applications">← Operations</Link>
      <h1>Partner programmes</h1>
      <p>
        Every partner module is merchant-owned by construction; the registry
        refuses any programme that would make PayRouta liable for merchant
        funds. See docs/PARTNER-PROGRAM.md.
      </p>

      <section>
        <h2>Connections</h2>
        <div className="p-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Partner</th>
                <th>Environment</th>
                <th>Enabled</th>
                <th>Configured keys</th>
                <th>Webhook URL path</th>
                <th>Sandbox qualified</th>
              </tr>
            </thead>
            <tbody>
              {connections.map((c) => (
                <tr key={c.id}>
                  <td>{c.partnerId}</td>
                  <td>{c.environment}</td>
                  <td>{c.enabled ? "Yes" : "No"}</td>
                  <td>{Object.keys(c.config as object).sort().join(", ") || "—"}</td>
                  <td>
                    <code>/api/partners/{c.partnerId}/events/{c.environment}</code>
                  </td>
                  <td>
                    {c.environment === "sandbox"
                      ? c.qualifiedAt
                        ? c.qualifiedAt.toISOString().slice(0, 10)
                        : "No"
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!connections.length && <p>No connections configured.</p>}
        <ConnectionForm
          partners={manifests.map((m) => ({
            id: m.id,
            name: m.name,
            requiresPartnerApproval: m.requiresPartnerApproval,
          }))}
        />
        <QualifyForm
          partners={manifests
            .filter((m) => !m.sandboxOnly)
            .map((m) => ({ id: m.id, name: m.name }))}
        />
      </section>

      <section>
        <h2>Applications</h2>
        <div className="p-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Partner</th>
                <th>Environment</th>
                <th>State</th>
                <th>Count</th>
              </tr>
            </thead>
            <tbody>
              {grouped.map((g) => (
                <tr key={`${g.partnerId}:${g.environment}:${g.state}`}>
                  <td>{g.partnerId}</td>
                  <td>{g.environment}</td>
                  <td>{g.state}</td>
                  <td>{g._count._all}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2>Screening held for review</h2>
        {!held.length && <p>Nothing held.</p>}
        {held.map((h) => {
          const latest = screenings.find(
            (s) => s.orgId === h.orgId && s.profileVersion === h.profileVersion,
          );
          return (
            <article key={h.id}>
              <h3>
                {h.orgId} · profile v{h.profileVersion} · {h.partnerId}
              </h3>
              {latest && (
                <p>
                  {latest.provider}: {latest.verdict} ·{" "}
                  {(latest.results as { subject: string; verdict: string }[])
                    .filter((r) => r.verdict !== "clear")
                    .map((r) => r.subject)
                    .join(", ")}
                </p>
              )}
              <ScreeningReviewForm orgId={h.orgId} profileVersion={h.profileVersion} />
            </article>
          );
        })}
      </section>

      <section>
        <h2>Failed applications</h2>
        {!failed.length && <p>None.</p>}
        <ul>
          {failed.map((f) => (
            <li key={f.id}>
              {f.orgId} · {f.partnerId} · {f.environment} · {f.reason}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Unmatched provider events</h2>
        {!unmatched.length && <p>None.</p>}
        <ul>
          {unmatched.map((e) => (
            <li key={e.id}>
              {e.partnerId} · {e.environment} · {e.type} · {e.createdAt.toISOString()}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
