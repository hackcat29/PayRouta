"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import type { WorkspaceData, transactionDetail } from "@/lib/portal/queries";
import { can, allowedRoute, checklist, Draft, scenarios } from "@/lib/portal/domain";
import { BrandLogo } from "../brand-logo";
import { Action, DateText, Field, JsonView, Modal, Table } from "./ui";
import { Badge, Empty, Kpi, Panel } from "./provider-ui";
import { CapabilityForm, CompanyForm, CoverageForm, Execute, IntegrationForm, SettlementForm } from "./forms";
import { AccountSecurity } from "./account-security";
import { Compliance, Credentials, Team } from "./workspace-tools";
import { ProviderShell } from "./provider-shell";
import { SignOutButton } from "./sign-out";
import { errorText, offline } from "@/lib/error-copy";
import { docsUrl } from "@/lib/site-config";

const titles: Record<string, string> = {
  overview: "Home",
  onboarding: "Application",
  "onboarding/company": "Application",
  "onboarding/coverage": "Application",
  "onboarding/capabilities": "Application",
  "onboarding/settlement": "Application",
  "onboarding/compliance": "Application",
  "onboarding/integration": "Application",
  "onboarding/review": "Application",
  application: "Application",
  capabilities: "Payment methods",
  integration: "Connection",
  "integration/credentials": "Connection",
  "integration/events": "Connection",
  sandbox: "Connection",
  availability: "Connection",
  transactions: "Transactions",
  settlements: "Settlements",
  performance: "Reliability",
  team: "Settings",
  settings: "Settings",
  "audit-log": "Settings",
};

// Pages for someone signed in without a provider organization: accepting an
// invitation, account security, or a pointer to the access request form.
function Solo({ children }: { children: React.ReactNode }) {
  return (
    <div className="portal ms-solo">
      <div>
        <BrandLogo />
        {children}
      </div>
    </div>
  );
}

export function Workspace({
  data,
  route,
  environment,
  query,
  page,
  detail,
  invitation,
  merchantLink = false,
}: {
  data: WorkspaceData;
  route: string;
  environment: string;
  query: string;
  page: number;
  detail?: Awaited<ReturnType<typeof transactionDetail>>;
  invitation?: string;
  merchantLink?: boolean;
}) {
  const router = useRouter();
  const [notice, setNotice] = useState("");
  const [oneTime, setOneTime] = useState("");
  const [submitKey] = useState(() => crypto.randomUUID());
  const execute: Execute = async (payload) => {
    setNotice("");
    try {
      const res = await fetch("/api/portal/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId: data.org?.id, ...payload }),
      });
      const result = await res.json().catch(() => null);
      if (!res.ok) throw new Error(errorText(result, res.status));
      setNotice(result.message || "Saved");
      if (result.oneTimeSecret) setOneTime(result.oneTimeSecret);
      if (result.orgId) router.push(`/provider/overview?org=${result.orgId}`);
      router.refresh();
      return result;
    } catch (e) {
      setNotice(e instanceof TypeError ? offline : e instanceof Error ? e.message : offline);
      return null;
    }
  };
  const status = notice && (
    <div className="pv-notice" role="status">
      <span>{notice}</span>
      <button type="button" aria-label="Dismiss message" onClick={() => setNotice("")}>
        ×
      </button>
    </div>
  );
  const security = <AccountSecurity twoFactorEnabled={!!data.me.twoFactorEnabled} />;

  if (!data.org) {
    const foot = (
      <p className="ms-solo-foot">
        Signed in as {data.me.email} · <SignOutButton to="/provider/sign-in" />
      </p>
    );
    if (invitation)
      return (
        <Solo>
          <section>
            <h1>Join your provider workspace</h1>
            <p>The invitation only works for the email address it was sent to.</p>
            {status}
            <div className="pv-primary">
              <Action label="Accept invitation" run={() => execute({ action: "accept-invitation", token: invitation })} />
            </div>
          </section>
          {foot}
        </Solo>
      );
    if (route === "settings")
      return (
        <div className="portal ms-solo pv-account">
          <div>
            <BrandLogo />
            <div className="ms-body">
              <h1 className="pv-solo-title">Account security</h1>
              {status}
              {security}
              {data.internalRole && (
                <Panel title="Internal access">
                  <p>{data.internalRole}</p>
                  <Link className="ms-btn primary" href="/ops/applications">
                    Open operations console
                  </Link>
                </Panel>
              )}
            </div>
            {foot}
          </div>
        </div>
      );
    return (
      <Solo>
        <section>
          <h1>No provider access yet</h1>
          <p className="pv-solo-actions">
            <Link className="ms-btn primary" href="/partners#request">
              Request provider access
            </Link>
            {merchantLink && (
              <Link className="ms-btn" href="/merchant/overview">
                Go to your merchant dashboard
              </Link>
            )}
            {data.internalRole && (
              <Link className="ms-btn" href="/ops/applications">
                Operations console
              </Link>
            )}
          </p>
        </section>
        {foot}
      </Solo>
    );
  }

  const org = data.org;
  const href = (path: string) => `/provider/${path}?${new URLSearchParams({ org: org.id, env: environment })}`;
  const app = data.application;
  const draft = (app?.draft || {}) as Draft;
  const version = app?.version || 1;
  const role = data.role || "Analyst";
  const permission = (p: Parameters<typeof can>[1]) => can(role, p);
  const evidenceComplete =
    !data.requirements?.length || data.requirements.every((r) => data.evidence?.some((e) => e.requirementId === r.id));
  const steps = checklist(draft, evidenceComplete ? 1 : 0);
  const completed = steps.filter((s) => s.complete).length;
  const nextStep = steps.find((s) => !s.complete);
  const active = data.activations?.[0];
  const published = data.activations?.find((a) => a.acknowledgedAt);
  const publishedDraft = (
    data.application?.submissions.find((s) => s.id === published?.submissionId)?.snapshot as { draft: Draft } | undefined
  )?.draft;
  const operating =
    active?.state === "Pending"
      ? active.action === "withdraw"
        ? "Suspension pending"
        : "Publication pending"
      : active?.state || "Not enabled";
  const sandbox = environment === "sandbox";
  const live = active?.state === "Active";
  const limited = !["Owner", "Admin"].includes(role);
  const actions =
    route === "overview" && !live && !limited ? (
      <Link
        className="ms-btn primary"
        href={href(completed === steps.length ? "onboarding/review" : `onboarding/${nextStep?.id || "company"}`)}
      >
        {completed === steps.length ? "Review and submit" : "Continue application"} <ArrowRight size={15} aria-hidden />
      </Link>
    ) : route === "onboarding" && permission("submit") ? (
      <Link className="ms-btn primary" href={href("onboarding/review")}>
        Review and submit
      </Link>
    ) : undefined;
  const backLink =
    route.startsWith("transactions/") && detail ? { href: href("transactions"), label: "Transactions" } : undefined;

  function guide(compact = false) {
    return (
      <>
        <div className="ms-progress" aria-hidden>
          <span style={{ width: `${(completed / steps.length) * 100}%` }} />
        </div>
        <ul className="ms-guide">
          {steps
            .filter((s) => allowedRoute(role, `onboarding/${s.id}`))
            .map((s) => (
              <li key={s.id} className={s.complete ? "done" : undefined}>
                <span className="ms-guide-mark" aria-hidden>
                  ✓
                </span>
                <span>
                  {s.label}
                  <span className="sr-only">{s.complete ? " (done)" : " (to do)"}</span>
                </span>
                <Link href={href(`onboarding/${s.id}`)}>{s.complete ? (compact ? "Edit" : "Review") : "Start →"}</Link>
              </li>
            ))}
        </ul>
      </>
    );
  }

  function capabilities() {
    const caps = (draft.capabilities || []).filter((c) => c.environment === environment);
    return (
      <>
        <Panel
          flush
          title="Proposed payment methods"
          action={
            permission("configure") && (
              <Modal label="Add payment method" title="Define a payment capability">
                <CapabilityForm integrations={data.integrations} version={version} execute={execute} environment={environment} />
              </Modal>
            )
          }
        >
          {caps.length ? (
            <Table headings={["Capability", "Direction", "Operation", "Limits", "Version", ""]}>
              {caps.map((c) => (
                <tr key={c.capabilityId}>
                  <td>
                    <strong>{c.rail}</strong>
                    <small>{c.capabilityId}</small>
                  </td>
                  <td>
                    {c.input.identifier} → {c.output?.identifier || c.input.identifier}
                    <small>
                      {c.origin} → {c.destination}
                    </small>
                  </td>
                  <td>
                    {c.operation}
                    <small>{c.environment}</small>
                  </td>
                  <td>
                    {c.minimum}–{c.maximum}
                    <small>{c.limitAsset}</small>
                  </td>
                  <td>
                    v{c.version}
                    <small>Draft</small>
                  </td>
                  <td>
                    {permission("configure") && (
                      <Modal label="Edit" title="Edit proposed capability">
                        <CapabilityForm
                          integrations={data.integrations}
                          value={c}
                          version={version}
                          environment={environment}
                          execute={execute}
                        />
                        <Action
                          danger
                          label="Remove from draft"
                          run={() =>
                            execute({ action: "remove-capability", environment, version, capabilityId: c.capabilityId })
                          }
                        />
                      </Modal>
                    )}
                  </td>
                </tr>
              ))}
            </Table>
          ) : (
            <Empty title="No payment methods yet">Add a method, direction, operation and exact limits.</Empty>
          )}
        </Panel>
        <Panel title="Published configuration">
          {published?.action === "publish" ? (
            <>
              <p>
                Registry acknowledged submission <code>{published.submissionId}</code>, sequence {published.sequence}.
                {sandbox ? " Local simulator publication only." : ""}
              </p>
              <JsonView
                value={publishedDraft?.capabilities?.filter((c) => c.environment === environment)}
                label="Published capability snapshot"
              />
            </>
          ) : (
            <Empty title="Nothing published yet">Methods are published after approval and registry acknowledgement.</Empty>
          )}
        </Panel>
        {caps.length > 0 && <JsonView value={caps} label="Draft as JSON" />}
      </>
    );
  }

  function applicationView() {
    return (
      <>
        <div className="ms-kpis pv-kpis-2">
          <Kpi
            label="Application"
            value={<Badge>{app?.state}</Badge>}
            note={
              <>
                Draft v{version} · <DateText value={app?.updatedAt} />
              </>
            }
          />
          <Kpi
            label="Operating status"
            value={<Badge>{operating}</Badge>}
            note={sandbox ? "Local sandbox registry" : "Production registry"}
          />
        </div>
        {data.application?.submissions.map((s) => (
          <Panel key={s.id} title={`Submission v${s.version}`} description={<DateText value={s.createdAt} />}>
            <dl className="ms-props">
              {["legal", "technical"].map((kind) => (
                <div key={kind} style={{ display: "contents" }}>
                  <dt>{kind === "legal" ? "Legal and compliance" : "Technical review"}</dt>
                  <dd>
                    <Badge>{s.reviews.filter((r) => r.kind === kind).at(-1)?.decision || "Pending"}</Badge>
                  </dd>
                </div>
              ))}
            </dl>
            {s.reviews
              .filter((r) => r.kind === "application")
              .map((r) => (
                <p key={r.id}>
                  <Badge>{r.decision}</Badge> {r.reason}
                </p>
              ))}
            {s.changes.map((c) => (
              <section key={c.id}>
                <h3>Change requested: {c.section}</h3>
                <p>{c.message}</p>
                {c.response ? (
                  <blockquote className="pv-quote">{c.response}</blockquote>
                ) : permission("compliance") ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void execute({
                        action: "respond",
                        changeId: c.id,
                        response: new FormData(e.currentTarget).get("response"),
                      });
                    }}
                  >
                    <Field label="Your response">
                      <textarea name="response" required />
                    </Field>
                    <div>
                      <button className="primary">Send response</button>
                    </div>
                  </form>
                ) : (
                  <p>Waiting for a compliance response.</p>
                )}
              </section>
            ))}
            <JsonView value={s.snapshot} label="Submitted snapshot" />
          </Panel>
        ))}
        {!data.application?.submissions.length && (
          <Panel>
            <Empty title="Not submitted yet">
              <Link href={href("onboarding")}>Complete the checklist</Link>, then submit for review.
            </Empty>
          </Panel>
        )}
        <Panel title={sandbox ? "Before sandbox publication" : "Before production activation"}>
          {data.gates?.length ? (
            <ul className="ms-guide">
              {data.gates.map((g) => (
                <li key={g}>
                  <span className="ms-guide-mark" aria-hidden>
                    ✓
                  </span>
                  <span>{g}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p>Ready for an internal activation decision in this environment.</p>
          )}
        </Panel>
      </>
    );
  }

  function content(): React.ReactNode {
    if (route === "settings")
      return (
        <>
          <Panel title="Organization">
            <dl className="ms-props">
              <dt>Name</dt>
              <dd>{org.name}</dd>
              <dt>Organization ID</dt>
              <dd>
                <code>{org.id}</code>
              </dd>
              <dt>Your role</dt>
              <dd>{role}</dd>
            </dl>
          </Panel>
          {security}
          {data.internalRole && (
            <Panel title="Internal access">
              <p>{data.internalRole}</p>
              <Link className="ms-btn" href="/ops/applications">
                Open operations console
              </Link>
            </Panel>
          )}
        </>
      );
    if (route === "overview") {
      const exceptions = data.transactions?.filter((t) => t.executionState !== "Confirmed") || [];
      return (
        <>
          <div className="ms-kpis">
            <Kpi label="Application" value={<Badge>{app?.state}</Badge>} note={`Draft v${version}`} />
            <Kpi
              label="Operating status"
              value={<Badge>{operating}</Badge>}
              note={live ? `Registry sequence ${active!.sequence}` : sandbox ? "Sandbox" : "Production"}
            />
            <Kpi label="Transactions" value={data.total || 0} note={`${environment} records`} />
            {live ? (
              <Kpi
                label="Pending settlements"
                value={data.settlements?.filter((s) => s.state === "Pending").length || 0}
                note={<Link href={href("settlements")}>View settlements</Link>}
              />
            ) : (
              <Kpi label="Application progress" value={`${completed} / ${steps.length}`} note="sections ready" />
            )}
          </div>
          {limited && (
            <Panel title={`Welcome, ${data.me.name}`} description={`${org.name} · ${role}`}>
              <p>
                {role === "Developer"
                  ? "Configure the integration and test how it behaves in the sandbox."
                  : role === "Compliance"
                    ? "Prepare company documents and respond to review requests."
                    : "Monitor transactions, settlements and reliability for this organization."}
              </p>
              <p>
                <Link
                  className="ms-btn primary"
                  href={href(role === "Developer" ? "integration" : role === "Compliance" ? "onboarding/company" : "transactions")}
                >
                  Open your workspace <ArrowRight size={15} aria-hidden />
                </Link>
              </p>
            </Panel>
          )}
          {live ? (
            <Panel
              flush
              title="Needs attention"
              action={<Link href={href("transactions")}>All transactions →</Link>}
            >
              {exceptions.length ? (
                <Table headings={["Reference", "Method", "Execution", "Created"]}>
                  {exceptions.slice(0, 5).map((t) => (
                    <tr key={t.id}>
                      <td>
                        <Link className="ms-rowlink" href={href(`transactions/${t.id}`)}>
                          {t.reference}
                        </Link>
                      </td>
                      <td>{t.method}</td>
                      <td>
                        <Badge>{t.executionState}</Badge>
                      </td>
                      <td className="ms-dim">
                        <DateText value={t.createdAt} />
                      </td>
                    </tr>
                  ))}
                </Table>
              ) : (
                <Empty title="All clear">No unconfirmed executions in this environment.</Empty>
              )}
            </Panel>
          ) : (
            !limited && (
              <div className="ms-grid-2">
                <Panel title={completed === steps.length ? "Ready to submit" : "Application checklist"}>
                  {guide()}
                </Panel>
                <div className="pv-stack">
                  <Panel title="Updates">
                    {data.notifications?.length ? (
                      <ul className="ms-list">
                        {data.notifications.map((n) => (
                          <li key={n.id}>
                            <Link href={`${n.href}?${new URLSearchParams({ org: org.id, env: environment })}`}>{n.message}</Link>
                            <small className="ms-dim">
                              <DateText value={n.createdAt} />
                            </small>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p>Review decisions and change requests will appear here.</p>
                    )}
                  </Panel>
                  {(draft.company as { providerType?: string } | undefined)?.providerType === "Lender / consumer-credit provider" && (
                    <Panel title="Lending through PayRouta">
                      <p>
                        <a href={docsUrl("credit")}>Read the credit partner contract →</a>
                      </p>
                    </Panel>
                  )}
                  <Panel title="Test before you submit">
                    <p>
                      <Link href={href("sandbox")}>Open sandbox tests →</Link>
                    </p>
                  </Panel>
                </div>
              </div>
            )
          )}
        </>
      );
    }
    if (route === "onboarding")
      return (
        <Panel
          title={completed === steps.length ? "Everything's ready" : "Complete your application"}
          description={
            <>
              Draft v{version} · Last saved <DateText value={app?.updatedAt} />
            </>
          }
        >
          {guide(true)}
        </Panel>
      );
    if (route === "onboarding/company")
      return <CompanyForm draft={draft} version={version} execute={execute} disabled={!permission("company")} />;
    if (route === "onboarding/coverage")
      return <CoverageForm draft={draft} version={version} execute={execute} disabled={!permission("configure")} />;
    if (route === "capabilities" || route === "onboarding/capabilities") return capabilities();
    if (route === "onboarding/settlement")
      return <SettlementForm draft={draft} version={version} execute={execute} disabled={!permission("configure")} />;
    if (route === "onboarding/compliance") return <Compliance data={data} execute={execute} setNotice={setNotice} />;
    if (route === "integration" || route === "onboarding/integration")
      return (
        <>
          <IntegrationForm
            value={data.integrations?.[0]?.config as Draft["integration"]}
            version={version}
            environment={environment}
            execute={execute}
            disabled={!permission("integration")}
          />
          <Panel
            title="Connection check"
          >
            <div>
              <Action
                label="Check provider endpoint"
                disabled={!permission("integration")}
                run={() => execute({ action: "check-endpoint", environment, key: crypto.randomUUID() })}
              />
            </div>
          </Panel>
          <Panel flush title="Saved versions">
            {data.integrations?.length ? (
              <Table headings={["Version", "Environment", "Created"]}>
                {data.integrations.map((i) => (
                  <tr key={i.id}>
                    <td>v{i.version}</td>
                    <td>{i.environment}</td>
                    <td className="ms-dim">
                      <DateText value={i.createdAt} />
                    </td>
                  </tr>
                ))}
              </Table>
            ) : (
              <Empty title="No saved connection yet" />
            )}
          </Panel>
        </>
      );
    if (route === "onboarding/review")
      return (
        <>
          <Panel title="Checklist">
            {guide(true)}
          </Panel>
          <Panel title={app?.state === "Changes requested" ? "Resubmit your application" : "Submit your application"}>
            <p>Documents may still be waiting for scanning or review. Submitting isn&apos;t approval or activation.</p>
            <div>
              <Action
                label={app?.state === "Changes requested" ? "Resubmit application" : "Submit application"}
                disabled={
                  !permission("submit") ||
                  completed < steps.length ||
                  ["Submitted", "Resubmitted", "Under review"].includes(app?.state || "")
                }
                run={() => execute({ action: "submit", version, key: submitKey })}
              />
            </div>
          </Panel>
          <JsonView value={draft} label="Full draft as JSON" />
        </>
      );
    if (route === "application") return applicationView();
    if (route === "integration/credentials") return <Credentials data={data} execute={execute} environment={environment} />;
    if (route === "sandbox")
      return (
        <>
          <Panel title="Run a scenario">
            <form
              className="ms-inline"
              onSubmit={(e) => {
                e.preventDefault();
                void execute({
                  action: "sandbox-run",
                  scenario: new FormData(e.currentTarget).get("scenario"),
                  key: crypto.randomUUID(),
                });
              }}
            >
              <Field label="Scenario">
                <select name="scenario">
                  {scenarios.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </Field>
              <button className="primary" disabled={!permission("integration") || !sandbox}>
                Run scenario
              </button>
            </form>
            {!sandbox && <p>Switch on Sandbox to run fictional tests.</p>}
          </Panel>
          <Panel title="Test history">
            {data.runs?.length ? (
              <div className="pv-runs">
                {data.runs.map((r) => (
                  <details key={r.id}>
                    <summary>
                      <span>
                        {r.scenario}
                        <small className="ms-dim">
                          <DateText value={r.createdAt} /> · Integration v{r.integrationVersion} · {r.adapter}
                        </small>
                      </span>
                      <Badge>{r.outcome}</Badge>
                    </summary>
                    <ol className="ms-timeline">
                      {(r.steps as { at: string; action: string; result: string }[]).map((s, i) => (
                        <li key={i}>
                          <strong>{s.action}</strong>
                          <p>{s.result}</p>
                          <small>
                            <DateText value={s.at} />
                          </small>
                        </li>
                      ))}
                    </ol>
                    <Action
                      label="Run again"
                      disabled={!permission("integration")}
                      run={() => execute({ action: "sandbox-run", scenario: r.scenario, key: crypto.randomUUID() })}
                    />
                  </details>
                ))}
              </div>
            ) : (
              <Empty title="No test runs yet">Save a sandbox connection and choose a scenario.</Empty>
            )}
          </Panel>
          <Panel flush title="Background tasks">
            {data.jobs?.some((j) => j.kind !== "registry") ? (
              <Table headings={["Task", "State", "Attempts", "Result"]}>
                {data.jobs
                  .filter((j) => j.kind !== "registry")
                  .map((j) => (
                    <tr key={j.id}>
                      <td>{j.kind}</td>
                      <td>
                        <Badge>{j.state}</Badge>
                      </td>
                      <td>{j.attempts}</td>
                      <td>
                        {j.error || "—"}
                        {j.state === "Failed" && permission("integration") && (
                          <Action label="Retry" run={() => execute({ action: "retry-job", jobId: j.id })} />
                        )}
                      </td>
                    </tr>
                  ))}
              </Table>
            ) : (
              <Empty title="No background tasks" />
            )}
          </Panel>
        </>
      );
    if (route === "availability") {
      const caps = data.availabilityRows || [];
      return (
        <Panel
          flush
          title="Capability status"
        >
          {caps.length ? (
            <Table headings={["Capability", "You reported", "We observed", "Readiness", "Report status"]}>
              {caps.map((c) => {
                const report = c.reported;
                const fresh = report && new Date(report.expiresAt) > new Date();
                const observed = c.observed && new Date(c.observed.expiresAt) > new Date();
                return (
                  <tr key={c.capabilityId}>
                    <td>
                      <code>{c.capabilityId}</code>
                    </td>
                    <td>
                      <Badge>{fresh ? report.status : "Unknown"}</Badge>
                      <small>
                        {report?.source || "No report"} · <DateText value={report?.createdAt} />
                      </small>
                    </td>
                    <td>
                      <Badge>{observed ? c.observed!.status : "Unknown"}</Badge>
                      <small>{c.observed?.source || "No current health observation"}</small>
                      {c.observed && (
                        <small>
                          Expires <DateText value={c.observed.expiresAt} />
                        </small>
                      )}
                    </td>
                    <td>
                      <Badge>{c.eligible ? "Ready for evaluation" : "Not ready"}</Badge>
                      <small>{c.reason}</small>
                    </td>
                    <td>
                      {permission("configure") && (
                        <form
                          className="ms-inline"
                          onSubmit={(e) => {
                            e.preventDefault();
                            void execute({
                              action: "availability",
                              environment,
                              capabilityId: c.capabilityId,
                              status: new FormData(e.currentTarget).get("status"),
                              minutes: 60,
                            });
                          }}
                        >
                          <select name="status" aria-label={`Status for ${c.capabilityId}`}>
                            {["Available", "Degraded", "Unavailable", "Maintenance", "Unknown"].map((s) => (
                              <option key={s}>{s}</option>
                            ))}
                          </select>
                          <button className="tr-secondary">Report for 1 hour</button>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
            </Table>
          ) : (
            <Empty title="No capability reports">Add a payment method before reporting its availability.</Empty>
          )}
        </Panel>
      );
    }
    if (route === "transactions") {
      const pageLink = (n: number) => `${href("transactions")}&${new URLSearchParams({ q: query, page: String(n) })}`;
      return (
        <Panel
          flush
          action={
            <form className="ms-inline" action="/provider/transactions">
              <input name="org" type="hidden" value={org.id} />
              <input name="env" type="hidden" value={environment} />
              <label>
                Reference
                <input name="q" defaultValue={query} placeholder="Transaction reference" />
              </label>
              <button className="tr-secondary">Search</button>
              {query && (
                <Link className="ms-btn" href={href("transactions")}>
                  Clear
                </Link>
              )}
            </form>
          }
        >
          {data.transactions?.length ? (
            <>
              <Table headings={["Reference", "Method", "Amount", "Execution", "Settlement", "Created"]}>
                {data.transactions.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <Link className="ms-rowlink" href={href(`transactions/${t.id}`)}>
                        {t.reference}
                      </Link>
                    </td>
                    <td>
                      {t.method}
                      <small>{t.operation}</small>
                    </td>
                    <td className="ms-amount">
                      {t.amount} <small>{t.asset}</small>
                    </td>
                    <td>
                      <Badge>{t.executionState}</Badge>
                    </td>
                    <td>{t.settlements[0]?.state ? <Badge>{t.settlements[0].state}</Badge> : <span className="ms-dim">Not started</span>}</td>
                    <td className="ms-dim">
                      <DateText value={t.createdAt} />
                    </td>
                  </tr>
                ))}
              </Table>
              <div className="ms-foot">
                <span className="ms-dim">
                  {data.total} records · page {page}
                </span>
                {page > 1 && (
                  <Link className="ms-btn" href={pageLink(page - 1)}>
                    Previous
                  </Link>
                )}
                {(data.total || 0) > page * 15 && (
                  <Link className="ms-btn" href={pageLink(page + 1)}>
                    Next
                  </Link>
                )}
              </div>
            </>
          ) : (
            <Empty title={query ? "No matching transactions" : `No ${environment} transactions`}>
              {environment === "production"
                ? "Production records appear after activation and a real provider connection. This workspace never moves funds."
                : "Fictional sandbox records appear here after development seeding."}
            </Empty>
          )}
        </Panel>
      );
    }
    if (route.startsWith("transactions/") && detail)
      return (
        <>
          <div className="ms-kpis pv-kpis-3">
            <Kpi label="Reference" value={<span className="pv-ref">{detail.reference}</span>} note={`${detail.environment} · ${detail.method}`} />
            <Kpi label="Amount" value={detail.amount} note={`${detail.asset} · ${detail.operation}`} />
            <Kpi
              label="Execution"
              value={<Badge>{detail.executionState}</Badge>}
              note={`Settlement: ${detail.settlements[0]?.state || "not started"}`}
            />
          </div>
          <div className="ms-grid-2">
            <Panel title="Timeline">
              <ol className="ms-timeline">
                {(detail.timeline as { at: string; action: string; result: string }[]).map((s, i) => (
                  <li key={i}>
                    <strong>{s.action}</strong>
                    <p>{s.result}</p>
                    <small>
                      <DateText value={s.at} />
                    </small>
                  </li>
                ))}
              </ol>
            </Panel>
            <Panel title="Settlements">
              {detail.settlements.length ? (
                <ul className="ms-list">
                  {detail.settlements.map((s) => (
                    <li key={s.id}>
                      <Link href={href("settlements")}>{s.reference}</Link>
                      <span>
                        {s.amount} {s.asset} <Badge>{s.state}</Badge>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No settlement has started for this execution.</p>
              )}
            </Panel>
          </div>
        </>
      );
    if (route === "settlements")
      return (
        <Panel
          flush
          title="Settlement monitoring"
        >
          {data.settlements?.length ? (
            <Table headings={["Reconciliation reference", "Amount", "State", "Created", "Completed"]}>
              {data.settlements.map((s) => (
                <tr key={s.id}>
                  <td>
                    <Link className="ms-rowlink" href={href(`transactions/${s.transactionId}`)}>
                      {s.reference}
                    </Link>
                  </td>
                  <td className="ms-amount">
                    {s.amount} <small>{s.asset}</small>
                  </td>
                  <td>
                    <Badge>{s.state}</Badge>
                  </td>
                  <td className="ms-dim">
                    <DateText value={s.createdAt} />
                  </td>
                  <td className="ms-dim">
                    <DateText value={s.completedAt} />
                  </td>
                </tr>
              ))}
            </Table>
          ) : (
            <Empty title={`No ${environment} settlements`}>Settlements appear when an active integration reports them.</Empty>
          )}
        </Panel>
      );
    if (route === "performance") {
      const records = data.metrics || [];
      const latencies = records.filter((r) => r.latencyMs !== null).map((r) => r.latencyMs!);
      const completedSettlements = (data.settlements || []).filter(
        (s) => s.completedAt && new Date(s.createdAt).getTime() >= Date.now() - 30 * 86400000,
      );
      const categories = [...new Set(records.map((r) => r.failureCategory).filter(Boolean))] as string[];
      const now = new Date();
      const current = (a: { source: string; expiresAt: Date | string }) => new Date(a.expiresAt) > now;
      return (
        <>
          <div className="ms-kpis">
            <Kpi label="Transactions" value={records.length || "No data"} note="last 30 days" />
            <Kpi
              label="Execution success"
              value={
                records.length
                  ? `${Math.round((records.filter((r) => r.executionState === "Confirmed").length / records.length) * 100)}%`
                  : "No data"
              }
              note="confirmed ÷ all executions"
            />
            <Kpi
              label="Mean latency"
              value={latencies.length ? `${Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)} ms` : "No data"}
              note={`${latencies.length} timed executions`}
            />
            <Kpi
              label="Settlement time"
              value={
                completedSettlements.length
                  ? `${Math.round(
                      completedSettlements.reduce(
                        (n, s) => n + (new Date(s.completedAt!).getTime() - new Date(s.createdAt).getTime()),
                        0,
                      ) /
                        completedSettlements.length /
                        60000,
                    )} min`
                  : "No data"
              }
              note={`mean of ${completedSettlements.length} completed`}
            />
          </div>
          <div className="ms-grid-2">
            <Panel title="Failure categories">
              {categories.length ? (
                <dl className="ms-props">
                  {categories.map((c) => (
                    <div key={c} style={{ display: "contents" }}>
                      <dt>{c}</dt>
                      <dd>{records.filter((r) => r.failureCategory === c).length}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p>No failures recorded.</p>
              )}
            </Panel>
            <Panel title="Availability reports">
              <dl className="ms-props">
                <dt>Your current reports</dt>
                <dd>{data.availability?.filter((a) => a.source === "Provider reported" && current(a)).length || 0}</dd>
                <dt>Current health observations</dt>
                <dd>{data.availability?.filter((a) => a.source !== "Provider reported" && current(a)).length || 0}</dd>
              </dl>
            </Panel>
          </div>
        </>
      );
    }
    if (route === "integration/events")
      return (
        <Panel flush title="Integration events">
          {data.events?.length ? (
            <Table headings={["Event", "State", "Summary", "Created", ""]}>
              {data.events.map((e) => (
                <tr key={e.id}>
                  <td>
                    {e.type}
                    <small>{e.eventId}</small>
                  </td>
                  <td>
                    <Badge>{e.state}</Badge>
                  </td>
                  <td>{e.summary}</td>
                  <td className="ms-dim">
                    <DateText value={e.createdAt} />
                  </td>
                  <td>
                    {sandbox && permission("integration") && (
                      <Action label="Replay safely" run={() => execute({ action: "replay-event", eventId: e.id })} />
                    )}
                  </td>
                </tr>
              ))}
            </Table>
          ) : (
            <Empty title={`No ${environment} events`} />
          )}
        </Panel>
      );
    if (route === "team") return <Team data={data} execute={execute} invitation={invitation} />;
    if (route === "audit-log")
      return (
        <Panel flush title="Audit history">
          {data.audit?.length ? (
            <Table headings={["Action", "Actor", "Target", "Time"]}>
              {data.audit.map((a) => (
                <tr key={a.id}>
                  <td>{a.action}</td>
                  <td>
                    <code>{a.actorId}</code>
                  </td>
                  <td>
                    <code>{a.target}</code>
                  </td>
                  <td className="ms-dim">
                    <DateText value={a.createdAt} />
                  </td>
                </tr>
              ))}
            </Table>
          ) : (
            <Empty title="No audit entries yet" />
          )}
        </Panel>
      );
    return (
      <Panel>
        <Empty title="Page unavailable" />
      </Panel>
    );
  }

  const body = content();
  return (
    <ProviderShell
      route={route}
      role={role}
      org={org}
      orgs={data.memberships.map((m) => ({ id: m.orgId, name: m.org.name }))}
      environment={environment}
      email={data.me.email}
      internalRole={data.internalRole}
      merchantLink={merchantLink}
      title={route.startsWith("transactions/") ? "Transaction" : titles[route] || "Workspace"}
      actions={actions}
      backLink={backLink}
    >
      {data.local && (
        <p className="pv-local">
          Local development · {org.fictional ? "fictional organization and sandbox records" : "no production services connected"}
        </p>
      )}
      {status}
      {oneTime && (
        <Panel title="Copy this API credential now" description="This is the only time it's shown. Store it somewhere secure.">
          <code className="pv-secret">{oneTime}</code>
          <div>
            <button type="button" className="primary" onClick={() => setOneTime("")}>
              I&apos;ve saved it
            </button>
          </div>
        </Panel>
      )}
      {body}
    </ProviderShell>
  );
}
