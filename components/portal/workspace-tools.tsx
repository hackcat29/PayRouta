"use client";
import { useRouter } from "next/navigation";
import type { WorkspaceData } from "@/lib/portal/queries";
import { can, roles } from "@/lib/portal/domain";
import { Action, DateText, Field, Modal, Table } from "./ui";
import { Badge, Empty, Panel } from "./provider-ui";
import type { Execute } from "./forms";
import { errorText, offline } from "@/lib/error-copy";
export function Compliance({
  data,
  execute,
  setNotice,
}: {
  data: WorkspaceData;
  execute: Execute;
  setNotice: (s: string) => void;
}) {
  const router = useRouter();
  const allowed = can(data.role || "Analyst", "compliance");
  return (
    <>
      <div className="p-notice">
        Development requirements are illustrative. Accepted evidence records a
        review decision; it is not proof of regulatory authorization.
      </div>
      <Panel title="Applicable requirements">
        {data.requirements?.map((r) => (
          <div className="p-requirement" key={r.id}>
            <div>
              <strong>{r.name}</strong>
              <small>
                Template v{r.version}
                {r.illustrative
                  ? " · Illustrative development requirement"
                  : ""}
              </small>
            </div>
            <Badge>
              {data.evidence?.find((e) => e.requirementId === r.id)
                ?.reviewStatus || "Not provided"}
            </Badge>
          </div>
        ))}
      </Panel>
      {allowed && (
        <Panel title="Upload evidence">
          <p>
            PDF, PNG, or JPEG · Maximum 5 MB. Use fictional documents during
            development. Files are private and quarantined before review access.
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              try {
                const res = await fetch(
                  `/api/portal/evidence?org=${data.org!.id}`,
                  { method: "POST", body: form },
                );
                const result = await res.json().catch(() => null);
                setNotice(res.ok ? result?.message : errorText(result, res.status));
                router.refresh();
              } catch {
                setNotice(offline);
              }
            }}
          >
            <div className="p-form-grid">
              <Field label="Requirement">
                <select name="requirementId" required>
                  {data.requirements?.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} v{r.version}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Document type">
                <input
                  name="documentType"
                  placeholder="e.g. Company registration"
                  required
                />
              </Field>
              <Field label="Issuing jurisdiction">
                <input
                  name="jurisdiction"
                  minLength={2}
                  maxLength={2}
                  placeholder="NG"
                  required
                />
              </Field>
              <Field label="Document identifier">
                <input name="identifier" />
              </Field>
              <Field label="Issue date">
                <input name="issueDate" type="date" />
              </Field>
              <Field label="Expiry date, if applicable">
                <input name="expiryDate" type="date" />
              </Field>
              <Field label="Supported capability identifiers">
                <input name="capabilities" placeholder="ng-bank-payin" />
              </Field>
              <Field label="Evidence file">
                <input
                  name="file"
                  type="file"
                  accept="application/pdf,image/png,image/jpeg"
                  required
                />
              </Field>
            </div>
            <button className="p-button">Upload to private quarantine</button>
          </form>
        </Panel>
      )}
      {allowed && data.local && data.org?.fictional && (
        <Panel title="Fictional review fixture">
          <p>
            Use a clearly marked fixture to exercise the local review workflow
            while uploaded documents remain quarantined.
          </p>
          {data.requirements
            ?.filter((r) => r.illustrative)
            .map((r) => (
              <Action
                key={r.id}
                label={`Attach fixture: ${r.name}`}
                run={() =>
                  execute({ action: "fixture-evidence", requirementId: r.id })
                }
              />
            ))}
        </Panel>
      )}
      <Panel title="Evidence register">
        {data.evidence?.length ? (
          <Table
            headings={["Document", "Scan", "Review", "Expiry", "Retention", ""]}
          >
            {data.evidence.map((e) => (
              <tr key={e.id}>
                <td>{e.filename}</td>
                <td>
                  <Badge>{e.scanStatus}</Badge>
                </td>
                <td>
                  <Badge>
                    {e.expiresAt && new Date(e.expiresAt) < new Date()
                      ? "Expired"
                      : e.reviewStatus}
                  </Badge>
                </td>
                <td>
                  <DateText value={e.expiresAt} />
                </td>
                <td>
                  <DateText value={e.retentionUntil} />
                </td>
                <td>
                  <Action
                    label="Download"
                    disabled={e.scanStatus !== "Clean"}
                    run={async () => {
                      const res = await fetch(`/api/portal/evidence/${e.id}`, {
                        method: "POST",
                      });
                      const r = await res.json().catch(() => null);
                      if (r?.url) window.open(r.url, "_blank", "noopener");
                      else setNotice(errorText(r, res.status));
                    }}
                  />
                  <Action
                    label="Delete"
                    danger
                    run={async () => {
                      const res = await fetch(`/api/portal/evidence/${e.id}`, {
                        method: "DELETE",
                      });
                      const r = await res.json().catch(() => null);
                      setNotice(res.ok ? r?.message : errorText(r, res.status));
                      router.refresh();
                    }}
                  />
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty
            title={
              allowed ? "No documents uploaded" : "Evidence access restricted"
            }
          >
            {allowed
              ? "Upload evidence for each applicable requirement."
              : "An Owner, Admin, or Compliance member manages evidence."}
          </Empty>
        )}
      </Panel>
    </>
  );
}
export function Credentials({
  data,
  execute,
  environment,
}: {
  data: WorkspaceData;
  execute: Execute;
  environment: string;
}) {
  const allowed = can(data.role || "Analyst", "integration");
  function form(replaceId?: string, kind?: string) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void execute({
            action: "save-credential",
            environment,
            replaceId,
            kind: kind || f.get("kind"),
            label: f.get("label"),
            value: f.get("value") || undefined,
          });
          e.currentTarget.reset();
        }}
      >
        <Field label="Credential purpose">
          <select
            name="kind"
            defaultValue={kind || "outbound"}
            disabled={!!kind}
          >
            <option value="outbound">PayRouta calls your provider</option>
            <option value="inbound">Your provider calls PayRouta</option>
            <option value="event">Incoming event signature verification</option>
          </select>
        </Field>
        <Field label="Safe label">
          <input name="label" required maxLength={80} />
        </Field>
        <Field
          label="External secret"
          hint="Leave empty for a generated inbound API credential. External values cannot be retrieved after saving."
        >
          <input name="value" type="password" autoComplete="new-password" />
        </Field>
        <button className="p-button">
          {replaceId ? "Rotate credential" : "Save credential"}
        </button>
      </form>
    );
  }
  return (
    <>
      <div className="p-notice">
        Fresh MFA verification is required. Local encrypted storage is
        development-only and cannot satisfy production readiness.
      </div>
      <Panel
        title={`${environment} credentials`}
        action={
          allowed && (
            <Modal title="Add credential" label="Add credential">
              {form()}
            </Modal>
          )
        }
      >
        {data.credentials?.length ? (
          <Table
            headings={["Label", "Purpose", "Backend", "Updated", "Status", ""]}
          >
            {data.credentials.map((c) => (
              <tr key={c.id}>
                <td>{c.label}</td>
                <td>{c.kind}</td>
                <td>{c.backend}</td>
                <td>
                  <DateText value={c.createdAt} />
                </td>
                <td>
                  <Badge>{c.revokedAt ? "Revoked" : "Configured"}</Badge>
                </td>
                <td>
                  {!c.revokedAt && allowed && (
                    <>
                      <Modal label="Rotate" title="Rotate credential">
                        {form(c.id, c.kind)}
                      </Modal>
                      <Action
                        label="Revoke"
                        danger
                        run={() =>
                          execute({
                            action: "revoke-credential",
                            credentialId: c.id,
                          })
                        }
                      />
                    </>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty title="No credentials configured">
            Keep provider access, inbound API credentials, and event secrets
            separate.
          </Empty>
        )}
      </Panel>
    </>
  );
}
export function Team({
  data,
  execute,
  invitation,
}: {
  data: WorkspaceData;
  execute: Execute;
  invitation?: string;
}) {
  const allowed = can(data.role || "Analyst", "team");
  return (
    <>
      {invitation && (
        <Panel title="Organization invitation">
          <p>
            Accept only if you recognize the organization that invited this
            email address.
          </p>
          <Action
            label="Accept invitation"
            run={() =>
              execute({ action: "accept-invitation", token: invitation })
            }
          />
        </Panel>
      )}
      <Panel
        title="Members"
        action={
          allowed && (
            <Modal label="Invite member" title="Invite a colleague">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void execute({
                    action: "invite",
                    email: f.get("email"),
                    role: f.get("role"),
                  });
                }}
              >
                <Field label="Recipient email">
                  <input name="email" type="email" required />
                </Field>
                <Field label="Role">
                  <select name="role">
                    {roles
                      .filter((r) => r !== "Owner" || data.role === "Owner")
                      .map((r) => (
                        <option key={r}>{r}</option>
                      ))}
                  </select>
                </Field>
                <p>
                  Invitations expire after 48 hours and can be accepted once by
                  this email address. Fresh MFA is required to invite.
                </p>
                <button className="p-button">Create invitation</button>
              </form>
            </Modal>
          )
        }
      >
        <Table headings={["Member", "Email", "Role", ""]}>
          {data.team?.map((m) => (
            <tr key={m.id}>
              <td>{m.user.name}</td>
              <td>{m.user.email}</td>
              <td>{m.role}</td>
              <td>
                {allowed && (
                  <Modal label="Manage" title={`Manage ${m.user.name}`}>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void execute({
                          action: "member-role",
                          memberId: m.id,
                          role: new FormData(e.currentTarget).get("role"),
                        });
                      }}
                    >
                      <Field label="Role">
                        <select name="role" defaultValue={m.role}>
                          {roles.map((r) => (
                            <option key={r}>{r}</option>
                          ))}
                        </select>
                      </Field>
                      <button className="p-button">Update role</button>
                    </form>
                    <Action
                      danger
                      label="Remove member"
                      run={() =>
                        execute({ action: "member-remove", memberId: m.id })
                      }
                    />
                  </Modal>
                )}
              </td>
            </tr>
          ))}
        </Table>
      </Panel>
      <Panel title="Invitations">
        <Table headings={["Email", "Role", "Expires", "Status"]}>
          {data.invitations?.map((i) => (
            <tr key={i.id}>
              <td>{i.email}</td>
              <td>{i.role}</td>
              <td>
                <DateText value={i.expiresAt} />
              </td>
              <td>
                {i.acceptedAt
                  ? "Accepted"
                  : new Date(i.expiresAt) < new Date()
                    ? "Expired"
                    : "Pending"}
              </td>
            </tr>
          ))}
        </Table>
      </Panel>
      <Panel title="Role responsibilities">
        <p>
          <strong>Owner:</strong> organization, configuration, submission,
          membership and ownership.
        </p>
        <p>
          <strong>Admin:</strong> onboarding, operations and membership; no
          ownership changes.
        </p>
        <p>
          <strong>Developer:</strong> integration, credentials, sandbox and
          technical events.
        </p>
        <p>
          <strong>Compliance:</strong> company information, evidence and
          reviewer responses.
        </p>
        <p>
          <strong>Analyst:</strong> read-only operational records and
          performance.
        </p>
      </Panel>
    </>
  );
}
