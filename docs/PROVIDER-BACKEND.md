# Provider registry and availability backend

The backend extends the existing portal, authentication, Organization, Integration, Capability, Submission, Activation, Job, RegistrySnapshot and Availability records. It adds no service, secret store, provider identity, payment execution, ranking, ledger or distributed cache. See [the repository audit](REGISTRY-AUDIT.md) for the inspected baseline and reuse evidence.

## Architecture decision

Use immutable approved portal snapshots as configuration authority. Materialize searchable `PublishedProfile` rows with a `RegistryHead` revision in the existing PostgreSQL database. Retain RegistrySnapshot as publication history. Activation withdrawals remain the synchronous restriction authority. Extend Availability with scoped operational evidence instead of adding a competing observation store.

`availability-engine.ts` is a pure function of validated context, published candidates, observations and supplied time. `availability-service.ts` resolves trusted context and reads all dependencies in one serializable transaction. It batches observations, organization and compliance evidence reads; it never calls providers. `provider-probes.ts` runs in the existing worker. `provider-adapters.ts` isolates upstream payloads and normalized operational contracts. Existing command authorization protects all HTTP entry points.

Payment order remains **intent → availability → customer method choice → provider routing within that method → execution → settlement**. Evaluations reserve nothing, consume no capacity and do not create attempts. The separate marketing demo is unchanged.

## Identifiers and schema

Organization.id identifies the business; Integration.id identifies an immutable configuration, scoped to organization and environment. Multiple configurations can coexist and profiles explicitly select one. Capability uses `(orgId, capabilityId, version, environment)`. A profile has its own `profileId` within an integration/environment; adapter implementation and version are independent. Publication has a stable job key and increasing organization/environment revision. Observations, trusted contexts and evaluations have separate IDs.

The existing capability combination remains directional: `family`, controlled `rail`, `operation`, `origin`, `destination`, `input`, optional `output`, limits and environment. An additive `fulfillment` declaration is required for registry matching:

| Field | Contract |
|---|---|
| `profileId`, `integrationId`, `adapterVersion` | Explicit profile/configuration identity; version currently `1`; integration must occur in approved immutable submission |
| `method` | `bank-transfer`, `card`, `stablecoin` |
| controlled family / rail | bank / `ng-nibss`; card / `card-network`; stablecoin / `onchain` |
| `operations` | Includes declared operation and settlement exactly once; conversion also requires explicit output matching settlement |
| `inputPrecision`, `settlementPrecision` | Integer 0–18; fiat must match ISO currency precision; no network on fiat |
| `settlementAsset` | Explicit kind, standardized/namespaced identifier and network; must match submitted settlement configuration and jurisdiction |
| `verification` | `none` or `verified`; no inference from free text |
| `checks` | Health, capability availability and remaining daily capacity required in this initial model |
| `schedule` | Empty means explicitly 24/7; otherwise local-time day numbers (Sunday 0), start/end minute, start inclusive/end exclusive; no overlaps; overnight periods split at midnight |
| `provenance` | provider-declared, operator-maintained or adapter-discovered; provenance never grants approval |

Bank transfer allows pay-in, payout and settlement; card allows pay-in, authorization and settlement; stablecoin allows pay-in, payout, conversion and settlement. Reverse operations are separate declarations. Additional rails must be added to the server-controlled catalog and validation, not supplied as executable rules.

Fiat identifiers use the existing currency catalog. Blockchain identity includes both network and a namespaced contract/native identity, never a ticker alone. Exact decimal strings use BigInt scaling; float values and extra precision are rejected. Limit and capacity amounts are in the exact input asset/precision. Capacity represents remaining enforceable cumulative capacity; observations never reserve it. Cross-asset fulfillment currently returns `CONVERSION_BASIS_UNAVAILABLE`; a trusted quote/conversion-basis integration is required before such a profile can become available. No parity assumptions or cross-provider composition exist.

Forms retain the existing fields and add structured profile controls. Legacy hours, conditions and settlement prose remain descriptive and cannot supply executable policy. Validation exposes field paths, stable message codes and safe messages through the existing command route. New declarations are proposals, not approval.

## Publication, suspension and rollback

Existing `submit` snapshots capabilities, integrations and evidence. Existing review requires legal, technical and application decisions. Existing activation gates create Activation and Job atomically. Publication verifies the specific approved submission, current evidence, environment and registered adapter compatibility.

`publishActivation` writes immutable history, historical/current profiles and RegistryHead in one serializable transaction. Fingerprints use sorted-key canonical JSON. The stable key is `registry:<activationId>`. Duplicate delivery is a no-op; mismatched keys/payloads conflict. An older revision cannot replace the current projection. Worker acknowledgment happens afterward, so a crash after projection commit safely replays and acknowledges the same revision. Acknowledged older work is marked Superseded when a newer head exists.

A proposal or pending replacement leaves the current published configuration live. A withdrawal immediately blocks every older published revision, including when notification fails or a subsequent reactivation is pending. Positive reports cannot remove this restriction. Suspension can be requested during pending publication. Eligibility returns only after a newer approved publication succeeds.

`ops-republish-approved` explicitly republishes an approved historical sandbox submission under a new revision, retaining every historical record. It checks evidence, registered configuration and a passed simulator run. This controlled rollback is local fictional sandbox only; production rollback remains gated until production prerequisites exist.

`ops-registry-reconcile` paginates Activation records, reconstructs missing durable jobs and queues missing projection/acknowledgment work without stealing Running jobs. Follow `nextCursor` until null. It can backfill an existing immutable legacy RegistrySnapshot into a head; it cannot invent a fulfillment profile from free text. Failed publication is observable on Job and retryable by Operations admin. Never lower a revision or edit a snapshot to roll back.

## Observations and adapters

Availability rows now optionally carry integration/configuration ID, capability version, observation type, trust, event key, monotonic sequence, observed time and normalized value. Legacy null-scoped rows remain historical diagnostics. New ingestion requires a currently published exact scope and matching environment. Operator restrictions require operator trust. Simulated evidence is rejected in production. Health is scoped separately from capability availability: a reachable API cannot mark every method healthy.

Event identity is scoped to organization, environment, integration and source trust. Identical retries return the original ID; reused event IDs with different content conflict. Lower/equal sequences or regressing observed timestamps are ignored without replacing newer state. Future timestamps over five seconds are rejected; observations within skew tolerance do not count before observedAt. An expired newest record does not resurrect an older healthy record.

Default maximum evidence lifetimes:

| Type | Default | Environment override |
|---|---|---|
| health | 60 seconds | `AVAILABILITY_HEALTH_TTL_MS` |
| availability | 60 seconds | `AVAILABILITY_AVAILABILITY_TTL_MS` |
| capacity | 30 seconds | `AVAILABILITY_CAPACITY_TTL_MS` |
| maintenance | 5 minutes | `AVAILABILITY_MAINTENANCE_TTL_MS` |
| restriction | 5 minutes | `AVAILABILITY_RESTRICTION_TTL_MS` |

Overrides accept 1–300 seconds. Provider portal reports retain their requested 5–1440 minute TTL and can reduce eligibility; positive provider reports cannot satisfy mandatory independent evidence. Persistent suspension uses Activation, not an expiring observation. Missing/stale mandatory evidence is UNKNOWN. Optional adapter discovery/webhooks can be unsupported without creating a mandatory unknown check.

The worker refreshes a bounded page of up to 20 profiles every 15 seconds, cycling by ID, with one probe at a time, a one-second probe deadline and a 15-second page budget (an in-progress profile may finish). Errors do not create healthy evidence. Large registries or short TTLs can conservatively become UNKNOWN; measure refresh lag before increasing throughput. Normal evaluation is capped at 500 candidates, 10,000 latest observations, a 15-second database transaction and a 64 KiB request. Administrative registry pages cap at 100. No distributed cache is used.

To extend adapters:

1. Implement ProviderAdapter in server code and explicitly register it. Never load code paths from manifests.
2. Declare immutable ID/version, allowed environments and supported operations. Validate configuration before activation.
3. Use injected HTTP, credential-reference resolver, clock and telemetry. Reuse `checkEndpoint` for DNS validation/pinned TLS, HTTPS-only port 443, 64 KiB maximum, no redirects and cancellation. Do not use unconstrained fetch.
4. Return normalized health/availability/capacity or declarations. The wrapper validates the result, enforces a bounded timeout, propagates cancellation and emits safe codes; raw responses/messages are discarded.
5. Run `adapterConformance` in `tests/provider-adapters.test.ts` with the adapter's declared operations/configuration. Add real provider documentation-backed tests before enabling production. Payment execution is deliberately absent from this observation contract.

Error categories: UNSUPPORTED_OPERATION, INVALID_CONFIGURATION, AUTHENTICATION_FAILURE, AUTHORIZATION_FAILURE, RATE_LIMITED, TIMEOUT, NETWORK_FAILURE, MALFORMED_RESPONSE, PROVIDER_UNAVAILABLE, UNKNOWN_PROVIDER_ERROR. Diagnostic IDs must be server-generated. The current trusted implementation is the fictional simulator only. There are no guessed third-party API implementations or automatic execution retries.

## Trusted context and APIs

There is no implemented merchant/payment-intent backend in the audited repository. AvailabilityContext therefore stores authenticated server-authored context linked to the existing Organization, rather than inventing a second merchant identity/auth system. Operations admins with fresh MFA author contexts for controlled integration now; a future merchant/intent service must derive and persist these values from its own trusted records.

Context includes merchant identity, reference, environment, exact amount/input/precision, nullable payer country, merchant jurisdiction, ordered permitted methods, required operation, explicit settlement asset, nullable verified status, whether verification is an actionable customer step, blocked methods, optional provider allowlist, policy version and validity. Context validity is at most one hour. Checkout supplies only a context ID. Body-supplied KYC, permissions, amount or production claims cannot override the persisted context.

All commands use `POST /api/portal/command`, existing CSRF/session/MFA and rate limits:

| Action | Authorization | Body beyond action/orgId |
|---|---|---|
| `evaluate-availability` | Organization member, read permission | `contextId` |
| `availability-explanation` | Same organization member | `evaluationId`; returns safe view only |
| `ops-availability-context` | Operations admin + step-up | `value`: trusted context |
| `ops-availability-explain` | Operations admin + step-up | `evaluationId`; includes internal trace |
| `ops-observation` | Operations admin + step-up | `value`: observationSchema; trust fixed to operator |
| `ops-registry-query` | Operations admin + step-up | `query`: environment, optional indexed dimensions, current (default true; false reads history), cursor, limit 1–100; scoped by orgId |
| `ops-registry-reconcile` | Operations admin + step-up | Optional cursor; follow nextCursor |
| `ops-republish-approved` | Operations admin + step-up | submissionId, reason; local sandbox only |

Existing provider `availability` reports are scoped through published profiles and written atomically with the existing audit event. No unauthenticated observation endpoint is added. Adapter/event integrations call trusted ingestion with a server-selected trust level after authentication/signature verification; unsupported verify-event operations are typed failures.

Safe results contain evaluation ID, evaluatedAt, expiresAt, merchant-ordered method IDs/display labels, status, safe explanation and explicit customer action where meaningful. They omit providers, capability IDs, commercial data, metrics, compliance documents, secrets and upstream responses. Internal traces retain candidate identities, profile and publication revision, policy version, all exclusion reasons and observation IDs/source/freshness/timestamps. Evaluation traces and trusted context retain no customer name/email/KYC documents. Traces expire from storage after seven days; contexts are deleted seven days after expiry. Retention runs in the existing worker.

## Decision model

Within a candidate, hard structural/policy restrictions dominate temporary blockers, then unknown evidence, then customer action. Every applicable reason is retained. Across candidates of the same method, choose the best viable result using this explicit table:

| A / B | AVAILABLE | ACTION_REQUIRED | UNKNOWN | TEMPORARILY_UNAVAILABLE | UNAVAILABLE |
|---|---|---|---|---|---|
| AVAILABLE | AVAILABLE | AVAILABLE | AVAILABLE | AVAILABLE | AVAILABLE |
| ACTION_REQUIRED | AVAILABLE | ACTION_REQUIRED | ACTION_REQUIRED | ACTION_REQUIRED | ACTION_REQUIRED |
| UNKNOWN | AVAILABLE | ACTION_REQUIRED | UNKNOWN | UNKNOWN | UNKNOWN |
| TEMPORARILY_UNAVAILABLE | AVAILABLE | ACTION_REQUIRED | UNKNOWN | TEMPORARILY_UNAVAILABLE | TEMPORARILY_UNAVAILABLE |
| UNAVAILABLE | AVAILABLE | ACTION_REQUIRED | UNKNOWN | TEMPORARILY_UNAVAILABLE | UNAVAILABLE |

No candidates means UNAVAILABLE / METHOD_UNSUPPORTED internally. One eligible provider suffices; unrelated methods never substitute. Unknown is preferred to a known temporary block across different providers because required evidence may resolve it. Unknown verification is not a claim that the customer has failed KYC. ACTION_REQUIRED is used only for a known unmet verification requirement with an explicit resolvable action.

| Reason | Meaning / category |
|---|---|
| PROVIDER_NOT_ACTIVE, PROVIDER_SUSPENDED | Lifecycle or immediate authoritative withdrawal; hard |
| ENVIRONMENT_MISMATCH | Wrong environment or fictional production candidate; hard |
| METHOD_UNSUPPORTED, DIRECTION_UNSUPPORTED | No supported method / operation; hard |
| CORRIDOR_UNSUPPORTED | Explicit payer-to-merchant country pair mismatch; hard |
| ASSET_OR_NETWORK_UNSUPPORTED, SETTLEMENT_UNSUPPORTED | Exact asset/network/precision or complete settlement mismatch; hard |
| FULFILLMENT_INCOMPLETE | Required operation/settlement not declared; hard |
| AMOUNT_BELOW_MINIMUM, AMOUNT_ABOVE_MAXIMUM | Exact input-asset transaction limit; hard |
| POLICY_RESTRICTED | Merchant policy, evidence or operator restriction; hard |
| OUTSIDE_OPERATING_HOURS, MAINTENANCE, PROVIDER_UNAVAILABLE, INSUFFICIENT_CAPACITY | Known temporary blocker |
| STALE_OBSERVATION, MISSING_REQUIRED_CONTEXT, CONVERSION_BASIS_UNAVAILABLE | Required evidence unavailable; unknown |
| VERIFICATION_REQUIRED | Known unmet verification with action; otherwise unknown |

Draft and unpublished configurations are excluded at registry discovery; they cannot become candidates merely by being structurally valid. Pure evaluation sorts candidate IDs and reason codes for stable output. Merchant method ordering is preserved; no cross-method cost ranking occurs.

Expiry is the minimum of the 30-second maximum, trusted policy/context validity, contributing compliance/evidence expiry and next applicable schedule boundary. Local-time schedules are reevaluated at each UTC minute boundary, conservatively covering DST gaps/repeats. Excluded providers do not shorten evidence supporting another available provider. This assessment is not a guarantee or reservation.

Future routing must call `revalidateSelectedMethod(orgId, contextId, evaluationId, selectedMethod)`: reject expired/mismatched context, policy/environment or unavailable selection; reload current registry, restrictions and observations; return only eligible candidate IDs within the chosen method. Routing must still recheck execution prerequisites immediately before payment. That remaining check and ranking/execution are outside this task.

## Failure handling and operations

Registry/operational database failure returns a safe 503 with INFRASTRUCTURE_UNAVAILABLE and correlation ID, never an empty supported-method list. Exhausted candidate/observation budget returns EVALUATION_BUDGET_EXCEEDED (503). Expired/mismatched context/evaluation is a 409. Validation errors are 400 with field information. A paused worker produces stale evidence and UNKNOWN; pending withdrawals still block. Publication conflicts preserve the current revision and fail the job. Authentication/malformed adapter failures become unknown evidence and safe diagnostic events.

Structured logs cover registry publication latency/lag, worker failures, probe latency/failure category, evaluation latency/candidate count/method outcomes/exclusion codes. Use event names and bounded codes as metric labels; correlation IDs belong in logs, not metric labels. No raw payment context, provider response or secrets are logged. There is no cache-hit metric because there is no cache.

To investigate an unavailable method, retrieve the permitted evaluation explanation before seven-day retention expires. Check policy version and selected method; inspect exact candidate exclusions and publication revisions; inspect observation sources and freshness; then inspect pending/failed publication jobs and authoritative withdrawal revisions. Never fix an incident by changing a draft, marking global API health positive, modifying an immutable snapshot, or bypassing a restriction. Correct the source configuration/evidence and use approved publication or retry/reconciliation.

## Migration and compatibility

`20260918010000_registry_availability` adds RegistryHead, PublishedProfile, AvailabilityContext and AvailabilityEvaluation and nullable columns/indexes to Availability. `20260918020000_registry_guards` adds immutable integration/profile guards, environment/scope checks, foreign keys and an observation latest-scope index. No existing data is reset or deleted. Apply with `npm run db:migrate`, then regenerate the Prisma client.

Legacy rows cannot be deterministically backfilled into complete supported fulfillment: free-text schedules, conditions, settlement prose and integration operation names are ambiguous. They stay visible in portal/history and report “Complete fulfillment declaration requires review and publication.” Add structured profiles through the existing form, submit, review and publish. Reconcile existing snapshots if a RegistryHead is absent; no legacy row becomes production eligible automatically. Sandbox and production edits/removals are scoped independently. API behavior intentionally changes from the former broad “Eligible” badge to “Operational readiness”; transaction eligibility requires a trusted context.

## Sandbox walkthrough and verification

Set up the existing local database/accounts using PROVIDER-PORTAL.md. Run the Next server. For the deterministic database scenario, stop the background worker so the test controls crash/order/time boundaries, then run:

```sh
npm run test:portal -- registry.spec.ts
```

The test uses existing authenticated commands to create three fictional organizations, configure integrations and explicit profiles, attach evidence, run simulator prerequisites, submit, review and activate. Harbor and Creek support the same NGN bank-transfer pay-in with different limits; Chain supports only Ethereum USDC. It exercises publication-before-ack crash/retry, concurrent duplicate publication, observations, trusted-context evaluation, one provider outage, remaining-provider suspension before delivery, unrelated-method exclusion, stale evidence, preserved live versions during draft edits, expired routing assessment, rollback under higher revisions, reconciliation of a deleted outbox job and tenant/role denial. No funds move. Fixtures are also reusable from `tests/fixtures/providers.ts`.

For existing browser journeys, run the background worker and then `npm run test:portal -- portal.spec.ts`. Unit contracts, all mixed status pairs, asset/network/direction boundaries, DST schedules and adapter conformance run with `npm test`. See [verification results](REGISTRY-VERIFICATION.md) for actual commands/outcomes.

Production dependencies remain real provider adapters and exact integration-version readiness tests; managed secret service; scanner/compliance/storage configuration; trusted merchant/intent and verification policy integration; a trusted conversion basis for cross-asset fulfillment; deployment monitoring and capacity sizing. Mail delivery also remains an existing deployment dependency. The PostgreSQL registry itself is now implemented. Production gates remain closed until the external prerequisites are supplied. This work does not claim live provider certification or successful real payment execution.
