# PayRouta aggregator architecture

How PayRouta collects payments on behalf of merchants through its own provider accounts, and what is built so far.

> **Status (2026-10-09):** phase 1 (foundation) and phase 2a (Stripe Connect Custom with PayRouta-owned onboarding: sub-accounts opened by API, payments with the fee withheld, funds availability and reserve release) are implemented. So are Paystack subaccounts (split settlement). See §3b for every partner. They are verified against the local database with a fictional sandbox platform, and against simulated Stripe responses. Nothing has run against Stripe test mode yet, so no real money moves. Payouts, refunds, disputes and reconciliation (2b, 2c) are next.
>
> **Pricing blocker before production:** on this rail PayRouta pays Stripe's processing fees (`fees.payer: application`). The current fee schedule (0.25% capped at $2, [PLATFORM-BILLING.md](PLATFORM-BILLING.md)) is far below Stripe's card fees, so every payment would lose money. Aggregator payments need their own fee schedule before a production platform account is enabled.
>
> This is an engineering design, not legal advice. Each jurisdiction's licensing position needs counsel's sign-off before production.

## Decisions

| Decision | Choice |
| --- | --- |
| Model | Aggregator. Merchant of Record as an opt-in tax mode later (phase 5). |
| Global company | Delaware C-Corp. Regional operating companies (Nigeria, Kenya) as needed. |
| First aggregator rail | Stripe Connect Custom |
| Merchant-owned accounts ([PARTNER-PROGRAM.md](PARTNER-PROGRAM.md)) | Kept alongside the aggregator rails |
| Merchant experience | **Invisible Connect** (2026-10-09). Merchants only ever see PayRouta. PayRouta owns the KYC/KYB pipeline and onboards Stripe connected accounts by API, and PayRouta initiates payouts. Funds stay in each merchant's Stripe balance (partner-held). |
| Pooled treasury with Wise or Airwallex payouts, or processing through PayRouta's own merchant accounts | Not pursued. Card network rules treat processing for others through an ordinary merchant account as transaction laundering, unless PayRouta is a registered payment facilitator. Pooled funds need money-transmission licences. A payfac application is possible later as business work. |

## 1. Custody modes

Every rail declares who holds merchant funds. PayRouta starts with the modes where its own bank account never receives merchant money.

| Mode | Where funds sit | Examples | Where in code |
| --- | --- | --- | --- |
| `merchant-owned` | Merchant's own provider account | Stripe Standard, PayPal | `lib/partners` |
| `partner-held` | Per-merchant balance inside the partner's licensed platform | Stripe Connect Custom, Adyen for Platforms, Airwallex | `PlatformAccount` |
| `split-settlement` | The provider pays the merchant's share to the merchant's bank | Paystack and Flutterwave subaccounts | `PlatformAccount` |
| `payrouta-held` | PayRouta's own master account | Onafriq, dLocal | `PlatformAccount`, only where the company is licensed |

`custodyBlocker` (`lib/treasury/custody.ts`) refuses a merchant whose country a platform account does not cover. It also refuses `payrouta-held` unless the company lists the merchant's country in `licensedCountries`.

## 2. Companies and platform accounts

- `LegalEntity`: a PayRouta company (for example PayRouta Global Inc., `US-DE`), with the countries where it is itself licensed to hold funds.
- `PlatformAccount`: that company's master account at one provider in one environment. It records the custody mode (fixed once set), the merchant countries it covers, its config (secrets are references only), and whether it is enabled.
  - A production account can be enabled only after its sandbox twin is qualified.
  - Qualification needs evidence for onboarding, payment, payout and reconciliation.

## 3. Merchant underwriting

`MerchantAccount` holds one row per merchant and environment.

```
Submitted → Underwriting → Live ⇄ Restricted
     ↑            │          │         │
     └─ Returned ←┤          └→ Offboarding → Closed
                  └→ Closed (declined)
```

- The merchant submits its current KYB profile, and resubmits after Returned. Operations perform every other transition.
- **Live gate** (`liveBlockers`): Underwriting → Live and Restricted → Live require all of the following:
  - The KYB profile has not changed since submission.
  - The latest screening for that profile is `clear`. In production, sandbox fixture screenings don't count.
  - The organization is not fictional (production only).
  - The risk tier and terms are valid, the reserve is at least the tier minimum (elevated 5%, high 10%), and the tax mode is not `payrouta-mor` (not available until phase 5).
  - The chosen company has an enabled platform account that covers the merchant's country. In production it must also be qualified.
- **What each state allows on a platform account** (`requireFundsAccess`): Live allows payments, refunds and payouts. Restricted allows refunds only. Offboarding allows refunds and payouts. Every other state allows nothing.
- Closing requires every merchant balance to be zero.
- Each transition is an immutable `MerchantAccountTransition` row plus an audit entry. The account's `version` stops two reviewers from acting on the same state.

Operations API: `POST /api/treasury` with these actions:
- `legal-entity`, `platform-account` and `platform-account-qualify`
- `merchant-account-preview`, which lists blockers
- `merchant-account-transition`

Merchants use `{ action: "submit", orgId }`, and `GET /api/treasury?orgId=` returns their state and balances.

## 3a. PayRouta-owned onboarding and sub-accounts (phase 2a)

Merchants never visit, log in to or see the name of the processing partner. In PayRouta's own dashboard they provide:

1. **The business profile** (`MerchantKybProfile`). It is unchanged and holds no sensitive data.
2. **Identity and payout details** (`MerchantVerificationDetails`, `lib/treasury/verification.ts`): the business phone, plus each representative's and 25%+ owner's date of birth, home address and ID number where the country needs one, plus the payout bank account.
   - The details are stored only in the secret store (an encrypted local vault in local mode, AES-256-GCM envelope encryption in production).
   - Rows hold a reference, a fingerprint and a masked summary (last four characters, never dates of birth).
   - Saving requires step-up authentication, and the audit trail records only that the details changed.
3. **Acceptance of PayRouta's merchant terms** (`MerchantAgreement`, version `2026-10-09`), recorded with time, IP (`X-Real-IP` from nginx) and user agent. **Counsel must approve the terms text, which has to incorporate the Stripe Connected Account Agreement.** That is the only place Stripe appears.

Submission pins the profile, details and terms versions. The live gate refuses a merchant whose profile or details changed since submission, or whose accepted terms are not the current version.

`MerchantPlatformLink` is the merchant's sub-account under one platform account. For Stripe it is a connected account with no Stripe Dashboard, PayRouta-collected requirements, PayRouta-paid fees, PayRouta-borne losses and manual payouts.

- Underwriting opens it with `POST /api/treasury { action: "platform-link" }`.
- The worker (`treasury-link-provision`) creates it **entirely by API**, in this order:
  1. the account, with company or individual details, the payout bank account and the terms acceptance;
  2. the representative and each owner as persons;
  3. confirmation that the owner and executive lists are complete.

  Each call has its own idempotency key, so a retried job resumes without duplicates.
- Status is re-read from Stripe (`treasury-link-status`, plus a sweep). Anything still due is translated into PayRouta's own requirement codes (`business-details`, `identity-document`, `payout-account`, …), which are the only codes merchants see.
- Approval binds an `Integration` with `mode: "PLATFORM"`.

The merchant's overview (`GET /api/treasury`) shows a "payments account" (`In review`, `Active` or `Declined`, plus requirements) with no provider names. Checkout labels the rail "PayRouta", and the card step says "Continue to secure card payment."

Customers still pay on Stripe Checkout, which shows the merchant's name. An embedded card form on PayRouta's own checkout page would be a later change.

Merchant API: `{ action: "verification-details", orgId, input }` and `{ action: "accept-terms", orgId }`. The live gate also requires an approved sub-account, with payments and payouts enabled, on a platform account that covers the merchant's country.

Checkout offers the rail only to Live merchants. Candidates appear as `platform:<linkId>` next to merchant-owned partner accounts (`lib/treasury/routes.ts`). Each Stripe payment is a destination charge:
- Stripe Checkout on the platform account
- `on_behalf_of` and `transfer_data.destination` set to the merchant's connected account
- PayRouta's fee as `application_fee_amount`

Phase 2a supports cards only, with Apple Pay and Google Pay inside Stripe Checkout. A fee that cannot be withheld in the payment currency is refused, never converted. Withheld fees are stored with `collection: "withheld"` and never appear on monthly statements.

Not done yet: uploading identity documents to Stripe when it asks for them (the merchant sees `identity-document`, but there is no forwarding yet), and resubmitting changed details to an existing sub-account.

Platform modules live in `lib/treasury/platforms/`: `stripe-custom`, plus `sandbox-platform`, which is fictional and runs in local mode only.

## 3b. Partners under Invisible Connect

Each partner fits only through a platform programme that lets PayRouta onboard merchants by API and keeps funds at the partner (`partner-held`) or settles to the merchant directly (`split-settlement`). Researched 2026-10-09:

| Partner | Programme | Onboarding by API | Custody | Access | Status |
| --- | --- | --- | --- | --- | --- |
| Stripe | Connect, Custom-equivalent accounts | Yes | partner-held | Self-serve platform review | `stripe-custom` built |
| Paystack (NG, GH, KE, ZA, CI) | Subaccounts and split payments | Yes. Paystack does not verify subaccounts, so PayRouta's underwriting is the check. | split-settlement | Self-serve | `paystack-split` built |
| Flutterwave | Subaccounts and split payments | Yes | split-settlement | Self-serve | `flutterwave-split` built. Its verify response doesn't report the subaccount's share, so the share (amount − PayRouta fee − `app_fee`) is an estimate until settlement reports are reconciled. |
| Adyen | Adyen for Platforms (Balance Platform, Legal Entity Management API) | Yes, API-only onboarding | partner-held | Sales contract | Next once a contract exists. Global cards, wallets and local methods. |
| Checkout.com | Platforms (sub-entities) | Yes | partner-held | Sales contract | After Adyen |
| Airwallex | Connected accounts and payments for platforms | Yes (native API) | partner-held | Sales contract | FX and multi-currency payouts |
| dLocal | dLocal for Platforms (User accounts, split payments) | Yes (`POST /v2/accounts`, with KYC and consents) | partner-held: funds stay in the User account until PayRouta requests settlement | Platform credentials from dLocal's technical account manager | `dlocal` built. Processing fees are configured as liable-account fees (PayRouta pays). Redirect hosts must be set from the sandbox (fails closed until then). |
| Antom | Marketplace sub-merchant registration (4–17 day review) | Yes | partner-held | Sales contract | Alipay, WeChat Pay, Asian wallets |
| Monnify | Split / sub-accounts | To be confirmed | split-settlement | To be confirmed | Research needed |
| Tink | One-time payments under Tink's PISP licence, Merchants API for partners | Yes (merchant registration with instant screening) | The payer's bank pays the merchant's own verified account; PayRouta never holds funds | Self-serve Console sandbox; Tink provisions merchants | `tink` built (`feeCollection: "invoice"`). The Merchants API path and the payment request's merchant field must be confirmed in Tink's API reference (`merchantsPath` is required config). |
| Onafriq | B2B payments hub | No sub-merchant programme found | Would be PayRouta-held | Enterprise | Needs licensing (mode D) |
| Stablecoins | Merchant-owned receive addresses (existing) | n/a | merchant-owned | Built | Unchanged |

**Split-settlement rules** (Paystack and Flutterwave subaccounts):
- The provider pays the merchant's bank directly, so PayRouta can neither hold a rolling reserve nor schedule payouts.
- Refunds after settlement come out of PayRouta's main balance, so PayRouta carries the risk.
- The live gate allows such a rail only for merchants underwritten with a 0% reserve (`RESERVE_NOT_SUPPORTED_BY_PLATFORM`). In practice that means low and standard risk tiers.
- Before creating a Paystack subaccount, PayRouta checks the payout account with the bank's name enquiry. Settlement only goes to an account in the merchant's name.
- The merchant bears the provider's processing fee (`bearer: "subaccount"`), and PayRouta's fee is the flat `transaction_charge`. This rail therefore does not have the Stripe pricing problem.
- Availability posts the processing fee the provider reports (`providerFeeMinor`). It then records the merchant's share as settled directly (`settled-direct:`), so PayRouta owes nothing on these rails.

### Running the modules against real sandboxes

`npm run treasury:sandbox -- configure` creates a "PayRouta Global (sandbox)" company and one sandbox platform account for each provider whose test credentials are set. The variables are listed in `scripts/treasury-sandbox.ts`, and secrets go to the local encrypted vault.

`npm run treasury:sandbox -- onboard <provider> <fixture.json>` then takes a fictional merchant through submission, underwriting and sub-account creation at that provider, and prints the result. Fixtures are in `examples/treasury/`: a US company using Stripe's documented test values, and a Nigerian template for Paystack and Flutterwave. Payments are tested afterwards through the local checkout.

## 4. Merchant-funds ledger

The `merchant-funds` journal book records what PayRouta owes each merchant for money held at a platform account. Every entry names its `platformAccountId`, so balances reconcile against that provider's reports.

| Account | Meaning | Stored balance (credit − debit) |
| --- | --- | --- |
| `funds-clearing` | What the platform account holds for merchants | any |
| `merchant-pending` | Captured, not yet settled by the provider | ≥ 0 |
| `merchant-available` | Can be paid out | ≥ 0 |
| `merchant-reserve` | Rolling reserve | ≥ 0 |
| `merchant-dispute-hold` | Frozen against an open chargeback | ≥ 0 |
| `merchant-receivable` | Negative balance the merchant owes PayRouta | ≤ 0 |
| `payout-in-transit` | Payout instructed, not yet confirmed | ≥ 0 |
| `fee-collected` | PayRouta fees withheld at source | ≥ 0 |

The database enforces this ledger, not the application:
- A posting trigger keeps `MerchantBalance` in step with every posting, in the same transaction.
- A CHECK constraint refuses any entry that would overdraw a merchant. An oversized refund has to be booked to `merchant-receivable` instead.
- Balances cannot be written directly.
- Merchant-funds entries are refused unless the merchant is Live, Restricted or Offboarding and the platform account belongs to the merchant's own company.

Money flows. All of these are implemented: `funds.ts`, `payouts.ts`, `refunds.ts` and `disputes.ts` in `lib/treasury/`.

| Event | Posting |
| --- | --- |
| Payment confirmed | `funds-clearing` → `merchant-pending` (net) and `fee-collected` (fee) |
| Provider settles (`treasury-availability`, at the provider's availability date, after checking that the provider moved exactly the net amount) | `merchant-pending` → `merchant-available` and `merchant-reserve` |
| Reserve released (`treasury-reserve-release`, after the hold period) | `merchant-reserve` → `merchant-available` |
| Payout requested / paid / failed / returned after paid | `merchant-available` → `payout-in-transit` → `funds-clearing`; a failure reverses to `merchant-available` |
| Refund | `merchant-available` (shortfall to `merchant-receivable`) → `funds-clearing`; a refused refund is reversed exactly |
| Dispute opened / won / lost | `merchant-available`, then `merchant-reserve`, then `merchant-receivable` → `merchant-dispute-hold`; won → `merchant-available`; lost → `funds-clearing`. The provider's dispute fee is passed on (available, else owed). |
| Set-off | `merchant-available` → `merchant-receivable`, whenever funds become available, a reserve is released, a dispute is won, or before a payout |

Recovering a negative balance:
- **Done:** set-off against later available funds and released reserves at the same platform account, applied before any payout.
- **Not built:** a direct-debit mandate signed at onboarding, and collections. Operations see an outstanding `merchant-receivable` in the ledger.
- **Split-settlement rails:** the provider pays merchants directly, so there is no PayRouta-held balance to set off against. Recovering by raising PayRouta's split on later payments is a follow-up.

## 4a. Payouts (phase 2b)

PayRouta decides when merchants are paid out on fund-holding rails (Stripe Connect; dLocal once its payout flow is confirmed). Split-settlement and pay-by-bank rails pay merchants directly.

- **What can be paid out:** the merchant's available balance **at that platform account**, read from the journal (`payoutEligible`), minus anything that became available within the `payout.delayDays` of its terms. Reserves are never paid out. Payouts go only in the currency of the bank account the merchant gave PayRouta; other currencies stay in the balance until FX exists.
- **Schedule:** the worker's sweep (`sweepPayouts`) pays out on the merchant's schedule: daily, weekly (Mondays) or monthly (the 1st). Offboarding merchants are paid out daily with no delay, and "manual" merchants only when they ask. The partial unique index on `period` means one payout per merchant, platform account, currency and period, however often the sweep runs.
- **On request:** `POST /api/treasury { action: "payout", orgId, asset, amountMinor? }`. This requires the configure permission and step-up authentication. The merchant never chooses a provider: a specific amount comes from whichever platform account holds enough of it, and "everything" pays out each account's eligible balance.
- **Execution:** `treasury-payout-dispatch` calls the provider with the payout id as idempotency key, so a retry after a crash can never pay twice. Stripe payouts go from the connected balance with the statement descriptor **PAYROUTA**. A provider refusal (422) fails the payout and returns the money to the available balance. Payouts still in transit are re-read every 30 minutes and on webhooks. A payout returned by the bank after it was reported paid goes back to the available balance.
- **Restricted merchants** are never paid out. The merchant's overview lists their last 20 payouts, with no provider details.
- **dLocal payouts are not implemented.** Its Payouts API is a general remittance API, and paying out from a platform User account appears to need that account's own credentials. Confirm the platform settlement flow with dLocal's technical account manager first.

## 4b. Refunds, disputes and reconciliation (phase 2c)

**Refunds:** `POST /api/treasury { action: "refund", orgId, intentId, amountMinor?, reason? }` (step-up). Partial refunds can never add up to more than the payment.
- The merchant funds the whole refund: its available balance at that platform account first, the rest booked as owed. PayRouta's fee is not returned.
- Stripe refunds use `reverse_transfer` (from the merchant's connected account) with `refund_application_fee: false`.
- Paystack and Flutterwave refunds reverse the split. Once the subaccount was settled they may come from PayRouta's balance, which is why the shortfall is booked as owed.
- dLocal refunds reuse the payment's split.
- Tink has no refunds (pay by bank).
- The refund id is the provider idempotency key. Pending refunds are re-read every 30 minutes and on webhooks.

**Disputes** come only from the provider's own dispute record (`disputeStatus`), prompted by a webhook or the sweep. A dispute webhook arriving before PayRouta knows the dispute is processed by the worker sweep, because the owner is unknown until the record is read.
- When a dispute opens, the amount is held from available, then reserve, then booked as owed.
- On Stripe, PayRouta also reverses the merchant's transfer for the covered amount while the dispute is open, and transfers the full amount back if it is won. `fundsHeld` makes both steps idempotent across retries.
- A reserve used by a dispute is never released twice.
- Paystack disputes are mapped as: resolved and "declined" means won, any other resolution means lost.
- **Not built yet:** Flutterwave and dLocal chargebacks, and submitting dispute evidence.

**Reconciliation** runs daily per merchant at each fund-holding platform account (`sweepReconciliation`; re-run with `{ action: "reconciliation-rerun", linkId, reason }`).
- The provider's balance for the sub-account (available plus pending, by currency) must equal the ledger's pending + available + reserve + receivable at that account.
- A mismatch is recorded (`PlatformReconciliation`) and audited, and **pauses that merchant's payouts** at that account until a later run matches.
- Built for Stripe (`GET /v1/balance` on the connected account).
- Split-settlement rails need settlement-report reconciliation, which is not built yet. That is also what will confirm Flutterwave's estimated merchant share.

The merchant overview now also lists the last 20 refunds and disputes, with no provider details.

## 4c. Provider events (phase 2b)

One endpoint per provider: `POST /api/treasury/events/<provider>/<environment>`. Each enabled platform account for that provider and environment tries to verify the event, and the first that succeeds owns it (several PayRouta companies can hold the same provider).

Events are stored once per platform account and event id; the same id with a different body is refused. They only queue re-reads from the provider's authenticated API: of the sub-account, of the payment (and its funds availability), or of the payout. An event's payload never changes state.

| Provider | Verification | Config |
| --- | --- | --- |
| Stripe | `Stripe-Signature` with a five-minute tolerance, using the platform and Connect endpoint secrets; events from the other mode are refused | `webhookSecretRef`, `connectWebhookSecretRef` |
| Paystack | `x-paystack-signature`, HMAC-SHA512 of the body with the secret key | `secretKeyRef` |
| Flutterwave | `verif-hash` equals the dashboard secret hash | `webhookHashRef` |
| dLocal | `Authorization: V2-HMAC-SHA256` over X-Login + X-Date + body; the login must be PayRouta's and X-Date within five minutes | `loginRef`, `secretKeyRef` |
| Tink | `X-Tink-Signature` t/v1, HMAC-SHA256 of `t.body`, five-minute tolerance | `webhookSecretRef` |

The worker also sweeps sub-account statuses (`sweepLinks`) and payouts (`sweepPayouts`), so a missed webhook only delays an update.

## 4d. Screens

Patterned on established processor dashboards and hosted checkouts: an activation checklist, a balances page, a disputes list, a money panel on each payment, a split-layout checkout, and a platform console for connected accounts.

**Merchant workspace** (`app/merchant/[[...path]]/treasury-sections.tsx`, `treasury.tsx`):
- **Activate payments** (Settings): a four-step checklist.
  1. Business details (the existing profile form).
  2. Identity and payout bank account (encrypted; only a masked summary is shown back).
  3. Merchant terms.
  4. Submit for review.

  After submission it shows a tracker (Submitted, In review, Active), any note from the review team when the account is returned, and outstanding requirements in PayRouta's words. Home shows a banner until the account is active.
- **Balances & payouts** (Payments): available to pay out, incoming, reserve, on the way to your bank, on hold for disputes and owed to PayRouta, per currency. Also the payout schedule and delay, a "Pay out now" control (step-up), and payout history. On split-settlement rails it explains that payouts arrive directly.
- **Disputes** (Payments): status, reason, linked payment and the date to respond by.
  - Merchants respond in the app (step-up): what was sold, customer details, delivery and tracking, refund policy and an explanation.
  - PayRouta sends the evidence to the processing partner: Stripe dispute evidence with `submit: true`, or Paystack's evidence endpoint, which requires the customer's name, email and phone.
  - Each dispute can be answered once, while open and before its deadline. The operations risk view shows whether each merchant has responded.
- **Payment detail:** a money breakdown (paid, PayRouta fee, processing fee, net, availability), refunds and disputes on the payment, and a refund form with an amount and reason (step-up). Pay-by-bank payments explain that the merchant refunds the customer from their own bank.

**Customer checkout** (`app/checkout/[sessionId]/fiat-view.tsx`, `router.tsx`):
- The router exchanges the link's token once, then shows the fiat checkout for card, bank, mobile money and USSD payments, or the existing stablecoin checkout for on-chain ones.
- Layout: order summary on one side, the payment method choice and a single "Pay £x" button on the other. Then a "Continue to secure payment" redirect, a test-payment step in sandbox, a processing state, success, and a retry after failure.
- Customers only see the merchant and PayRouta. It works on mobile, respects reduced motion, and the checked screens pass axe (WCAG 2 A/AA).
- **Launch scope.** The launch scope (`lib/payments/launch.ts`) still limits every running server to stablecoin and crypto deposits, plus one more path (`lib/treasury/launch.ts`): fiat payments for a merchant that is Live on PayRouta's platform accounts.
  - A fiat intent is accepted only if every requested method is offered by one of those platform accounts. In production that account must also be qualified.
  - Availability, method selection, route validation, dispatch and polling then use only the platform rails. Registry providers, simulator scenarios and merchant-owned partner accounts stay closed.
  - On this path the merchant's PayRouta underwriting replaces the legacy live-scope review.
  - `tests/treasury/launch.test.ts` runs with the scope enforced, exactly as a server would.
- **The stablecoin checkout** (`view.tsx`) uses the same split layout: order summary on one side, network choice and wallet payment or deposit instructions on the other, with "Other payment methods" collapsed.

**Operations console** (`/ops/treasury`, linked from operations navigation):
- **Underwriting:** counts by state and the queue, oldest first (it says when more are waiting than shown). The merchant list has a name search.
- **Merchants:** a list, plus a merchant page showing:
  - business (KYB), verification (screening, masked identity and payout details, terms), sub-accounts with provider status, requirements and reconciliation (with re-run), money, payouts and disputes;
  - the decision panel: approve with company, risk tier, reserve, payout schedule and limits, with a "Check readiness" preview of live-gate blockers; return, restrict, reinstate, offboard and close, each with a recorded reason;
  - the transition history.
- **Risk & money:** open disputes with evidence dates and how they were covered, reconciliation mismatches (payouts paused), money owed by merchants, failed payouts, refunds and sub-accounts, and waiting provider events.
- **Platform accounts:** PayRouta companies and master accounts (custody, countries, qualification, webhook URL), with forms to add them. Secrets are entered once and never shown.

## 4e. Concurrency

Balance reads at a platform account (payouts, refunds, disputes, set-off, reconciliation) run inside serializable transactions. Two things keep unrelated merchants from conflicting:
- The journal is indexed by merchant, book, platform account and asset, and postings by entry. This keeps PostgreSQL's predicate locks narrow.
- `atomic` retries serialization failures up to five times with jittered backoff, and then returns a retryable 409 rather than a raw driver error.

## 5. Phases

| Phase | Scope | Status |
| --- | --- | --- |
| 0 | Legal opinions per jurisdiction; Stripe Connect platform application; Adyen and Airwallex conversations | Business work, outside code |
| 1 | Foundation (this document §2–4) | **Done** |
| 2a | Stripe Connect Custom: connected-account onboarding, destination charges, fees at source, availability, reserves | **Done** (not yet run against Stripe test mode) |
| 2b | Payouts on the merchant's schedule and on request (Stripe; dLocal pending TAM), webhooks for all five rails | **Done** (not yet run against provider sandboxes). Identity-document forwarding and resubmission of changed details are still open. |
| 2c | Refunds (Stripe, Paystack, Flutterwave, dLocal), disputes (Stripe, Paystack), set-off, daily reconciliation (Stripe) | **Done** (not yet run against provider sandboxes) |
| 3 | Paystack, Flutterwave, dLocal and Tink modules (**built**, not yet run against their sandboxes) | Awaiting sandbox credentials |
| 4 | Adyen for Platforms or Airwallex (local methods, FX, multi-currency payouts) | |
| 5 | Merchant of Record tax mode (tax engine, registrations, invoicing) | |
| 6 | PayRouta-held rails (Onafriq, dLocal), after licensing | |

Phase 1 does not include these, which are still to do:
- Ops and merchant UI screens
- Company registry checks: CAC (Nigeria), Companies House (UK), Middesk (US)
- Ongoing transaction monitoring
- Rewording the "non-custodial" claims in `content/` and the marketing copy

## Tests

- `tests/treasury.test.ts`: custody policy, transitions, terms, journal rules.
- `npm run test:treasury`: against the local database. Covers the live gate, stale versions, changed profiles, the immutable history, the merchant-funds scope, overdraw refusal, direct-write refusal, the Restricted freeze and close-out. It also runs a full checkout through the sandbox platform: the payment, the withheld fee, availability, the reserve and its release, replay safety, and no rail for non-Live or Restricted merchants.
- The Stripe Custom module, against a fake Stripe transport, covers: the connected-account controller settings, the destination-charge body and fee, refusal of sessions paying another account, the merchant's share read on the connected account, and the test/live key guard.
