# Payment flow audit

| Area | Current implementation | Reuse or change | Missing functionality |
|---|---|---|---|
| Identity | `lib/portal/access.ts`, `auth.ts` | Reuse verified sessions, membership, internal step-up | Merchant configuration and checkout credentials |
| Registry | `lib/portal/registry.ts`, `prisma/schema.prisma` | Reuse published profiles and withdrawal checks | Route decisions |
| Availability | `lib/portal/availability-service.ts`, `availability-engine.ts` | Reuse trusted contexts and current revalidation | Intent binding and method selection |
| Adapters | `lib/portal/provider-adapters.ts` | Preserve trusted adapter registration | Persistent execution contract |
| Simulator | `lib/portal/simulator.ts` | Extend with database-backed sandbox execution | Durable acceptance/status and customer actions |
| Queue | `lib/portal/worker.ts`, `Job` | Reuse queue and worker entry point | Payment jobs and recovery |
| Secrets / outbound | `lib/portal/adapters.ts`, `ssrf.ts` | Reuse secret manager / protected HTTP | Merchant delivery signing |
| Transactions | `Transaction`, `Settlement`, `lib/portal/queries.ts` | Populate existing provider read models | Intent, attempt, allocations, journal and reconciliation |
| UI | `components/portal/ops.tsx`, `workspace.tsx` | Preserve shells | Checkout and payment operations inspection |
| Tests | `tests/availability.test.ts`, `provider-adapters.test.ts`, `tests/portal/` | Preserve existing tests | Payment database and browser journeys |

Existing onboarding simulator scenarios instantiate a fresh in-memory provider per run; their success is not evidence of durable payment orchestration. No existing payment intent, financial journal, merchant outbox, or incoming payment inbox was found. Existing portal source is uncommitted and is retained.
