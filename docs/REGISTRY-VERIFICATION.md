# Provider backend verification — 18 September 2026

Baseline commit: `da7d9ab111f1071b74dade39ce81a644be66feff`. The earlier portal implementation was already present as uncommitted work. It was preserved and extended; the audit distinguishes that baseline from this task.

| Check | Actual result |
|---|---|
| `npm run db:migrate` | Both additive migrations applied successfully to existing local PostgreSQL 17; no reset |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed |
| `npm test` | 42 tests passed |
| `npm run build` | Production Next.js build passed; final error-code-only adjustment rebuilt separately |
| `npm run test:portal -- registry.spec.ts` | 1 complete database/API scenario passed against the production build |
| `npm run test:portal -- portal.spec.ts` | All 5 existing portal journeys passed against the production build |
| `git diff --check` | Passed |

The final API adjustment adds stable `code` fields to existing validation/domain error responses; it preserves status and error message compatibility. Type checking and lint passed after this adjustment. The six browser/API journeys ran immediately before that response-field-only adjustment.

The database scenario exercises actual authenticated portal commands, immutable submissions, separate legal/technical/application approval, activation and durable outbox processing. Three fictional providers cover two NGN bank-transfer pay-in candidates with different limits and a separate network-specific USDC candidate. Assertions cover:

- Draft/approval/activation/publication distinctions and complete approved profiles.
- Concurrent duplicate publication and a crash boundary after registry commit but before worker acknowledgment.
- Duplicate/conflicting events, out-of-order sequences, future timestamps and simulated-production rejection.
- Trusted transaction context, safe response redaction and selected-method revalidation.
- One provider offline while the second remains eligible; suspension before publication delivery; positive reports unable to bypass restrictions.
- Unrelated methods excluded, mandatory observations stale, expired/mismatched evaluations rejected.
- Proposed edits preserving the live capability version.
- Older publication unable to overwrite withdrawal; suspension while republish is pending.
- Explicit approved rollback under revision 5, preserving all earlier revisions.
- Reconciliation restoring a missing outbox job; database rejection of published-profile mutation.
- Protected registry queries, operator-only context authoring and cross-tenant denial.

Unit coverage includes the 25 baseline tests plus exact transaction/precision boundaries, directional and network matching, complete settlement, no implicit conversion/composition, production isolation, unknown versus actionable verification, scope-specific observations, capacity/maintenance/restriction precedence, all 25 mixed-status pairs, deterministic input-order independence, no input mutation, safe output boundaries, resource limits, DST gaps/repeated hours, supporting compliance expiry and adapter conformance/error redaction/cancellation.

The existing browser journeys also verify role/MFA boundaries, credentials and document quarantine, CSRF, signup/invitations, all provider routes, responsive screenshots and accessibility. One old expectation was intentionally changed: a free-text legacy capability must now display Not ready and require a reviewed complete fulfillment profile, rather than imply transaction eligibility.

Operational issues encountered: the sandbox blocked PostgreSQL shared memory/database access and stalled the first Turbopack build. Approved local execution outside the sandbox completed database migrations and production builds. No production services were contacted. Test records are fictional sandbox records in the existing local database; existing records were not reset. Reconciliation also filled missing registry projections for historical local snapshots without rewriting their immutable content.

Not executed: real-provider conformance/certification, production deployment, production secret/scanner integration, load testing, external security assessment, or the separate marketing Playwright suite. The existing marketing unit tests passed; marketing implementation files were not changed by this task. No real payments, fund movement, routing ranking or settlement execution were added.

See [Provider backend reference](PROVIDER-BACKEND.md) for architecture, schemas, freshness configuration, adapter extension, failure behavior, operational investigation, sandbox instructions and remaining production prerequisites. See [Repository audit](REGISTRY-AUDIT.md) for reuse evidence.
