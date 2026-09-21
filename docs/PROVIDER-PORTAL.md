# PayRouta provider portal

The existing marketing site and provider control plane share one Next.js application. The portal needs a Node server, PostgreSQL, and a separate worker. Static export cannot serve authentication, private documents, or these workflows; `next.config.ts` now uses the standard Next server. Existing marketing content, routes, and the optional Cloudflare enquiry function remain available.

## Run locally

Node 22.12+ and PostgreSQL 17 are recommended. One npm lockfile is used. Prisma 7.10 is pinned to the major supported by Better Auth's Prisma adapter; do not upgrade to Prisma 8 without migrating that adapter.

```sh
npm ci
npm run portal:env
npm run portal:db
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

In a second terminal:

```sh
npm run portal:worker
```

Open <http://127.0.0.1:3000/provider/sign-in>. The marketing site remains at `/`.

`portal:db` uses an isolated Homebrew PostgreSQL 17 cluster in `.local/postgres`, bound only to 127.0.0.1:55432. It does not modify an existing system cluster. Its trust authentication is for fictional local data only. To stop it: `/opt/homebrew/opt/postgresql@17/bin/pg_ctl -D .local/postgres stop`.

Alternative on a machine with Docker:

```sh
docker compose -f compose.portal.yaml up -d
```

Set `DATABASE_URL=postgresql://payrouta:local-fictional-only@127.0.0.1:55432/payrouta`, then run generation, migrations and seeding. Do not run both database options on the same port. Docker's password is an intentionally public local fixture value.

`portal:env` writes a random auth secret to ignored `.env` and creates a 0600 AES key outside the repository, in `~/.local/share/payrouta`. It preserves an existing `.env`; add missing values from `.env.example` yourself in that case. Back up the key securely if you need to preserve development secret values across cleanup/restarts. Loss of the key means those local secrets must be re-entered. Never use the local vault for production.

## Fictional accounts

All seeded accounts use **PayRouta-Local-2026!** and have MFA enabled. Obtain their current fictional authenticator code with `npm run portal:code`. The shared fixture authenticator is intentionally public test material and is never created outside explicit local setup.

| Email | Role | Organization |
|---|---|---|
| owner@harbor.example | Owner | Harbor Payments |
| developer@harbor.example | Developer | Harbor Payments |
| compliance@harbor.example | Compliance | Harbor Payments |
| analyst@harbor.example | Analyst | Harbor Payments |
| owner@cedar.example | Owner | Cedar Mobile Money |
| reviewer@payrouta.example | Internal Reviewer | Development access |
| ops@payrouta.example | Internal Operations admin | Development access |

After sign-in, go to **Settings → Verify for sensitive actions** and enter a fresh code. The resulting server-side grant lasts 15 minutes and is bound to the current session. Internal pages also require this grant. Public signup can never set an internal role; internal accounts are seeded only by the explicit development command. Provision production operators through a reviewed administrative process, not public signup.

New account verification, reset links and invitations are captured in `.local/portal/mail`. The loopback-only `/provider/dev-mail` viewer exposes these development messages. Nothing is emailed. Never expose this viewer or run `PORTAL_MODE=local` on a public host.

## Review the complete journey

1. Sign in as Harbor's owner. The seeded draft has company, coverage, a directional NGN bank pay-in capability, settlement settings and a sandbox connection.
2. Open **Requirements & evidence**. The fixture PDF is explicitly marked **Fixture only**. Actual uploads remain in quarantine while the scanner is unconfigured. You can attach a known fictional fixture to an illustrative requirement for local review; this is not a way to clear uploaded files.
3. Run scenarios in **Sandbox tests**. The worker stores every result, step and tested integration version. Refresh to see completion.
4. Submit the application. A new immutable submission is created; the editable draft version increments.
5. Sign in as an internal operator, verify MFA in Settings, and open `/ops/applications`. Start review, request section-specific changes, and inspect the provider's response and resubmission.
6. Record separate legal and technical passes, accept the fictional evidence for local review, then approve the submitted version.
7. As Operations admin, request **Sandbox simulator** publication. The outbox shows pending until the worker receives local registry acknowledgement. Retry a failed job without creating another registry version.
8. Inspect provider application status, published snapshot, sandbox transactions, settlement timeline and metrics. Change the proposed capability: the published snapshot stays unchanged.
9. Select **Production**. Operational tables are empty. Activation lists unsatisfied real-service gates and cannot be bypassed by simulator results.

Legacy sandbox scenario records remain available as historical diagnostics. They do not establish transaction eligibility. Complete fulfillment profiles receive separately scoped health, method availability and remaining-capacity observations from the background adapter worker. Free-text legacy capabilities require a new reviewed profile before availability matching. The availability screen reports operational readiness; trusted transaction evaluation additionally checks amount, corridor, verification, settlement and merchant policy. See [Provider backend reference](PROVIDER-BACKEND.md) for contracts, freshness, migration and test instructions.

The simulator does not process payments. It explicitly exercises authentication, manifest validation, pre-execution exclusion, exact limits, uncertain execution, request idempotency, signed event ordering and delayed settlement. A timeout leaves execution uncertain; it does not issue a new execution or fail over.

## Authorization matrix

Every command authorizes the current server session and an actual organization membership. A submitted organization ID selects a tenant but grants no access.

| Action | Owner | Admin | Developer | Compliance | Analyst |
|---|---|---|---|---|---|
| Operational records | Read | Read | Read | Read | Read |
| Company draft | Edit | Edit | — | Edit | — |
| Coverage / capabilities / settlement / availability | Edit | Edit | — | — | — |
| Evidence and reviewer responses | Edit | Edit | — | Edit | — |
| Integration / credentials / sandbox / events | Edit | Edit | Edit | — | — |
| Submit | Yes | Yes | — | — | — |
| Invite / manage ordinary members | Yes | Yes | — | — | — |
| Ownership changes | Yes | — | — | — | — |

Credentials and membership actions require fresh MFA. Last-owner protection runs in a serializable transaction. Invitations store only a token hash, expire after 48 hours, and bind the recipient email and organization; acceptance is single-use. Internal Reviewers can assess applications and evidence. Only Operations admins can activate, suspend, change templates or retry publication. Internal notes are excluded from provider queries.

Better Auth supplies password hashing, verified email, TOTP, recovery codes and database sessions. Sessions are HTTP-only, SameSite=Lax, eight hours; secure cookies are required outside local mode. Sensitive actions separately verify a six-digit TOTP before issuing the short-lived session grant. The application never uses browser storage for secrets or authorization.

## Backend contracts

`POST /api/portal/command` accepts JSON with an `action`, selected `orgId` for provider actions, and action-specific validated fields. The origin must match `BETTER_AUTH_URL`; bodies are limited to 64 KiB and read under a deadline. Safe errors use 400, 401, 403, 404, 409, 413, 429 or 503. No client-supplied role grants permission.

- `create-organization`, `save-section`, `save-capability`, `remove-capability`.
- `submit` requires a draft `version` and UUID `key`. Retry the same key to recover the same submission.
- `respond` appends the response and an audit event; recorded responses cannot silently be overwritten.
- `sandbox-run` requires a scenario and UUID `key`; duplicate requests share one run.
- `check-endpoint` queues a version-specific health check; it does not claim full integration readiness.
- `save-credential`, `revoke-credential`, `invite`, `member-role`, `member-remove` require step-up.
- `accept-invitation`, `availability`, `replay-event` (sandbox only), `retry-job`.
- `ops-review`, `ops-evidence`, `ops-requirement`, `ops-activate`, `ops-suspend`, `ops-retry-publication` require internal authorization.

Draft edits compare versions inside serializable transactions. Submission snapshots include the full draft, applicable requirement versions, referenced evidence hashes and integration versions. PostgreSQL rejects updates/deletes to submissions, validates role/state values and financial amount strings, and enforces settlement/transaction tenant consistency. Monetary calculations use integer units with 18 decimal places, never floating point.

`POST /api/portal/evidence?org=…` accepts bounded multipart uploads. Only PDF/PNG/JPEG with matching signatures are accepted. Random private object keys, metadata, SHA-256, expiry and retention deadline are persisted before a scan job is scheduled. `POST /api/portal/evidence/:id` issues a 60-second download URL only after a Clean scan. `GET` rechecks the session, membership/internal grant, scan state and signed user-bound expiry. Downloads are attachments with no-store; link issuance and access are audited. `DELETE` immediately removes access and queues physical deletion. Worker retention runs periodically. An expired document cannot satisfy activation.

The outbox claims durable jobs atomically, recovers abandoned one-minute leases, records attempts and safe failure reasons, and supports explicit retry. Registry acknowledgement and activation status are persisted together. Publication keys and organization/environment sequence numbers are unique; the registry projection applies monotonically increasing revisions. Pending withdrawal blocks eligibility immediately, before worker acknowledgment. Proposed edits never modify the live snapshot.

## Adapter boundaries

| Boundary | Working local implementation | Production requirement |
|---|---|---|
| `MailAdapter` | Private filesystem capture; loopback viewer | Implement a verified-sender transactional mail service; return delivered only after acceptance, provide retry/monitoring policy |
| `PrivateStorage` | Private local files, outside public assets | S3-compatible private bucket using `S3_BUCKET`, `S3_REGION`, optional operator-controlled `S3_ENDPOINT`, AWS SDK credential chain; encryption enabled; configure IAM, lifecycle and access logging |
| `DocumentScanner` | Fail-closed Pending scan; no fake malware clearance | Implement an isolated malware scanner and quarantine policy; only a positive clean result may permit downloads/review |
| `SecretManager` | AES-256-GCM files, external 32-byte key; DB stores references | Implement managed secret backend, access policy, rotation and recovery; local backend can never satisfy production readiness |
| `ProviderAdapter` | Deterministic local simulator with persisted scenarios | Implement actual provider sandbox contract tests and trusted production-readiness evidence for the exact integration version |
| `RegistryAdapter` | PostgreSQL immutable snapshots, ordered current projection, idempotency and reconciliation | Same registry; production activation still requires real provider, secret and compliance integrations |
| Worker | PostgreSQL jobs/outbox with leases and retries | Supervise a separate worker process, alert on failed/stuck jobs, run maintenance and backup procedures |

The constrained HTTPS health worker rejects loopback, private, link-local, multicast, mapped-private IPv6 and non-public DNS results. It re-resolves on execution, pins the validated address into TLS with the original SNI, follows no redirects, restricts ports, limits responses to 64 KiB, and times out. No localhost exception exists; local tests call the in-process simulator. Deploy the worker with an egress firewall as defense in depth. Health reachability is not proof of authenticated payment integration.

Inbound API credentials are generated once and stored only as SHA-256 verifiers of high-entropy random values. Outbound credentials and event secrets store only secret references in PostgreSQL. Values are never returned from the credential interface, logged, or included in audits. Revocation prevents future selection; physical retired-secret cleanup should follow the managed backend retention policy.

## Verification

Start the local app and worker, then run:

```sh
npm test
npm run test:portal
npm run typecheck
npm run lint
npm run build
npx playwright test
```

Portal acceptance tests use **fictional local fixtures only** and clear the local rate-limit table between independent journeys; they are blocked outside local mode. They create uniquely named test organizations and leave their immutable submissions available for inspection. The marketing Playwright suite additionally starts port 3001 for enquiry-delivery UI tests. No real messages or payments are sent.

Screenshots are saved under `test-results/portal-*.png` (retained final copies in `.local/review/`): onboarding, capability form, application review, transaction detail and internal review at desktop/mobile sizes. Browser acceptance includes axe checks and overflow checks. See `PORTAL-VERIFICATION.md` for actual run results.

## Production readiness

Implemented: account verification/MFA/session gates; tenant and role authorization; persistent versioned drafts; immutable submissions; directional exact-money capabilities; requirement/evidence lifecycle and quarantine; private storage/download authorization; separated credential purposes; local encrypted secrets; durable sandbox/scan/check/publication jobs; review/change history; explicit activation and suspension outbox; scoped operational views; in-app notices; safe empty production states; local mail capture; audit events; responsive and accessible application UI.

Before a real launch:

- Use a real HTTPS `BETTER_AUTH_URL`, strong managed auth secret, `PORTAL_MODE=production`, and a least-privilege production PostgreSQL connection. Provision operators with verified identities and enrolled MFA.
- Implement and configure the production mail, malware scanner, managed secrets, provider-test and registry adapters listed above. These require real service contracts; filling environment variables alone does not enable them. Current production activation intentionally fails closed.
- Configure the private S3 bucket, credentials, encryption, retention/deletion policy and recovery process. The sample 90-day retention is a development default, not a legal policy.
- Define jurisdiction/provider/capability-specific requirement templates with qualified reviewers. Replace illustrative rules and complete a real compliance review.
- Establish authenticated production event/transaction ingestion through reviewed provider adapters. The portal currently has only fictional seeded operational data and a constrained health check; it never runs a payment processor or transfers funds.
- Deploy a Node server and a separately supervised worker with private DB/storage networking, trusted proxy header sanitization, egress restrictions, TLS, log redaction, alerts and backups. Enforce ingress body limits too.
- Run deployment-specific penetration/load/recovery checks, key-rotation drills and the full acceptance suite against isolated non-production infrastructure. Obtain deployment authorization separately.

Reference compatibility docs consulted: [Better Auth Next integration](https://better-auth.com/docs/integrations/next), [Prisma adapter](https://better-auth.com/docs/adapters/prisma), [TOTP](https://better-auth.com/docs/plugins/2fa), and [Prisma 7 / Better Auth integration](https://www.prisma.io/docs/guides/authentication/better-auth/nextjs). Local Next 16.3.5 route-handler/server-action guides were read before implementation.
