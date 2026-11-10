import { VerifyGate } from "@/components/portal/verify-gate";
import Link from "next/link";
import { redirect } from "next/navigation";
import { internal } from "@/lib/portal/access";
import { db } from "@/lib/portal/db";
import { PortalError } from "@/lib/portal/domain";
import { ReviewRequest } from "./controls";
import "@/components/portal/portal.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Provider access requests", robots: { index: false, follow: false } };

const when = (d: Date) => d.toISOString().replace("T", " ").slice(0, 16) + " UTC";

// Payment providers can't sign themselves up. Their requests from /partners
// land here for an operations admin to approve or decline.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  try {
    await internal(true);
  } catch (e) {
    if (e instanceof PortalError && e.status === 401) redirect("/provider/sign-in?next=/ops/provider-requests");
    if (e instanceof PortalError)
      return <VerifyGate code={e.message} />;
    throw e;
  }
  const state = (await searchParams).state === "reviewed" ? "reviewed" : "pending";
  const requests = await db.providerAccessRequest.findMany({
    where: state === "pending" ? { state: "Pending" } : { state: { not: "Pending" } },
    orderBy: { createdAt: state === "pending" ? "asc" : "desc" },
    take: 100,
  });
  const pending = state === "pending" ? requests.length : await db.providerAccessRequest.count({ where: { state: "Pending" } });
  return (
    <div className="portal p-simple">
      <Link href="/ops/applications">← Operations</Link>
      <h1>Provider access requests</h1>
      <nav className="p-toolbar" style={{ justifyContent: "flex-start" }} aria-label="Request filters">
        <Link className={`p-button ${state === "pending" ? "" : "secondary"}`} href="/ops/provider-requests">
          Pending ({pending})
        </Link>
        <Link className={`p-button ${state === "reviewed" ? "" : "secondary"}`} href="/ops/provider-requests?state=reviewed">
          Reviewed
        </Link>
      </nav>
      {!requests.length && <p>{state === "pending" ? "No requests waiting for review." : "No reviewed requests yet."}</p>}
      {requests.map((r) => (
        <section className="p-panel" key={r.id}>
          <div className="p-panel-heading">
            <h2>{r.company}</h2>
            <span className={`p-badge ${r.state === "Approved" ? "good" : r.state === "Declined" ? "bad" : ""}`}>{r.state}</span>
          </div>
          <dl className="p-definition">
            {(
              [
                ["Contact", <span key="contact">{r.name} · <a href={`mailto:${r.email}`}>{r.email}</a></span>],
                ["Website", <a key="website" href={r.website} rel="noreferrer noopener" target="_blank">{r.website}</a>],
                ["Registered in", r.country],
                ["Service", r.providerType],
                ["Methods", r.methods],
                ["Processes in", r.markets],
                ["Notes", r.message ? <span key="notes" style={{ whiteSpace: "pre-wrap" }}>{r.message}</span> : null],
                ["Received", when(r.createdAt)],
                ["Reviewed", r.reviewedAt ? `${when(r.reviewedAt)}${r.reviewNote ? ` · ${r.reviewNote}` : ""}` : null],
                ["Organization", r.orgId ? <code key="org">{r.orgId}</code> : null],
              ] as [string, React.ReactNode][]
            )
              .filter(([, value]) => value)
              .map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
          </dl>
          {r.state === "Pending" && <ReviewRequest requestId={r.id} company={r.company} />}
        </section>
      ))}
    </div>
  );
}
