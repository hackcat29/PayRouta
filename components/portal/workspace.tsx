"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Check,
  Circle,
  LayoutDashboard,
  Menu,
  ShieldCheck,
  LogOut,
  RefreshCw,
  ChevronRight,
  Building2,
} from "lucide-react";
import type { WorkspaceData, transactionDetail } from "@/lib/portal/queries";
import {
  can,
  allowedRoute,
  checklist,
  Draft,
  scenarios,
} from "@/lib/portal/domain";
import { BrandLogo } from "../brand-logo";
import {
  Action,
  Badge,
  DateText,
  Empty,
  Field,
  JsonView,
  Modal,
  Panel,
  Table,
} from "./ui";
import {
  CapabilityForm,
  CompanyForm,
  CoverageForm,
  Execute,
  IntegrationForm,
  SettlementForm,
} from "./forms";
import { authClient, SecuritySettings } from "./auth-screen";
import { Compliance, Credentials, Team } from "./workspace-tools";
const groups = [
  {
    name: "Overview",
    items: [["overview", "Overview"]],
  },
  {
    name: "Payment methods",
    items: [["capabilities", "Payment methods"]],
  },
  {
    name: "Connections",
    items: [
      ["integration", "How to connect"],
      ["integration/credentials", "API credentials"],
      ["sandbox", "Sandbox tests"],
      ["integration/events", "Events"],
      ["availability", "Connection status"],
    ],
  },
  {
    name: "Activity",
    items: [
      ["transactions", "Transactions"],
      ["settlements", "Settlements"],
      ["performance", "Reliability"],
    ],
  },
  {
    name: "Verification",
    items: [
      ["onboarding", "Get started"],
      ["application", "Submission & review"],
    ],
  },
  {
    name: "Settings",
    items: [
      ["team", "Team"],
      ["settings", "Settings"],
      ["audit-log", "Audit log"],
    ],
  },
];
export function Workspace({
  data,
  route,
  environment,
  query,
  page,
  detail,
  invitation,
}: {
  data: WorkspaceData;
  route: string;
  environment: string;
  query: string;
  page: number;
  detail?: Awaited<ReturnType<typeof transactionDetail>>;
  invitation?: string;
}) {
  const router = useRouter();
  const [notice, setNotice] = useState("");
  const [oneTime, setOneTime] = useState("");
  const [menu, setMenu] = useState(false);
  const [submitKey] = useState(() => crypto.randomUUID());
  const execute: Execute = async (payload) => {
    setNotice("");
    try {
      const res = await fetch("/api/portal/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId: data.org?.id, ...payload }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);
      setNotice(result.message || "Saved");
      if (result.oneTimeSecret) setOneTime(result.oneTimeSecret);
      if (result.orgId) router.push(`/provider/overview?org=${result.orgId}`);
      router.refresh();
      return result;
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Action failed");
      return null;
    }
  };
  const href = (path: string) =>
    `/provider/${path}?org=${data.org?.id || ""}&env=${environment}`;
  const app = data.application;
  const draft = (app?.draft || {}) as Draft;
  const version = app?.version || 1;
  const role = data.role || "Analyst";
  const permission = (p: Parameters<typeof can>[1]) => can(role, p);
  const evidenceComplete =
    !data.requirements?.length ||
    data.requirements.every((r) =>
      data.evidence?.some((e) => e.requirementId === r.id),
    );
  const steps = checklist(draft, evidenceComplete ? 1 : 0);
  const completed = steps.filter((s) => s.complete).length;
  const active = data.activations?.[0];
  const published = data.activations?.find((a) => a.acknowledgedAt);
  const publishedDraft = (
    data.application?.submissions.find((s) => s.id === published?.submissionId)
      ?.snapshot as { draft: Draft } | undefined
  )?.draft;
  const pageTitle = route.startsWith("transactions/")
    ? "Transaction detail"
    : (
        {
          overview: "Overview",
          onboarding: "Get started",
          "onboarding/company": "Company",
          "onboarding/coverage": "Where you accept payments",
          "onboarding/capabilities": "Payment methods",
          "onboarding/settlement": "How you get paid",
          "onboarding/compliance": "Documents",
          "onboarding/integration": "How to connect",
          "onboarding/review": "Review and submit",
          application: "Submission & review",
          capabilities: "Payment methods",
          integration: "How to connect",
          "integration/credentials": "API credentials",
          "integration/events": "Events",
          sandbox: "Sandbox tests",
          availability: "Connection status",
          transactions: "Transactions",
          settlements: "Settlements",
          performance: "Reliability",
          team: "Team",
          settings: "Settings",
          "audit-log": "Audit log",
          "organizations/new": "Create an organization",
        } as Record<string, string>
      )[route] || "Workspace";
  function checklistView() {
    return (
      <div className="p-checklist">
        {steps
          .filter((s) => allowedRoute(role, `onboarding/${s.id}`))
          .map((s, i) => (
            <Link href={href(`onboarding/${s.id}`)} key={s.id}>
              <span className={`p-step ${s.complete ? "complete" : ""}`}>
                {s.complete ? <Check size={16} /> : i + 1}
              </span>
              <div>
                <strong>{s.label}</strong>
                <small>
                  {s.complete ? "Ready for submission" : "Details needed"}
                </small>
              </div>
              <ChevronRight size={18} />
            </Link>
          ))}
      </div>
    );
  }
  function capabilities() {
    const caps = (draft.capabilities || []).filter(
      (c) => c.environment === environment,
    );
    return (
      <>
        <div className="p-notice">
          Draft proposals are separate from published capabilities. New
          corridors and permissions require review.
        </div>
        <Panel
          title="Proposed capabilities"
          action={
            permission("configure") && (
              <Modal label="Add capability" title="Define a payment capability">
                <CapabilityForm
                  integrations={data.integrations}
                  version={version}
                  execute={execute}
                  environment={environment}
                />
              </Modal>
            )
          }
        >
          {caps.length ? (
            <Table
              headings={[
                "Capability",
                "Direction",
                "Operation",
                "Limits",
                "Version",
                "",
              ]}
            >
              {caps.map((c) => (
                <tr key={c.capabilityId}>
                  <td>
                    <strong>{c.rail}</strong>
                    <small>{c.capabilityId}</small>
                  </td>
                  <td>
                    {c.input.identifier} →{" "}
                    {c.output?.identifier || c.input.identifier}
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
                    <small>Draft proposal</small>
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
                            execute({
                              action: "remove-capability",
                              environment,
                              version,
                              capabilityId: c.capabilityId,
                            })
                          }
                        />
                      </Modal>
                    )}
                  </td>
                </tr>
              ))}
            </Table>
          ) : (
            <Empty title="Declare your first capability">
              Specify a method, direction, operation, and exact limits.
            </Empty>
          )}
        </Panel>
        <Panel title="Published configuration">
          {published?.action === "publish" ? (
            <>
              <p>
                Registry acknowledged submission {published.submissionId},
                sequence {published.sequence}.{" "}
                {environment === "sandbox"
                  ? "Local simulator publication only."
                  : ""}
              </p>
              <JsonView
                value={publishedDraft?.capabilities?.filter(
                  (c) => c.environment === environment,
                )}
                label="Current published capability snapshot"
              />
            </>
          ) : (
            <Empty title="No published capabilities">
              Approval and registry acknowledgement are required.
            </Empty>
          )}
        </Panel>
        <JsonView value={caps} />
      </>
    );
  }
  function applicationView() {
    return (
      <>
        <div className="p-stat-row">
          <Panel title="Application">
            <Badge>{app?.state}</Badge>
            <p>
              Draft v{version} · <DateText value={app?.updatedAt} />
            </p>
          </Panel>
          <Panel title="Operational status">
            <Badge>
              {active?.state === "Pending"
                ? active.action === "withdraw"
                  ? "Suspension propagation pending"
                  : "Publication pending"
                : active?.state || "Not enabled"}
            </Badge>
            <p>
              {environment === "sandbox"
                ? "Local sandbox registry"
                : "Production registry"}
            </p>
          </Panel>
        </div>
        {data.application?.submissions.map((s) => (
          <Panel key={s.id} title={`Submission v${s.version}`}>
            <p>
              <DateText value={s.createdAt} /> · immutable snapshot
            </p>
            <div className="p-review-grid">
              {["legal", "technical"].map((kind) => (
                <div key={kind}>
                  <h3>
                    {kind === "legal"
                      ? "Legal / compliance"
                      : "Technical review"}
                  </h3>
                  <Badge>
                    {s.reviews.filter((r) => r.kind === kind).at(-1)
                      ?.decision || "Pending"}
                  </Badge>
                </div>
              ))}
            </div>
            {s.changes.map((c) => (
              <div className="p-change" key={c.id}>
                <h3>{c.section}</h3>
                <p>{c.message}</p>
                {c.response ? (
                  <blockquote>{c.response}</blockquote>
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
                    <button className="p-button">Record response</button>
                  </form>
                ) : (
                  <p>Awaiting compliance response</p>
                )}
              </div>
            ))}
            {s.reviews
              .filter((r) => r.kind === "application")
              .map((r) => (
                <p key={r.id}>
                  <Badge>{r.decision}</Badge> {r.reason}
                </p>
              ))}
            <JsonView value={s.snapshot} label="View submitted snapshot" />
          </Panel>
        ))}
        {!data.application?.submissions.length && (
          <Empty title="Your application has not been submitted">
            <Link href={href("onboarding")}>
              Complete the checklist <ArrowRight size={16} />
            </Link>
          </Empty>
        )}
        <Panel
          title={`${environment === "sandbox" ? "Sandbox publication" : "Production activation"} prerequisites`}
        >
          <ul className="p-gates">
            {data.gates?.map((g) => (
              <li key={g}>
                <Circle size={13} />
                {g}
              </li>
            ))}
          </ul>
          {data.gates?.length === 0 && (
            <p>
              Ready for an internal activation decision in this environment.
            </p>
          )}
        </Panel>
      </>
    );
  }
  function content() {
    if (route === "settings")
      return (
        <>
          <Panel title="Account security">
            <SecuritySettings
              enabled={!!data.me.twoFactorEnabled}
              execute={execute}
            />
          </Panel>
          {data.org && (
            <Panel title="Organization">
              <p>{data.org.name}</p>
              <p>
                Organization ID: <code>{data.org.id}</code>
              </p>
              <Link className="p-link" href={href("organizations/new")}>
                Create another organization
              </Link>
            </Panel>
          )}
          {data.internalRole && (
            <Panel title="Internal access">
              <p>
                {data.internalRole} · A fresh authenticator check is required.
              </p>
              <Link className="p-button" href="/ops/applications">
                Open review console
              </Link>
            </Panel>
          )}
        </>
      );
    if (!data.org && invitation)
      return (
        <Panel title="Organization invitation">
          <p>
            Accept this invitation with the intended recipient’s verified email.
          </p>
          <Action
            label="Accept invitation"
            run={() =>
              execute({ action: "accept-invitation", token: invitation })
            }
          />
        </Panel>
      );
    if (!data.org || route === "organizations/new")
      return (
        <Panel title="Your organization">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void execute({
                action: "create-organization",
                name: new FormData(e.currentTarget).get("name"),
              });
            }}
          >
            <Field label="Organization name">
              <input name="name" required maxLength={120} />
            </Field>
            <button className="p-button">Create organization</button>
          </form>
        </Panel>
      );
    if (route === "overview" && !["Owner", "Admin"].includes(role))
      return (
        <>
          <Panel title={`Welcome, ${data.me.name}`}>
            <p>
              {data.org.name} · {role}
            </p>
            <p>
              {role === "Developer"
                ? "Configure the integration and inspect sandbox behavior."
                : role === "Compliance"
                  ? "Prepare company evidence and respond to review requests."
                  : "Monitor organization-scoped operations and performance."}
            </p>
            <Link
              className="p-button"
              href={href(
                role === "Developer"
                  ? "integration"
                  : role === "Compliance"
                    ? "onboarding/company"
                    : "transactions",
              )}
            >
              Open your workspace <ArrowRight size={16} />
            </Link>
          </Panel>
          <div className="p-stat-row">
            <Panel title="Application status">
              <Badge>{app?.state}</Badge>
            </Panel>
            <Panel title="Operating status">
              <Badge>{active?.state || "Not enabled"}</Badge>
            </Panel>
            <Panel title="Transactions">
              <strong className="p-metric">{data.total || "No data"}</strong>
              <p>{environment} records</p>
            </Panel>
          </div>
        </>
      );
    if (route === "overview" && active?.state === "Active")
      return (
        <>
          <div className="p-stat-row">
            <Panel title="Operational status">
              <Badge>Active</Badge>
              <p>
                {environment === "sandbox"
                  ? "Fictional sandbox registry"
                  : "Production"}{" "}
                · sequence {active.sequence}
              </p>
            </Panel>
            <Panel title="Transactions">
              <strong className="p-metric">{data.total || 0}</strong>
              <p>Recorded in this environment</p>
            </Panel>
            <Panel title="Pending settlements">
              <strong className="p-metric">
                {data.settlements?.filter((s) => s.state === "Pending")
                  .length || 0}
              </strong>
            </Panel>
          </div>
          <Panel title="Recent exceptions">
            {data.transactions?.some(
              (t) => t.executionState !== "Confirmed",
            ) ? (
              data.transactions
                .filter((t) => t.executionState !== "Confirmed")
                .slice(0, 5)
                .map((t) => (
                  <p key={t.id}>
                    <Link href={href(`transactions/${t.id}`)}>
                      {t.reference}
                    </Link>{" "}
                    · <Badge>{t.executionState}</Badge>
                  </p>
                ))
            ) : (
              <p>No recorded exceptions in this environment.</p>
            )}
            <Link className="p-link" href={href("transactions")}>
              Investigate transactions →
            </Link>
          </Panel>
          <Panel title="Configuration & availability">
            <p>
              New proposals stay separate from the currently published
              capability snapshot.
            </p>
            <div className="p-toolbar">
              <Link className="p-button secondary" href={href("capabilities")}>
                Review capabilities
              </Link>
              <Link className="p-button secondary" href={href("availability")}>
                Review availability
              </Link>
              <Link className="p-button secondary" href={href("settlements")}>
                Review settlements
              </Link>
            </div>
          </Panel>
        </>
      );
    if (route === "overview")
      return (
        <>
          <div className="p-welcome">
            <div>
              <h2>
                {completed === steps.length
                  ? "Ready for your next step."
                  : "Let’s prepare your application."}
              </h2>
              <p>
                {data.org.name} · {role}
              </p>
            </div>
            <Link
              className="p-button"
              href={href(
                completed === steps.length
                  ? "onboarding/review"
                  : `onboarding/${steps.find((s) => !s.complete)?.id || "company"}`,
              )}
            >
              {completed === steps.length
                ? "Review application"
                : "Continue onboarding"}
              <ArrowRight size={17} />
            </Link>
          </div>
          <div className="p-stat-row">
            <Panel title="Application status">
              <Badge>{app?.state}</Badge>
              <p>Draft version {version}</p>
            </Panel>
            <Panel title="Onboarding progress">
              <strong className="p-metric">
                {completed}
                <span> / 6</span>
              </strong>
              <progress value={completed} max={6} />
            </Panel>
            <Panel title="Operating status">
              <Badge>{active?.state || "Not enabled"}</Badge>
              <p>{environment === "sandbox" ? "Sandbox only" : "Production"}</p>
            </Panel>
          </div>
          <div className="p-columns">
            <Panel title="Finish your application">{checklistView()}</Panel>
            <div className="p-stack">
              <Panel title="Updates">
                {data.notifications?.length ? (
                  data.notifications.map((n) => (
                    <Link
                      key={n.id}
                      className="p-notification"
                      href={`${n.href}?org=${data.org!.id}&env=${environment}`}
                    >
                      <span>{n.message}</span>
                      <small>
                        <DateText value={n.createdAt} />
                      </small>
                    </Link>
                  ))
                ) : (
                  <p className="p-muted">
                    Review decisions and requested changes will appear here.
                  </p>
                )}
              </Panel>
              <Panel title="Test before you submit">
                <ShieldCheck size={28} />
                <p>
                  Run deterministic scenarios and inspect how your integration
                  handles uncertainty.
                </p>
                <Link className="p-link" href={href("sandbox")}>
                  Open sandbox <ArrowRight size={16} />
                </Link>
              </Panel>
            </div>
          </div>
        </>
      );
    if (route === "onboarding")
      return (
        <>
          <div className="p-toolbar">
            <p>
              {completed} of 6 sections ready · Draft v{version}
            </p>
            <Link className="p-button" href={href("onboarding/review")}>
              Review & submit <ArrowRight size={16} />
            </Link>
          </div>
          <Panel>{checklistView()}</Panel>
          <p className="p-muted">
            Last saved <DateText value={app?.updatedAt} />. Each save checks for
            concurrent changes.
          </p>
        </>
      );
    if (route === "onboarding/company")
      return (
        <CompanyForm
          draft={draft}
          version={version}
          execute={execute}
          disabled={!permission("company")}
        />
      );
    if (route === "onboarding/coverage")
      return (
        <CoverageForm
          draft={draft}
          version={version}
          execute={execute}
          disabled={!permission("configure")}
        />
      );
    if (route === "capabilities" || route === "onboarding/capabilities")
      return capabilities();
    if (route === "onboarding/settlement")
      return (
        <SettlementForm
          draft={draft}
          version={version}
          execute={execute}
          disabled={!permission("configure")}
        />
      );
    if (route === "onboarding/compliance")
      return <Compliance data={data} execute={execute} setNotice={setNotice} />;
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
          <Panel title="Connection checks">
            <p>
              Checks run in a constrained worker. Connectivity does not prove
              payment integration readiness.
            </p>
            <Action
              label="Check provider endpoint"
              disabled={!permission("integration")}
              run={() =>
                execute({
                  action: "check-endpoint",
                  environment,
                  key: crypto.randomUUID(),
                })
              }
            />
          </Panel>
          <Panel title="Saved versions">
            <Table headings={["Version", "Created", "Environment"]}>
              {data.integrations?.map((i) => (
                <tr key={i.id}>
                  <td>v{i.version}</td>
                  <td>
                    <DateText value={i.createdAt} />
                  </td>
                  <td>{i.environment}</td>
                </tr>
              ))}
            </Table>
          </Panel>
        </>
      );
    if (route === "onboarding/review")
      return (
        <>
          <Panel title="Submission checklist">{checklistView()}</Panel>
          <Panel title="Submit this draft">
            <p>
              Your submission preserves draft v{version}, matching requirement
              versions, document references, and integration versions. Later
              edits stay in a new draft.
            </p>
            <p>
              Uploaded evidence may still be awaiting scanning or review.
              Submission is not approval or activation.
            </p>
            <Action
              label={
                app?.state === "Changes requested"
                  ? "Resubmit application"
                  : "Submit application"
              }
              disabled={
                !permission("submit") ||
                completed < 6 ||
                ["Submitted", "Resubmitted", "Under review"].includes(
                  app?.state || "",
                )
              }
              run={() => execute({ action: "submit", version, key: submitKey })}
            />
          </Panel>
          <JsonView value={draft} label="Review full draft" />
        </>
      );
    if (route === "application") return applicationView();
    if (route === "integration/credentials")
      return (
        <Credentials data={data} execute={execute} environment={environment} />
      );
    if (route === "sandbox")
      return (
        <>
          <div className="p-notice">
            Local simulator · Fictional scenarios. Passing a simulator test does
            not establish production readiness.
          </div>
          <Panel title="Run a scenario">
            <form
              className="p-inline-form"
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
              <button
                className="p-button"
                disabled={
                  !permission("integration") || environment !== "sandbox"
                }
              >
                Run scenario
              </button>
            </form>
            {environment !== "sandbox" && (
              <p>Switch to Sandbox to run fictional tests.</p>
            )}
          </Panel>
          <Panel title="Test history">
            {data.runs?.length ? (
              data.runs.map((r) => (
                <details key={r.id} className="p-run">
                  <summary>
                    <span>
                      {r.scenario}
                      <small>
                        <DateText value={r.createdAt} /> · Integration v
                        {r.integrationVersion} · {r.adapter}
                      </small>
                    </span>
                    <Badge>{r.outcome}</Badge>
                  </summary>
                  <ol className="p-timeline">
                    {(
                      r.steps as {
                        at: string;
                        action: string;
                        result: string;
                      }[]
                    ).map((s, i) => (
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
                    label="Rerun scenario"
                    disabled={!permission("integration")}
                    run={() =>
                      execute({
                        action: "sandbox-run",
                        scenario: r.scenario,
                        key: crypto.randomUUID(),
                      })
                    }
                  />
                </details>
              ))
            ) : (
              <Empty title="No test runs yet">
                Save a sandbox connection and choose a scenario.
              </Empty>
            )}
          </Panel>
          <Panel title="Background tasks">
            <Table headings={["Task", "State", "Attempts", "Result"]}>
              {data.jobs
                ?.filter((j) => j.kind !== "registry")
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
                        <Action
                          label="Retry"
                          run={() =>
                            execute({ action: "retry-job", jobId: j.id })
                          }
                        />
                      )}
                    </td>
                  </tr>
                ))}
            </Table>
          </Panel>
        </>
      );
    if (route === "availability") {
      const caps = data.availabilityRows || [];
      return (
        <Panel title="Capability status">
          <p>
            Reports expire. A manual Available report cannot override
            suspension, missing evidence, or an unpublished capability.
          </p>
          {caps.length ? (
            <Table
              headings={[
                "Capability",
                "Provider reported",
                "Observed health",
                "Operational readiness",
                "Update",
              ]}
            >
              {caps.map((c) => {
                const report = c.reported;
                const fresh = report && new Date(report.expiresAt) > new Date();
                return (
                  <tr key={c.capabilityId}>
                    <td>{c.capabilityId}</td>
                    <td>
                      <Badge>{fresh ? report.status : "Unknown"}</Badge>
                      <small>{report?.source || "No report"}</small>
                      <small>
                        <DateText value={report?.createdAt} />
                      </small>
                    </td>
                    <td>
                      <Badge>
                        {c.observed &&
                        new Date(c.observed.expiresAt) > new Date()
                          ? c.observed.status
                          : "Unknown"}
                      </Badge>
                      <small>
                        {c.observed?.source || "No current health observation"}
                      </small>
                      <small>
                        <DateText value={c.observed?.createdAt} />
                      </small>
                      <small>
                        Expires <DateText value={c.observed?.expiresAt} />
                      </small>
                    </td>
                    <td>
                      <Badge>
                        {c.eligible ? "Ready for evaluation" : "Not ready"}
                      </Badge>
                      <small>{c.reason}</small>
                    </td>
                    <td>
                      {permission("configure") && (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            void execute({
                              action: "availability",
                              environment,
                              capabilityId: c.capabilityId,
                              status: new FormData(e.currentTarget).get(
                                "status",
                              ),
                              minutes: 60,
                            });
                          }}
                        >
                          <select
                            name="status"
                            aria-label={`Status for ${c.capabilityId}`}
                          >
                            {[
                              "Available",
                              "Degraded",
                              "Unavailable",
                              "Maintenance",
                              "Unknown",
                            ].map((s) => (
                              <option key={s}>{s}</option>
                            ))}
                          </select>
                          <button className="p-button secondary">
                            Report for 1 hour
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
            </Table>
          ) : (
            <Empty title="No capability reports">
              Configure a capability before reporting its availability.
            </Empty>
          )}
        </Panel>
      );
    }
    if (route === "transactions")
      return (
        <Panel title="Transactions" action={<span>{data.total} records</span>}>
          <form className="p-inline-form" action="/provider/transactions">
            <input name="org" type="hidden" value={data.org.id} />
            <input name="env" type="hidden" value={environment} />
            <Field label="Search by reference">
              <input
                name="q"
                defaultValue={query}
                placeholder="Transaction reference"
              />
            </Field>
            <button className="p-button secondary">Search</button>
          </form>
          {data.transactions?.length ? (
            <>
              <Table
                headings={[
                  "Reference",
                  "Method / operation",
                  "Amount",
                  "Execution",
                  "Settlement",
                  "Created",
                ]}
              >
                {data.transactions.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <Link
                        className="p-link"
                        href={href(`transactions/${t.id}`)}
                      >
                        {t.reference}
                      </Link>
                      <small>{t.environment}</small>
                    </td>
                    <td>
                      {t.method}
                      <small>{t.operation}</small>
                    </td>
                    <td>
                      {t.amount} {t.asset}
                    </td>
                    <td>
                      <Badge>{t.executionState}</Badge>
                    </td>
                    <td>{t.settlements[0]?.state || "Not started"}</td>
                    <td>
                      <DateText value={t.createdAt} />
                    </td>
                  </tr>
                ))}
              </Table>
              <div className="p-toolbar">
                <span>Page {page} · 15 per page</span>
                {page > 1 && (
                  <Link
                    href={`${href("transactions")}&q=${encodeURIComponent(query)}&page=${page - 1}`}
                  >
                    Previous
                  </Link>
                )}
                {(data.total || 0) > page * 15 && (
                  <Link
                    href={`${href("transactions")}&q=${encodeURIComponent(query)}&page=${page + 1}`}
                  >
                    Next
                  </Link>
                )}
              </div>
            </>
          ) : (
            <Empty title={`No ${environment} transactions`}>
              {environment === "production"
                ? "Production records appear after activation and a real provider connection. No funds are moved by this portal."
                : "Fictional transaction records appear after development seeding."}
            </Empty>
          )}
        </Panel>
      );
    if (route.startsWith("transactions/") && detail)
      return (
        <>
          <Link className="p-link" href={href("transactions")}>
            ← All transactions
          </Link>
          <div className="p-stat-row">
            <Panel title="Reference">
              <strong>{detail.reference}</strong>
              <p>
                {detail.environment} · {detail.method}
              </p>
            </Panel>
            <Panel title="Amount">
              <strong className="p-metric">{detail.amount}</strong>
              <p>
                {detail.asset} · {detail.operation}
              </p>
            </Panel>
            <Panel title="Execution">
              <Badge>{detail.executionState}</Badge>
              <p>Settlement: {detail.settlements[0]?.state || "Not started"}</p>
            </Panel>
          </div>
          <Panel title="Transaction timeline">
            <ol className="p-timeline">
              {(
                detail.timeline as {
                  at: string;
                  action: string;
                  result: string;
                }[]
              ).map((s, i) => (
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
          <Panel title="Related settlements">
            {!detail.settlements.length && (
              <p>No settlement has started for this execution.</p>
            )}
            {detail.settlements.map((s) => (
              <p key={s.id}>
                <Link href={href("settlements")}>{s.reference}</Link> ·{" "}
                <Badge>{s.state}</Badge> · {s.amount} {s.asset}
              </p>
            ))}
          </Panel>
        </>
      );
    if (route === "settlements")
      return (
        <Panel title="Settlement monitoring">
          <p>
            Execution and settlement are separate. This workspace has no
            fund-transfer controls.
          </p>
          {data.settlements?.length ? (
            <Table
              headings={[
                "Reconciliation reference",
                "Amount",
                "State",
                "Created",
                "Completed",
              ]}
            >
              {data.settlements.map((s) => (
                <tr key={s.id}>
                  <td>
                    <Link href={href(`transactions/${s.transactionId}`)}>
                      {s.reference}
                    </Link>
                  </td>
                  <td>
                    {s.amount} {s.asset}
                  </td>
                  <td>
                    <Badge>{s.state}</Badge>
                  </td>
                  <td>
                    <DateText value={s.createdAt} />
                  </td>
                  <td>
                    <DateText value={s.completedAt} />
                  </td>
                </tr>
              ))}
            </Table>
          ) : (
            <Empty title={`No ${environment} settlements`}>
              Settlement records will appear when reported by an active
              integration.
            </Empty>
          )}
        </Panel>
      );
    if (route === "performance") {
      const records = data.metrics || [];
      const latencies = records
        .filter((r) => r.latencyMs !== null)
        .map((r) => r.latencyMs!);
      const completedSettlements = (data.settlements || []).filter(
        (s) =>
          s.completedAt &&
          new Date(s.createdAt).getTime() >= Date.now() - 30 * 86400000,
      );
      return (
        <>
          <p className="p-muted">
            Last 30 days ·{" "}
            {environment === "sandbox"
              ? "Fictional stored sandbox records"
              : "Stored production records"}
            . Success = confirmed executions ÷ all recorded executions.
          </p>
          <div className="p-stat-row">
            <Panel title="Transactions">
              <strong className="p-metric">
                {records.length || "No data"}
              </strong>
            </Panel>
            <Panel title="Execution success">
              <strong className="p-metric">
                {records.length
                  ? `${Math.round((records.filter((r) => r.executionState === "Confirmed").length / records.length) * 100)}%`
                  : "No data"}
              </strong>
            </Panel>
            <Panel title="Mean execution latency">
              <strong className="p-metric">
                {latencies.length
                  ? `${Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)} ms`
                  : "No data"}
              </strong>
              <p>{latencies.length} timed executions</p>
            </Panel>
          </div>
          <div className="p-columns">
            <Panel title="Failure categories">
              {records.some((r) => r.failureCategory) ? (
                [
                  ...new Set(
                    records.map((r) => r.failureCategory).filter(Boolean),
                  ),
                ].map((c) => (
                  <p key={c}>
                    {c}: {records.filter((r) => r.failureCategory === c).length}
                  </p>
                ))
              ) : (
                <p>No failures recorded</p>
              )}
            </Panel>
            <Panel title="Settlement duration">
              <p>
                {completedSettlements.length
                  ? `${Math.round(completedSettlements.reduce((n, s) => n + (new Date(s.completedAt!).getTime() - new Date(s.createdAt).getTime()), 0) / completedSettlements.length / 60000)} minutes mean across ${completedSettlements.length} completed settlements`
                  : "No data"}
              </p>
              <p className="p-muted">
                Amounts are kept in their original assets; currencies are not
                combined.
              </p>
            </Panel>
          </div>
          <Panel title="Availability freshness">
            <p>
              {data.availability?.filter(
                (a) =>
                  a.source === "Provider reported" &&
                  new Date(a.expiresAt) > new Date(),
              ).length || 0}{" "}
              current provider reports.{" "}
              {data.availability?.filter(
                (a) =>
                  a.source !== "Provider reported" &&
                  new Date(a.expiresAt) > new Date(),
              ).length || 0}{" "}
              current observed health reports.
            </p>
          </Panel>
        </>
      );
    }
    if (route === "integration/events")
      return (
        <Panel title="Sanitized integration events">
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
                  <td>
                    <DateText value={e.createdAt} />
                  </td>
                  <td>
                    {environment === "sandbox" && permission("integration") && (
                      <Action
                        label="Replay safely"
                        run={() =>
                          execute({ action: "replay-event", eventId: e.id })
                        }
                      />
                    )}
                  </td>
                </tr>
              ))}
            </Table>
          ) : (
            <Empty title={`No ${environment} events`}>
              Only safe event summaries are shown here.
            </Empty>
          )}
        </Panel>
      );
    if (route === "team")
      return <Team data={data} execute={execute} invitation={invitation} />;
    if (route === "audit-log")
      return (
        <Panel title="Organization audit history">
          <Table headings={["Action", "Actor", "Target", "Time"]}>
            {data.audit?.map((a) => (
              <tr key={a.id}>
                <td>{a.action}</td>
                <td>
                  <code>{a.actorId}</code>
                </td>
                <td>
                  <code>{a.target}</code>
                </td>
                <td>
                  <DateText value={a.createdAt} />
                </td>
              </tr>
            ))}
          </Table>
        </Panel>
      );
    return <Empty title="Page unavailable" />;
  }
  return (
    <div className="portal p-shell">
      <aside className={`p-sidebar ${menu ? "open" : ""}`}>
        <Link className="p-logo" href={href("overview")}>
          <BrandLogo reverse />
        </Link>
        <div className="p-workspace-label">
          <Building2 size={16} /> Provider workspace
        </div>
        <nav aria-label="Provider navigation">
          {groups.map((group) => (
            <div key={group.name}>
              <h2>{group.name}</h2>
              {group.items
                .filter(([path]) => allowedRoute(role, path))
                .map(([path, label]) => (
                  <Link
                    key={path}
                    className={route === path ? "active" : ""}
                    href={href(path)}
                    onClick={() => setMenu(false)}
                    aria-current={route === path ? "page" : undefined}
                  >
                    {path === "overview" ? (
                      <LayoutDashboard size={16} />
                    ) : (
                      <span className="p-nav-dot" />
                    )}
                    {label}
                  </Link>
                ))}
            </div>
          ))}
        </nav>
        <div className="p-sidebar-bottom">
          <span>{data.me.name}</span>
          <small>{data.me.email}</small>
          <button
            onClick={async () => {
              await authClient.signOut();
              router.push("/provider/sign-in");
            }}
          >
            <LogOut size={15} /> Sign out
          </button>
        </div>
      </aside>
      <div className="p-workarea">
        <header className="p-topbar">
          <button
            className="p-mobile-toggle"
            aria-label="Toggle navigation"
            aria-expanded={menu}
            onClick={() => setMenu(!menu)}
          >
            <Menu />
          </button>
          <label className="p-org-switch">
            <Building2 size={17} />
            <select
              aria-label="Organization"
              value={data.org?.id || ""}
              onChange={(e) =>
                router.push(
                  `/provider/overview?org=${e.target.value}&env=${environment}`,
                )
              }
            >
              {data.memberships.map((m) => (
                <option key={m.id} value={m.orgId}>
                  {m.org.name}
                </option>
              ))}
              {!data.memberships.length && <option>No organization</option>}
            </select>
          </label>
          <div className={`p-env ${environment}`}>
            <span />
            <select
              aria-label="Environment"
              value={environment}
              onChange={(e) =>
                router.push(
                  `/provider/${route}?org=${data.org?.id || ""}&env=${e.target.value}`,
                )
              }
            >
              <option value="sandbox">Sandbox</option>
              <option value="production">Production</option>
            </select>
          </div>
          <Link
            href="/merchant/overview"
            className="p-merchant-switch-link"
            style={{
              marginLeft: "auto",
              fontSize: "0.8125rem",
              fontWeight: 500,
              color: "var(--p-text)",
              textDecoration: "none",
              padding: "6px 12px",
              borderRadius: "6px",
              border: "1px solid var(--p-border)",
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            Merchant workspace →
          </Link>
        </header>
        <div className="p-content">
          <div className="p-page-heading">
            <div>
              <p className="p-breadcrumb">
                Provider workspace <ChevronRight size={13} /> {environment}
              </p>
              <h1>{pageTitle}</h1>
            </div>
            <button
              className="p-icon-button"
              aria-label="Refresh workspace"
              onClick={() => router.refresh()}
            >
              <RefreshCw size={18} />
            </button>
          </div>
          {data.local && (
            <div className="p-environment-note">
              <span />
              Local development ·{" "}
              {data.org?.fictional
                ? "Fictional organization and sandbox records"
                : "No production services connected"}
            </div>
          )}
          {notice && (
            <div className="p-notice" role="status">
              {notice}
              <button
                aria-label="Dismiss message"
                onClick={() => setNotice("")}
              >
                ×
              </button>
            </div>
          )}
          {oneTime && (
            <Panel title="Copy this API credential now">
              <p>
                This is the only time the value is displayed. Store it securely.
              </p>
              <code className="p-wrap">{oneTime}</code>
              <button
                className="p-button secondary"
                onClick={() => setOneTime("")}
              >
                I have saved it
              </button>
            </Panel>
          )}
          <div className="p-stack">{content()}</div>
        </div>
        <footer className="p-app-footer">
          PayRouta · Provider workspace <span>All timestamps UTC</span>
        </footer>
      </div>
    </div>
  );
}
