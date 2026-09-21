# Merchant stage verification — 2026-09-21

This is an implementation/qualification report, not a production-readiness or live-payment claim.

## Reuse

The implementation extends existing organization/auth/MFA, invitations, private evidence, audit, registry publication, contextual availability, payment orchestration, durable worker, merchant delivery, reconciliation and immutable journal. No second authentication system, registry, ledger, evidence store or payment processor was introduced.

## Current status

| Area | Status | Evidence / limitation |
|---|---|---|
| Merchant API and runtime/OpenAPI schemas | Implemented; verified locally | Scoped credentials, environment/tenant boundaries, fingerprints, pagination/date/method filters, exact amount strings, validated response projections |
| Node and Python SDKs | Implemented; verified locally | Private 0.1.0, configurable transport/origin, bounded read retries, uncertain writes, raw-byte webhook verification; not published |
| Merchant examples | Implemented local backend examples | Single-order in-memory association; React wrapper must be mounted on the merchant origin and registered return URL configured; no full example browser end-to-end certification |
| Merchant workspace | Implemented; browser verified locally | Environment isolation, payments, onboarding/evidence, separate merchant team roles, developer controls, bounded CSV, mobile axe and keyboard checks |
| Merchant risk | Implemented; verified locally | Serializable unique-intent reservations, review holds, restricted time-bounded override, hard denials and audit |
| Merchant live-scope review | Implemented; locally verified rejection/version paths | Exact initial NGN scope, merchant-owned accounts, accepted non-illustrative merchant evidence, published profiles, review expiry, approval/revocation. No real scope has been approved |
| Coverage rollout | Implemented qualification controls; locally verified simulator paths | Audited optimistic transitions, stage gates, accepted proof references, matching simulator runs, runtime expiry/retention checks, pause. Published capability fields remain database-immutable |
| Provider hosted boundaries | Implemented qualification clients; verified with injected transports | Paystack and Flutterwave request/status/event helpers. Not wired to real orchestration or settlement/report ingestion; worker dispatch, fact application, polling and simulator settlement now resolve the immutable integration explicitly and reject unqualified adapters |
| Analytics/operations | Partial, working local views | Authoritative journal totals, unique-intent cohorts, API/queue/inbox/delivery/unknown/journal dashboard. Full latency histograms, automated alert delivery and all requested metric aggregates remain incomplete |
| Provider sandbox end to end | Unverified | No eligible provider credentials/account settings supplied; real execution and settlement wiring also still needed |
| Approved live pilot | Not enabled | Preflight exits 2, report says Blocked, financialActionsTaken = 0 |
| Live payment | Not performed | No real participant charged, transfer initiated or provider live request made |
| Settlement/reconciliation | Simulator verified; real provider unverified | Local database regression covers existing settlement/journal logic. No live report or settlement evidence exists |
| Later market/method expansion | Not enabled | Initial live scope schema only Nigeria, NGN, bank transfer/card; stablecoin/mobile-money production qualification remains later work |

## Checks executed

| Command | Result |
|---|---|
| `npm test` | 68 passed |
| `npm run test:payments` | 14 passed against isolated local PostgreSQL |
| `npm run test:merchant` | 2 passed against isolated local PostgreSQL |
| `npm run test:merchant-browser` | 2 passed: merchant workspace and privileged qualification workflows |
| `npm run test:sdk-python` | 5 passed |
| `npm run sdk:build` | Passed |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed |
| `npm run build` | Passed with Next.js 16.3.5 / Prisma 7.10.0 |
| `git diff --check` | Passed |
| `npx tsx scripts/pilot-preflight.ts docs/pilot-plan.example.json` | Expected exit 2; blocked report, zero financial actions |

Browser qualification checks use explicitly synthetic, fictional local evidence and sandbox-run records. They prove control enforcement, not external provider qualification. Early browser runs failed because local services were stopped, and an initial rollout update exposed the immutable-profile trigger; the local migration and regression now preserve capability immutability while allowing operational rollout changes. Only final passing results are listed above.

## Remaining independent software work

1. Extend the existing execution adapter/worker contract for real hosted actions, authoritative status recovery, provider-specific verified inbox events and trusted customer contact context.
2. Implement account-specific economics/quotes and real settlement/report mapping, refunds/dispute evidence ingestion and journal reconciliation for Paystack/Flutterwave.
3. Replace the deliberately closed real software gate only after those implementations pass conformance and provider sandbox end-to-end qualification. Configuration or accepted documents must not bypass it.
4. Complete the remaining analytics dictionary aggregates, provider/worker latency measurements, automatic alerts and periodic-review reminders. General live business analytics must continue excluding pilot records.
5. Complete the deployable merchant example browser navigation loop and real pilot trace/evidence collection tooling after real execution exists.

## External dependencies

One identified merchant's eligible Paystack/Flutterwave accounts, verified ownership/account binding/platform permission, provider API/version and hosted-method settings, settlement/report access, production secret manager/storage/scanner/mail, public provider and merchant webhook endpoints, actual account minimums/fees/testing rules, named operator and refund responsibility, participant consent, verified settlement destination, and explicit exact live budget authorization. Missing credentials are not the only remaining blocker: the software work above is still required.

Review [API documentation](MERCHANT-API.md), [operations and qualification runbooks](MERCHANT-OPERATIONS.md), [pilot plan placeholders](pilot-plan.example.json), [blocked preflight report](PILOT-PREFLIGHT.json), and [initial repository audit](MERCHANT-AUDIT.md).
