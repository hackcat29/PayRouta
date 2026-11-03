# PayRouta partner onboarding

How PayRouta opens merchant-owned accounts with payment providers ("partners"), what it guarantees to those partners, and how engineers add a new one.

> **Status (2026-09-28):** onboarding and payments through merchant-owned accounts are implemented and verified locally: end to end with a fictional sandbox partner, and against simulated Stripe and PayPal responses. The Stripe and PayPal modules have **not** yet been run against those providers' real sandboxes. Production payments through a partner stay closed until they are (see [Qualification](#qualification)).

## 1. PayRouta's position

For accounts opened through this programme, PayRouta routes payments and does not hold funds: every account it helps open belongs to the merchant. (PayRouta's own aggregator rails are described in [AGGREGATOR.md](AGGREGATOR.md).)

| Question | Answer, for every registered partner |
| --- | --- |
| Who signs the provider's contract? | The merchant, directly with the provider |
| Who can log in to the account? | The merchant, with their own credentials |
| Who bears chargebacks and negative balances? | The merchant or the provider, never PayRouta |
| Where do funds settle? | Directly to the merchant's own destination |
| What happens if the merchant leaves PayRouta? | They keep the account |

These five answers are recorded in each partner module's manifest (`ownership`). The registry **refuses to load** a module that answers any of them differently (`lib/partners/registry.ts`, `validateManifest`). Programmes where the platform carries liability (Stripe Express/Custom, Adyen or Checkout.com sub-merchants, Xendit OWNED accounts, provider subaccounts under a PayRouta master account) do not belong in this registry: they are aggregator platform accounts, covered by [AGGREGATOR.md](AGGREGATOR.md) and `lib/treasury`. A unit test proves the refusal here.

## 2. Flow

```
Merchant                      PayRouta                                   Partner
   │ business profile (once)     │                                          │
   ├────────────────────────────►│ versioned, immutable profile             │
   │ sees exact fields per partner│                                          │
   │ consents (MFA step-up)      │ consent bound to profile version +       │
   ├────────────────────────────►│ field list (immutable, revocable once)   │
   │                             │ screens business, representative, owners │
   │                             │ ── match: stop, nothing disclosed         │
   │                             │ ── review: hold for a PayRouta operator   │
   │                             │ projects profile to declared fields      │
   │                             ├─────────── create / pre-fill ───────────►│
   │ "Continue with <partner>"   │ link host checked against manifest       │
   ├─────────────────────────────┼─────────── provider-hosted onboarding ──►│
   │                             │                   (ID, bank details, ToS) │
   │                             │◄──────── signed account event ───────────┤
   │                             │ event only queues a re-read              │
   │                             ├─────────── authenticated status read ───►│
   │                             │ approved → merchant-owned binding        │
```

## 3. What PayRouta enforces

| Control | How | Where |
| --- | --- | --- |
| No payment-facilitator programmes | Manifest ownership attestation checked at registration | `lib/partners/registry.ts` |
| Data minimisation | Profile projected onto `manifest.sharedFields` before any request is built. Conformance plants canary values in every other field and fails the module if any reach the wire | `lib/partners/kyb.ts`, `lib/partners/conformance.ts` |
| Sensitive identity data is never collected | The profile schema is strict and has no field for ID numbers, dates of birth, bank accounts or card data. Partners collect these on their own hosted flows | `kybProfileSchema` |
| Informed, specific consent | The merchant sees the plain-language field list per partner. Consent stores the list and a fingerprint of (partner, fields, profile version, profile fingerprint). The request fails if what was shown differs from what would be sent, and provisioning fails if the manifest changed after consent | `requestPartnerAccounts`, `provision` |
| Tamper-evident records | Database triggers reject any update or delete of profiles and screenings. Consents may only be revoked, and only once | `prisma/migrations/20260928010000_partner_onboarding` |
| Screening before disclosure | Business, trading name, representative and every ≥25% owner are screened. A match stops the application with nothing sent. A review holds it until an operator records a new, immutable manual decision. Merchants are never told of a screening hit (tipping-off) | `lib/partners/screening.ts`, `reviewScreening` |
| Production gating | Production applications require a non-fictional organisation and a merchant application under review or approved | `requestPartnerAccounts` |
| Strong authentication | Consent and disconnection require authenticator step-up. Partner connections require an internal operations admin with step-up | `stepUp`, `internal(true)` |
| Credential hygiene | Platform secrets go only to the secret manager and are referenced by name. Stripe keys must match the environment (`sk_test_` in sandbox, `sk_live_` in production) | `configurePartnerConnection`, Stripe adapter |
| No duplicate accounts on retry | Stripe `Idempotency-Key` per application; PayPal `tracking_id` = application ID | adapters, conformance |
| Safe outbound calls | DNS-pinned, SSRF-validated HTTPS with no redirects, bounded time and size | `lib/providers/adapters/http.ts` |
| Safe redirects | Onboarding links must be HTTPS on the manifest's declared hosts, with no credentials in the URL. Lookalike hosts are refused | `assertLinkHost` |
| Verified, idempotent events | Each partner's own scheme (Stripe HMAC with 5-minute tolerance and livemode check; PayPal's verification API with a 5-minute window). Durable dedupe by event ID, and a conflicting reuse of an ID is rejected. Events never change state; they queue an authenticated status read | `app/api/partners/[partnerId]/events/[environment]` |
| Conservative status | Unknown or garbled provider responses are never read as approved. Only approved accounts are bound, and a binding counts for live scope only while the application stays approved | adapters, `lib/merchant/live-scope.ts` |
| Missed-webhook recovery | The worker re-reads open applications every 10 minutes and approved ones daily | `sweepPartners` |
| Payments on the merchant's own account | Stripe Checkout on the connected account (`Stripe-Account`), PayPal Orders on the merchant's behalf (auth assertion, captured after approval). PayRouta never sees card details; funds go to the merchant's account | adapters, `lib/payments/partner-execution.ts` |
| Exact amounts | Amounts are sent only when their precision equals the currency's exponent; anything else is refused, never rescaled | `lib/partners/money.ts` |
| No duplicate charges | Each attempt has a stable idempotency key (Stripe `Idempotency-Key`, PayPal `PayPal-Request-Id`); a lost response is recovered by replaying the same key | adapters, conformance |
| Same-method fallback | A payment a partner refuses before any obligation moves to the merchant's next account for the same method; the customer's method never changes | `lib/payments/processing.ts` |
| Qualification gate | Production payments through a partner require its sandbox connection to have recorded end-to-end evidence; a production connection cannot even be enabled without it | `qualifyPartner`, `partnerCandidates` |
| Audit | Every profile version, consent, disclosure (field list and fingerprint), link issue, state change, binding and operator action is audited. Screening outcomes are internal-only | `audit` |

## 4. Merchant experience

`/merchant/providers`: the merchant saves one business profile, expands a partner to see exactly what it will receive, ticks consent and applies. After PayRouta screening, **Continue with <partner>** opens the provider's own onboarding. Returning refreshes status. **Disconnect** revokes consent and stops routing; the provider account stays open and remains the merchant's.

## 5. Operating a partner connection

A connection holds PayRouta's own platform credentials with a partner for one environment. It is configured by an operations admin after step-up:

```json
POST /api/partners
{
  "action": "partner-connection",
  "partnerId": "paypal",
  "environment": "sandbox",
  "enabled": true,
  "config": {},
  "secrets": { "secretKeyRef": "sk_test_…", "webhookSecretRef": "whsec_…" },
  "reason": "Enable PayPal sandbox qualification"
}
```

Secret values are stored in the secret manager, and only their references are saved. Partial updates merge with the existing config, and new secrets rotate the old ones. Register this webhook endpoint with the partner:

```
https://<origin>/api/partners/<partnerId>/events/<environment>
```

PayPal also needs `config.partnerMerchantId` and `config.webhookId`, plus `clientIdRef`/`clientSecretRef` secrets.

Screening held for review is resolved with `{"action": "partner-screening-review", "orgId", "profileVersion", "verdict": "clear" | "match", "note"}`. This creates a new record and re-queues held applications.

## Qualification

Every partner module runs an end-to-end pass in the provider's own sandbox before production:

1. onboarding to Approved
2. a verified account webhook
3. a test payment through checkout to Confirmed
4. recovery of a missed webhook by a status read

An operations admin records the IDs as evidence in **Ops → Partner programmes**. See `docs/PRODUCTION.md` §5.

## 6. Adding a partner

1. Confirm the programme passes the five ownership questions in writing from the provider. If any answer is no, stop.
2. Create `lib/partners/adapters/<id>.ts` exporting a `PartnerModule`:
   - `manifest`: ownership, methods, the **minimum** `sharedFields`, exact `linkHosts`, and whether partner approval is required.
   - `configSchema`: strict, must accept `environment`, and secrets only as `…Ref` names.
   - `createAccount` must be retry-safe (idempotency key or deterministic reference). `status` maps into the normalized snapshot and never defaults to approved. `verifyEvent` uses the provider's documented scheme and returns `null` on any doubt.
   - Map provider errors with `providerFailure()` (4xx is terminal, everything else retryable).
3. Add it to `modules` in `lib/partners/registry.ts`.
4. Add a harness with a fake transport to `tests/fixtures/partners.ts` covering every scenario the provider can express. `npm test` runs the full conformance suite against it.
5. Qualify against the provider's real sandbox: configure a sandbox connection, apply with a fictional organisation, complete the hosted flow, and confirm events and status reads. Record the evidence.
6. Only then configure a production connection.

## 7. Verification

```sh
npm test                 # unit + conformance (all partner modules)
npm run test:partners    # database: lifecycle, screening, consent, immutability, events, sweep
npm run typecheck && npm run lint
```

## Not yet done

- **Real sandbox qualification** of the Stripe and PayPal modules. Request shapes follow the providers' public documentation but have only been exercised against simulated responses.
- **Provider settlement report import.** Partner payments are confirmed and reconciled against the provider's status. Settlement shows "awaiting settlement evidence" until each provider's payout or report API is imported.
- **Refunds and disputes** through partner accounts. Merchants handle these in their own provider dashboard for now.
- **Organisational assurance** partners will ask for: SOC 2 or ISO 27001, a penetration test, data-processing agreements with each partner, a published privacy notice covering partner disclosures, an incident-response contact, and retention periods for profiles and screenings.
- **Partner programme approval** where required (PayPal, and most others on the target list).
