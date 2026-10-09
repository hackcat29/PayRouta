# Customer payments and operations

## Run and review locally

Use the existing local portal environment (see `PROVIDER-PORTAL.md`). No database reset is needed; the payment migrations are additive.

```sh
npm run portal:db
npm run db:migrate
npm run db:seed               # only if the existing portal users are not seeded
npm run payments:seed
npm run payments:receiver    # terminal 1: loopback-only signed event receiver
npm run portal:worker        # terminal 2: existing worker, now also processes payments
npm run dev                  # terminal 3
```

Sign in at `/provider/sign-in` as the existing fictional owner (`owner@harbor.example`, development password documented in `PROVIDER-PORTAL.md`). Open `/provider/payments`. Choose a scenario and open checkout. The customer must select a method, review the quote, and confirm. The action scenario needs a second explicit sandbox action. Reload during the action to check resume.

Review `/ops/payments` with the existing operations account and authenticator step-up. Existing provider transaction/settlement views are populated with provider-scoped records. The operations page shows routes, attempts, delivery states, exceptions, reconciliation evidence and read-only journal entries. “Check status” queues reconciliation; “Redeliver” retains the event identity.

The `timeout` scenario accepts once on the simulated provider, initially returns Unknown, and resolves through polling. `fee-mismatch` confirms payment but reports one extra minor unit of provider fee; reconciliation raises `FEE_MISMATCH`. `settlement-pending` confirms payment without completing settlement. `fallback` rejects before creating a provider obligation and then uses the next eligible provider within the same selected method. There are two seeded eligible bank providers.

## Boundaries and authorization

`lib/payments/` uses the existing PostgreSQL/Prisma runtime, serializable transaction helper, `Job` worker, verified merchant membership, internal step-up, registry, observations, availability engine, secret manager, and pinned-DNS HTTPS protection. See `PAYMENTS-AUDIT.md` for the original repository audit.

Production intent execution is deliberately closed until a real execution adapter and verified economic contracts are registered. The seeded merchant/provider organizations are fictional. No real customers, live charges or refunds are used. Merchant creation is server-authorized with the existing `integration` permission; endpoint configuration requires `configure`. Checkout never accepts a trusted amount, merchant identity, settlement destination, or verification flag from the payer. Sandbox verified status is an explicit fictional server-side fixture.

A session returns a random 256-bit credential once; only its SHA-256 verifier is stored. The checkout link places it in the fragment, removes the fragment immediately, then exchanges it for an HttpOnly, SameSite=Strict cookie scoped to that checkout API. HTTPS uses Secure cookies. Session/intent expiry is 30 minutes; revocation is `CheckoutSession.revokedAt`. POSTs require the configured same Origin, schemas reject extra fields, bodies are limited to 32 KiB, and per-session limits are enforced. Checkout omits marketing/analytics components and uses no-referrer. Do not add third-party checkout scripts or log session-creation responses.

Registered merchant return origins are exact-match. Provider profiles and quotes are bound to the intent, selected method, integration, environment and availability evaluation. Current restrictions are revalidated at confirmation and dispatch. A quote is not a reservation; simulator capacity observations and declared daily limits are advisory, with no claim of enforced cumulative provider capacity.

## APIs

All JSON APIs return no-store responses. Merchant endpoints use existing authenticated sessions and same-origin protection; merchant secrets never enter checkout.

- `POST /api/payments`: `create` with `orgId`, `key`, `intent`; `session` with `orgId`, `intentId`; `webhook` with server-authorized URL, secret and key ID.
- `GET /api/payments?orgId=...&id=...`: authorized intent and attempt details.
- `POST /api/checkout/:id`: `exchange`, `methods`, `select`, `confirm`, `complete` (sandbox action only).
- `GET /api/checkout/:id`: customer-safe progress, invoice and settlement summary.
- `POST /api/payments/provider/:integrationId`: authenticated simulator payment event inbox.
- Operations commands: `reconcile`, `redeliver`, `resolve` (requires reason; changes exception workflow only, never financial history).

`create` accepts decimal amount strings, explicit asset and precision, permitted methods, settlement asset, reference, registered return URL, bounded metadata, and a sandbox scenario. Create idempotency keys are scoped to merchant/environment; changed payloads conflict. Confirmation is bound to an immutable route ID; repeated confirmation returns the existing attempt. Concurrent confirmations run through serializable transactions plus a unique active-attempt database index.

## State machines and recovery

Intent: Open → Processing → Confirmed. Definite rejection returns the intent to Open for explicit recovery; the rejected attempt remains immutable evidence. Method changes invalidate route/quote proposals and are blocked while an active or confirmed attempt exists.

Attempt: Created → Dispatching → Requires action / Pending / Unknown / Confirmed / Rejected. Confirmed does not regress; conflicting rejection becomes an exception. Unknown is unresolved, never failure. The simulator stores provider acceptance independently of the attempt and uses the stable attempt key. Restart after acceptance performs status lookup. Restart before acceptance can replay the same key only because simulator lookup is authoritative and provider idempotency is implemented. A real adapter must declare and verify equivalent semantics before enabling this path.

Payment confirmation posts one financial fact and creates merchant events atomically. Settlement is a separate movement with explicit allocation evidence; Completed and Exact match are separate operational/reconciliation states. Expired checkout access does not block worker confirmation; late funds raise an exception. Amount/asset differences never rewrite the invoice or post its confirmation.

Jobs recover expired 60-second leases and payment failures retry with capped exponential backoff plus jitter, up to eight attempts. `scripts/worker.ts` performs periodic reconciliation independent of the browser. At-least-once execution is assumed; financial source keys and stable provider idempotency prevent duplicate business effects. Network exactly-once delivery is not promised.

Recovery:

| Condition | Action |
|---|---|
| Crash after provider acceptance | Restart worker; status lookup resolves the stable attempt key. Never create a new attempt for Unknown. |
| Delayed webhook / closed browser | Worker polling and periodic reconciliation continue. |
| Unknown over five minutes | Inspect `AGED_PENDING` / provider evidence in operations; no unsafe fallback. |
| Merchant endpoint failure | Fix endpoint or rotate its secret, then redeliver the same event. Payment remains confirmed. |
| Missing settlement evidence | Retain unverified/pending reconciliation; obtain an authenticated report. |
| Journal failure | Transaction rolls back the related financial mutation; inspect job and source evidence, then retry. Never edit posted lines. |
| Duplicate report import | Same integration/environment/fingerprint returns the prior report and cursor. |
| Correction | Use the internal journal reversal function in an audited operational workflow; preserve original entry. No arbitrary public mark-paid or balance-edit API exists. |

## Routing and adapter contract

Policy `payments-v1` is operator-controlled in `MerchantConfig.policy`. Candidate discovery is bounded to eight currently eligible profiles in the selected method. Only explicitly registered sandbox simulator integrations receive fixture economics. Amount and settlement asset must be identical for this sandbox execution release; cross-asset execution is rejected rather than inventing FX.

Lower cost compares complete same-asset provider fee deductions (payer amount unchanged). Faster compares provider estimated completion seconds. Balanced uses fixed weights: 40% fee penalty capped at 10,000 minor units, 30% time normalized against 86,400 seconds and capped at 10,000, 20% reliability penalty, 10% capacity penalty. All factors are integer and bounded to 0–10,000. Missing fee/time/capacity excludes a balanced candidate; missing history uses an explicit maximum reliability penalty, not a fabricated score. Lower cost excludes unknown fees; faster excludes unknown time. Ties use profile ID. Quote economics are fictional fixtures, not live prices. Provider pricing remains separate from the versioned platform fee schedule; see [billing](PLATFORM-BILLING.md).

Quotes include provider/profile, input/settlement asset, payer amount, inclusive settlement fee treatment, exact rounding, quote ID, context fingerprint and a 60-second maximum validity. Availability may expire earlier. Confirmation rejects expired quotes. No automatic repricing of payer obligation occurs. Safe fallback is bounded to one alternate in the sandbox rejection scenario, and revalidates eligibility without changing the method.

The persistent simulator extends `lib/portal/simulator.ts` with create, status, action, settlement and report operations. Result states distinguish action, pending, confirmed, rejected and unknown. Fictional bank instructions, card action, mobile prompt and non-payable crypto instructions never collect card PAN/CVV or issue real deposit details. Actual eligible profiles govern which methods appear; the seeded merchant has two bank-transfer profiles and one each for card, mobile money and stablecoin. The default NGN checkout offers bank, card and mobile money; stablecoin requires an explicitly denominated token invoice. Mobile-money was added to the existing controlled fulfillment-method contract without replacing the registry.

## Events and merchant verification

Incoming simulator events require the integration's non-revoked `payment-webhook` secret reference. Raw bytes are limited before verification. Timestamp skew is limited to five minutes. Unique integration/environment/event IDs deduplicate; conflicting reuse is rejected. Durable acceptance is followed by asynchronous processing. Unknown types are retained as Needs inspection and do not mutate money. Normalized event identity/reference is checked against provider participation. Confirmed facts cannot regress from stale Pending evidence. The contract is specifically the simulator's; do not reuse it as a guessed real-provider webhook contract.

Merchant payload fields: `id`, `type`, `schemaVersion`, `objectId`, `objectVersion`, `environment`, `occurredAt`, `amount`, `asset`, `state`. Events cover action required, pending, confirmed, definite failure, settlement pending/completed/exception. Delivery is at least once and unordered; consumers deduplicate `id` and use `objectVersion`. A failure never rolls back the payment.

Headers: `payrouta-event-id`, `payrouta-timestamp` (Unix seconds), `payrouta-key-id`, `payrouta-signature` (hex HMAC-SHA256). Signature input is `timestamp + "." + eventId + "." + rawBody`.

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';
const expected = createHmac('sha256', secret)
  .update(`${timestamp}.${eventId}.${rawBody}`).digest();
// First validate timestamp within 300 seconds and 64-character hex signature.
const valid = supplied.length === expected.length && timingSafeEqual(supplied, expected);
// Persist eventId transactionally with consumer effects; acknowledge duplicates safely.
```

New secret references and key IDs support rotation; consumers retain the previous key during transition. HTTPS endpoints are validated and DNS-pinned on every send, bounded to five seconds, with no redirects. The sole exception is the fixed `local://payment-receiver` mapping to loopback port 55439 in explicit sandbox/local mode. `PAYMENT_RECEIVER_FAIL_FIRST` simulates receiver failures. It never sends sandbox data to a real recipient unless an authorized operator explicitly configures such an endpoint; use the fixed local fixture for development.

## Settlement, reports and accounting

`recordSettlement` requires provider reference, environment, asset, exact minor-unit gross/fee/net and explicit per-intent gross/fee allocations. Allocations must sum exactly; merchant/provider/environment/asset scope and cumulative allocation limits are checked in serializable transactions. Partial movements are not described as full merchant completion. Provider reports have identifiers, coverage windows, import fingerprints, durable row cursors and exact-reference matching. There is no amount/date-only matching. Missing internal payments, conflicting provider outcomes, amount/asset differences, aged unknowns, missing journal entries, fee mismatches, partial/unallocated settlement and late funds are retained as exceptions with evidence and a resolution timeline.

The journal book is `provider-merchant-operational`. It observes value handled by providers for merchants. **It is not PayRouta cash or revenue.** Platform fees are now accrued separately in `payrouta-platform-accrual`, debiting a receivable and crediting platform fee revenue after successful production confirmation under saved terms. Sandbox remains free. See [billing](PLATFORM-BILLING.md); accrual is not cash collection or tax invoicing. Amounts are minor-unit integers; the asset key is kind/identifier/network. Debits and credits balance within each entry/book/asset. Unique source keys combine polling and webhook evidence into one recognition. Deferred database constraints enforce balance; database triggers reject editing, deleting, or appending to previously committed entries. Projections are rebuilt by grouping postings by book/asset/account (`ledger.ts`).

Example NGN 100.00 payment (10,000 minor units), provider fee NGN 0.10:

| Fact | Debit | Credit |
|---|---|---|
| Confirmed provider receipt | provider-clearing 10,000 | merchant-payable 10,000 |
| Completed provider settlement | merchant-payable 10,000 | provider-clearing 10,000 |
| Settlement detail memorandum | merchant-settled 9,990 + provider-fee 10 | conversion-clearing 10,000 |

The last account is an operational memorandum counteraccount, not a claimed bank balance. A correction is a linked opposite entry; history remains intact. Conversion examples are explicitly linked but balanced independently (e.g. USD 100 minor units and NGN 150,000 minor units at an illustrative 1,500 NGN/USD). The example does not enable live cross-asset execution or assert a stablecoin peg.

## Configuration and remaining real-provider work

Reuse `DATABASE_URL`, `PORTAL_LOCAL_MODE`, the existing secret-manager settings, `BETTER_AUTH_URL`, and `BETTER_AUTH_SECRET` from the portal guide. No new live credentials are required. `PAYMENT_RECEIVER_FAIL_FIRST` is optional and fixture-only. Configure merchant origin/policy/allowlist and signing-key reference server-side. Keep return origins aligned with the local app origin.

Real deployment still requires verified execution/quote/cancellation/report APIs, hosted card integration, provider-issued bank/mobile/chain instructions, settlement destination references, verified customer facts, live economics, provider capacity enforcement where required, provider-specific event semantics, and provider rate limits. The sandbox intentionally executes same-asset payments only. It does not provide refunds, splitting, multi-hop routing, arbitrary FX, or real payment rails. Report fixtures exercise the internal import boundary; provider report retrieval/pagination must be implemented against each real contract. Accounting policy requires review before treating operational observations as a production financial subledger.

## Verification

```sh
npm test
npm run test:payments
npm run test:checkout         # local Next server and payments:receiver running
npm run typecheck
npm run lint
npm run build
```

See `PAYMENTS-VERIFICATION.md` for actual results and coverage limits.
