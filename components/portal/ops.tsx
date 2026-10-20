"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck, Menu, RefreshCw } from "lucide-react";
import { BrandLogo } from "../brand-logo";
import type { OpsData } from "@/lib/portal/queries";
import { Draft, providerTypes, countries } from "@/lib/portal/domain";
import {
  Action,
  Badge,
  DateText,
  Empty,
  Field,
  JsonView,
  Panel,
  Table,
} from "./ui";
export function Ops({ data, route }: { data: OpsData; route: string }) {
  const router = useRouter();
  const [notice, setNotice] = useState("");
  const [menu, setMenu] = useState(false);
  const app = data.application;
  const sub = app?.submissions[0];
  const snapshot = sub?.snapshot as { draft: Draft } | undefined;
  const [environment, setEnvironment] = useState("sandbox");
  const execute = async (payload: Record<string, unknown>) => {
    try {
      const res = await fetch("/api/portal/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationId: app?.id, ...payload }),
      });
      const r = await res.json();
      if (!res.ok) throw new Error(r.error);
      setNotice(r.message || "Saved");
      router.refresh();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Action failed");
    }
  };
  const admin = data.me.internalRole === "Operations admin";
  const title = app
    ? app.org.name
    : route === "requirements"
      ? "Requirement templates"
      : route === "audit-log"
        ? "Administrative audit log"
        : route === "providers"
          ? "Provider directory"
          : "Application review queue";
  function review() {
    return (
      <>
        <Link href="/ops/applications" className="p-link">
          ← Review queue
        </Link>
        <div className="p-stat-row">
          <Panel title="Application">
            <Badge>{app!.state}</Badge>
            <p>
              Submitted v{sub?.version || "—"} · Draft v{app!.version}
            </p>
          </Panel>
          <Panel title="Review tracks">
            {["legal", "technical"].map((kind) => (
              <p key={kind}>
                {kind}:{" "}
                <Badge>
                  {sub?.reviews.filter((r) => r.kind === kind).at(-1)
                    ?.decision || "Pending"}
                </Badge>
              </p>
            ))}
          </Panel>
          <Panel title="Organization">
            <p>{snapshot?.draft.company?.providerType || "Not supplied"}</p>
            <p>
              {snapshot?.draft.company?.country || "—"}
              {app!.org.fictional ? " · Fictional development fixture" : ""}
            </p>
          </Panel>
        </div>
        {!sub ? (
          <Empty title="No submission to review" />
        ) : (
          <>
            <div className="p-columns">
              <Panel title="Submitted company">
                <dl className="p-definition">
                  {Object.entries(snapshot?.draft.company || {}).map(
                    ([k, v]) => (
                      <div key={k}>
                        <dt>{k.replace(/([A-Z])/g, " $1")}</dt>
                        <dd>{String(v)}</dd>
                      </div>
                    ),
                  )}
                </dl>
              </Panel>
              <Panel title="Coverage and capabilities">
                <JsonView
                  value={snapshot?.draft.coverage}
                  label="Submitted coverage"
                />
                {snapshot?.draft.capabilities?.map((c) => (
                  <div className="p-change" key={c.capabilityId}>
                    <strong>{c.rail}</strong>
                    <p>
                      {c.input.identifier} →{" "}
                      {c.output?.identifier || c.input.identifier} · {c.origin}{" "}
                      → {c.destination}
                    </p>
                    <p>
                      {c.operation} · {c.environment} · v{c.version}
                    </p>
                    <small>
                      {c.minimum}–{c.maximum} {c.limitAsset}
                    </small>
                  </div>
                ))}
              </Panel>
            </div>
            <Panel title="Evidence review">
              <p>
                Unscanned uploads stay quarantined. Fixture-only evidence is
                usable solely for fictional sandbox review.
              </p>
              <Table
                headings={["Document", "Scan", "Decision", "Expiry", "Review"]}
              >
                {data.evidence.map((e) => (
                  <tr key={e.id}>
                    <td>{e.filename}</td>
                    <td>
                      <Badge>{e.scanStatus}</Badge>
                    </td>
                    <td>
                      <Badge>{e.reviewStatus}</Badge>
                    </td>
                    <td>
                      <DateText value={e.expiresAt} />
                    </td>
                    <td>
                      <form
                        onSubmit={(event) => {
                          event.preventDefault();
                          const f = new FormData(event.currentTarget);
                          void execute({
                            action: "ops-evidence",
                            evidenceId: e.id,
                            decision: f.get("decision"),
                            reason: f.get("reason"),
                          });
                        }}
                      >
                        <select
                          name="decision"
                          aria-label={`Decision for ${e.filename}`}
                        >
                          <option>Accepted</option>
                          <option>Changes requested</option>
                          <option>Rejected</option>
                        </select>
                        <input
                          name="reason"
                          aria-label={`Review reason for ${e.filename}`}
                          required
                          placeholder="Record a reason"
                        />
                        <button className="p-button secondary">
                          Record decision
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </Table>
            </Panel>
            <Panel title="Technical test evidence">
              <Table
                headings={[
                  "Scenario",
                  "Adapter",
                  "Integration version",
                  "Result",
                ]}
              >
                {data.runs.map((r) => (
                  <tr key={r.id}>
                    <td>{r.scenario}</td>
                    <td>{r.adapter}</td>
                    <td>v{r.integrationVersion}</td>
                    <td>
                      <Badge>{r.outcome}</Badge>
                    </td>
                  </tr>
                ))}
              </Table>
              <p className="p-muted">
                Simulator success does not establish readiness for a real
                production integration.
              </p>
            </Panel>
            <div className="p-columns">
              <Panel title="Record a decision">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void execute({
                      action: "ops-review",
                      kind: f.get("kind"),
                      decision: f.get("decision"),
                      reason: f.get("reason"),
                      section: f.get("section"),
                      internalNote: f.get("internalNote"),
                    });
                  }}
                >
                  <div className="p-form-grid">
                    <Field label="Decision type">
                      <select name="kind">
                        <option value="application">Application state</option>
                        <option value="legal">Legal / compliance track</option>
                        <option value="technical">Technical track</option>
                        <option value="changes">Request changes</option>
                        <option value="note">Internal note</option>
                      </select>
                    </Field>
                    <Field label="Decision">
                      <select name="decision">
                        {[
                          "Under review",
                          "Passed",
                          "Changes requested",
                          "Approved",
                          "Rejected",
                          "Note",
                        ].map((d) => (
                          <option key={d}>{d}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Section for requested changes">
                      <select name="section">
                        {[
                          "company",
                          "coverage",
                          "capabilities",
                          "settlement",
                          "compliance",
                          "integration",
                        ].map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <Field label="Reason / provider-visible request">
                    <textarea name="reason" required />
                  </Field>
                  <Field label="Internal-only note">
                    <textarea name="internalNote" />
                  </Field>
                  <button className="p-button">Record review decision</button>
                </form>
              </Panel>
              <Panel title="Change requests & history">
                {sub.changes.map((c) => (
                  <div className="p-change" key={c.id}>
                    <h3>{c.section}</h3>
                    <p>{c.message}</p>
                    <blockquote>
                      {c.response || "Awaiting provider response"}
                    </blockquote>
                  </div>
                ))}
                {sub.reviews.map((r) => (
                  <div className="p-change" key={r.id}>
                    <strong>
                      {r.kind} · {r.decision}
                    </strong>
                    <p>{r.reason}</p>
                    {r.internalNote && (
                      <p className="p-internal">Internal: {r.internalNote}</p>
                    )}
                    <small>
                      <DateText value={r.createdAt} />
                    </small>
                  </div>
                ))}
              </Panel>
            </div>
            <Panel title="Version comparison">
              <p>
                Latest submitted v{sub.version} compared with{" "}
                {app!.submissions[1]
                  ? `previous submission v${app!.submissions[1].version}`
                  : "the current draft"}
                .
              </p>
              <div className="p-form-grid">
                <JsonView
                  value={sub.snapshot}
                  label={`Submitted v${sub.version}`}
                />
                <JsonView
                  value={app!.submissions[1]?.snapshot || app!.draft}
                  label={
                    app!.submissions[1]
                      ? "Previous submission"
                      : "Current draft"
                  }
                />
              </div>
            </Panel>
            <Panel title="Activation & registry publication">
              <Field label="Activation environment">
                <select
                  value={environment}
                  onChange={(e) => setEnvironment(e.target.value)}
                >
                  <option value="sandbox">Sandbox simulator</option>
                  <option value="production">Production</option>
                </select>
              </Field>
              <ul className="p-gates">
                {(environment === "sandbox"
                  ? data.sandboxGates
                  : data.productionGates
                ).map((g) => (
                  <li key={g}>{g}</li>
                ))}
              </ul>
              {!(
                environment === "sandbox"
                  ? data.sandboxGates
                  : data.productionGates
              ).length && (
                <p>Prerequisites satisfied for the local sandbox simulator.</p>
              )}
              {admin && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void execute({
                      action: f.get("action"),
                      environment,
                      reason: f.get("reason"),
                    });
                  }}
                >
                  <Field label="Reason">
                    <textarea name="reason" required />
                  </Field>
                  <Field label="Action">
                    <select name="action">
                      <option value="ops-activate">Request publication</option>
                      <option value="ops-suspend">
                        Suspend / withdraw eligibility
                      </option>
                    </select>
                  </Field>
                  <button className="p-button">
                    Record activation decision
                  </button>
                </form>
              )}
              <Table
                headings={[
                  "Environment",
                  "Sequence",
                  "Action",
                  "State",
                  "Acknowledged",
                ]}
              >
                {data.activations.map((a) => (
                  <tr key={a.id}>
                    <td>{a.environment}</td>
                    <td>{a.sequence}</td>
                    <td>{a.action}</td>
                    <td>
                      <Badge>
                        {a.state === "Pending"
                          ? "Propagation pending"
                          : a.state}
                      </Badge>
                    </td>
                    <td>
                      <DateText value={a.acknowledgedAt} />
                    </td>
                  </tr>
                ))}
              </Table>
              {data.jobs.map((j) => (
                <div className="p-change" key={j.id}>
                  <p>
                    {j.key} · <Badge>{j.state}</Badge> · {j.attempts} attempts
                  </p>
                  {j.error && <p>{j.error}</p>}
                  {j.state === "Failed" && admin && (
                    <Action
                      label="Retry publication"
                      run={() =>
                        execute({
                          action: "ops-retry-publication",
                          jobId: j.id,
                        })
                      }
                    />
                  )}
                </div>
              ))}
            </Panel>
          </>
        )}
      </>
    );
  }
  return (
    <div className="portal p-shell">
      <aside className={`p-sidebar ${menu ? "open" : ""}`}>
        <Link href="/ops/applications" className="p-logo">
          <BrandLogo reverse />
        </Link>
        <div className="p-workspace-label">
          <ShieldCheck size={16} /> Internal operations
        </div>
        <nav aria-label="Internal navigation">
          <div>
            <h2>Review & operations</h2>
            {[
              ["applications", "Applications"],
              ["providers", "Providers"],
              ["provider-requests", "Access requests"],
              ["requirements", "Requirements"],
              ["audit-log", "Audit log"],
              ["payments", "Payments"],
              ["merchants", "Merchants"],
              ["partners", "Partner programmes"],
              ["treasury", "Treasury"],
              ["marketing", "Email Marketing"],
            ].map(([path, label]) => (
              <Link
                href={`/ops/${path}`}
                key={path}
                className={route.startsWith(path) ? "active" : ""}
              >
                {label}
              </Link>
            ))}
          </div>
        </nav>
        <div className="p-sidebar-bottom">
          <span>{data.me.name}</span>
          <small>{data.me.internalRole}</small>
          <Link href="/provider/settings">Account & MFA settings</Link>
        </div>
      </aside>
      <div className="p-workarea">
        <header className="p-topbar">
          <button
            className="p-mobile-toggle"
            aria-label="Toggle navigation"
            onClick={() => setMenu(!menu)}
          >
            <Menu />
          </button>
          <strong>Operations console</strong>
          <span className="p-muted">MFA required · Internal access</span>
        </header>
        <div className="p-content">
          <div className="p-page-heading">
            <h1>{title}</h1>
            <button
              aria-label="Refresh console"
              className="p-icon-button"
              onClick={() => router.refresh()}
            >
              <RefreshCw size={18} />
            </button>
          </div>
          {data.local && (
            <div className="p-environment-note">
              Local development · Fictional review data
            </div>
          )}
          {notice && (
            <div className="p-notice" role="status">
              {notice}
            </div>
          )}
          <div className="p-stack">
            {app ? (
              review()
            ) : route === "requirements" ? (
              <>
                <Panel title="Template versions">
                  <Table
                    headings={["Requirement", "Version", "Scope", "State"]}
                  >
                    {data.requirements.map((r) => (
                      <tr key={r.id}>
                        <td>
                          {r.name}
                          <small>
                            {r.illustrative
                              ? "Illustrative"
                              : "Configured requirement"}
                          </small>
                        </td>
                        <td>{r.version}</td>
                        <td>
                          <JsonView value={r.scope} label="Applicability" />
                        </td>
                        <td>{r.active ? "Current" : "Superseded"}</td>
                      </tr>
                    ))}
                  </Table>
                </Panel>
                {admin && (
                  <Panel title="Create a new template version">
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        void execute({
                          action: "ops-requirement",
                          templateId: f.get("templateId"),
                          name: f.get("name"),
                          scope: {
                            providerTypes: f.get("providerType")
                              ? [f.get("providerType")]
                              : [],
                            countries: f.get("country")
                              ? [f.get("country")]
                              : [],
                            methods: f.get("method") ? [f.get("method")] : [],
                            operations: f.get("operation")
                              ? [f.get("operation")]
                              : [],
                          },
                        });
                      }}
                    >
                      <div className="p-form-grid">
                        <Field label="Stable template identifier">
                          <input name="templateId" required />
                        </Field>
                        <Field label="Requirement name">
                          <input name="name" required />
                        </Field>
                        <Field label="Provider type">
                          <select name="providerType">
                            <option value="">All provider types</option>
                            {providerTypes.map((t) => (
                              <option key={t}>{t}</option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Country">
                          <select name="country">
                            <option value="">All countries</option>
                            {countries.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Payment family">
                          <select name="method">
                            <option value="">All families</option>
                            {[
                              "bank",
                              "card",
                              "mobile-money",
                              "stablecoin",
                              "crypto",
                              "local",
                            ].map((s) => (
                              <option key={s}>{s}</option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Operation">
                          <select name="operation">
                            <option value="">All operations</option>
                            {[
                              "pay-in",
                              "payout",
                              "conversion",
                              "authorization",
                              "settlement",
                            ].map((s) => (
                              <option key={s}>{s}</option>
                            ))}
                          </select>
                        </Field>
                      </div>
                      <button className="p-button">
                        Create template version
                      </button>
                    </form>
                  </Panel>
                )}
              </>
            ) : route === "audit-log" ? (
              <AuditView data={data} />
            ) : (
              <>
                <Panel title="Filter queue">
                  <form className="p-form-grid" action={`/ops/${route}`}>
                    <Field label="Application state">
                      <select name="state">
                        <option value="">All states</option>
                        {[
                          "Draft",
                          "Submitted",
                          "Under review",
                          "Changes requested",
                          "Resubmitted",
                          "Approved",
                          "Rejected",
                        ].map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Provider type">
                      <select name="type">
                        <option value="">All types</option>
                        {providerTypes.map((t) => (
                          <option key={t}>{t}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Requested market">
                      <select name="market">
                        <option value="">All markets</option>
                        {countries.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Reviewer">
                      <select name="reviewer">
                        <option value="">Any reviewer</option>
                        {data.reviewers.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Submitted on or after">
                      <input type="date" name="from" />
                    </Field>
                    <button className="p-button">Apply filters</button>
                  </form>
                </Panel>
                <Panel
                  title={
                    route === "providers"
                      ? "Provider organizations"
                      : "Applications"
                  }
                >
                  <Table
                    headings={[
                      "Organization",
                      "Provider type",
                      "State",
                      "Submitted version",
                      "Updated",
                      "",
                    ]}
                  >
                    {data.applications.map((a) => (
                      <tr key={a.id}>
                        <td>
                          <strong>{a.org.name}</strong>
                          <small>
                            {a.org.fictional
                              ? "Fictional development fixture"
                              : "Provider organization"}
                          </small>
                        </td>
                        <td>
                          {(a.draft as Draft).company?.providerType || "—"}
                        </td>
                        <td>
                          <Badge>{a.state}</Badge>
                        </td>
                        <td>{a.submissions[0]?.version || "—"}</td>
                        <td>
                          <DateText value={a.updatedAt} />
                        </td>
                        <td>
                          <Link
                            className="p-link"
                            href={`/ops/${route === "providers" ? "providers" : "applications"}/${a.id}`}
                          >
                            Review →
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </Table>
                </Panel>
              </>
            )}
            {app && <AuditView data={data} />}
          </div>
        </div>
      </div>
    </div>
  );
}
function AuditView({ data }: { data: OpsData }) {
  return (
    <Panel title="Audit timeline">
      <Table headings={["Action", "Actor", "Target", "Time"]}>
        {data.audit.map((a) => (
          <tr key={a.id}>
            <td>
              {a.action}
              {a.internal && <small>Internal only</small>}
            </td>
            <td>{a.actorId}</td>
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
}
