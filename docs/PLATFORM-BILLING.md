# Platform pricing and monthly billing

Implemented 6 October 2026. This is a technology-platform fee, separate from the merchant's provider contract and settlement. No provider rate is hardcoded as a universal global price.

| Selected normalized method | Rate on successful principal | USD cap per payment |
| --- | ---: | ---: |
| Card, digital wallet, BNPL | 0.25% (25 basis points) | $2 |
| Bank transfer, direct debit, USSD, mobile money, stablecoin, crypto app | 0.10% (10 basis points) | $1 |

Sandbox is free. Rates apply once per **payment intent**, after authenticated, amount/asset-matching provider confirmation. Failure, pending, unknown and unsuccessful fallback attempts do not accrue fees; the successful fallback accrues once. Confirmation is distinct from settlement. A later refund does not automatically remove usage; any contractual credit needs finance review and an auditable credit-note workflow before automation. Payouts and cash/voucher have no billing implementation.

Fees use integer arithmetic, apply the percentage to principal (not provider fees), round once to the nearest billing-currency minor unit with halves rounded up, then enforce the cap. No minimum transaction fee. A very small payment can round to zero. Applicable VAT/GST/sales taxes are **additional and not calculated here**.

## Saved terms

`PaymentIntent.feeSnapshot` records pricing version, exact payment asset/precision, billing currency/precision, rates, caps and any conversion evidence when the intent is created. Database triggers prevent changing it later. Existing intents with no snapshot are never back-billed; a production confirmation records `PAYMENT_FEE_TERMS_MISSING` for inspection. Changes affect new intents only, including for idempotent replay of an existing request.

`PAYMENT_FEE_SCHEDULES` is an operator-maintained JSON array, never client metadata. Only fiat USD at precision 2 has built-in production terms. Every other asset requires explicit, contract-approved currency caps. Optional `orgId` limits negotiated terms to one merchant; merchant-specific terms take priority over the default for that exact asset. Rates can be reduced from 25/10 bps; no automatically inferred volume discounts or monthly fixed plans exist. A negotiated 0.05–0.15% proposal must be finalized in the merchant agreement before configuration; fixed monthly-plus-transaction plans still need implementation.

Example **shape only, not approved EUR launch prices**:

```json
[
  {
    "version": "merchant-contract-version",
    "asset": "fiat:EUR:",
    "inputPrecision": 2,
    "currency": "EUR",
    "billingPrecision": 2,
    "highCapMinor": "180",
    "lowCapMinor": "90"
  }
]
```

A same-currency schedule must use identity conversion. Caps are in the stated currency's minor units. Do not copy these illustrative EUR caps into production without approval and publication to affected merchants. Define every launch currency, including its correct minor-unit precision, and review profitability before launch.

Crypto/cross-currency schedules require `conversionNumerator`, `conversionDenominator`, `valuationReference` and `validUntil`. The rational rate converts **payment-asset minor units to billing-fiat minor units**. It must be an independently sourced, contract-approved valuation covering the 30-minute checkout lifetime. No automatic FX feed or stablecoin peg assumption exists. The locked valuation remains the charge basis for late authoritative confirmation; review this policy in the agreement. For example a *fictional* quote of $1.01 per 6-decimal token uses numerator 101 and denominator 1000000 when USD has 2 decimals. Caps apply after fiat valuation. Configure distinct exact network/contract asset keys. The stablecoin MVP supports exact reviewed token/network live scopes; production remains gated by ownership/business evidence, current screening, approved countries/limits and billing valuations.

Unknown production currencies, inconsistent precision, duplicate schedules, malformed configuration and expired valuations reject new intent creation before provider dispatch. No guessed price or uncapped fallback is used.

## Records and monthly close

`PaymentFee` stores one immutable charge per intent. Positive production charges debit `platform-receivable` and credit `platform-fee-revenue` in the separate `payrouta-platform-accrual` journal book. This is an operational accrual record for finance review, not cash received, a tax invoice, or a complete statutory accounting system. Merchant/provider settlement postings remain whole and unchanged in `provider-merchant-operational`; there is no token sweep, application-fee deduction or custody.

Merchant **Settings → Billing** shows monthly totals separately by currency/precision and lets authorized merchant members download detail CSVs. Sandbox records show zero payable fees. Periods are UTC calendar months and use the time authoritative confirmation was processed, so late evidence belongs to the month it is recognized. Exports include saved terms. Downloads are scoped to organization and configured environment, rate-limited and protected against spreadsheet formula injection.

At month-end an authorized server operator runs:

```sh
npm run billing:close -- <merchant-id> <YYYY-MM>
```

The command creates an immutable pretax usage statement for each currency in a **closed** month. Re-running returns the existing statement. It never sends invoices or collects money. The launch workflow is manual monthly closing, tax-invoice issuance, delivery and collection through the company's billing/accounting process. Agree invoice currency, tax treatment, due date, collection method, fee-credit policy and overdue-account process; connect automatic billing only after these are decided. This implementation does not create a direct debit mandate or charge a merchant card.

Statements and detail exports currently accept at most 10,000 payment-fee lines per merchant/month/currency; an oversized close/export fails explicitly rather than silently truncating. Add paginated large-volume exports/statement storage before admitting merchants above that operational capacity. Keep finance's invoice/payment/credit references reconciled against these statement IDs outside this operational ledger until those workflows are implemented.

## Deploy and checks

Generate the Prisma client and apply additive migration `20261006020000_platform_fees` using the existing release process. The migration adds the saved terms, fee and statement tables, immutability/scope guards and segregated journal accounts. No historical backfill is performed. Test fee rates, rounding, caps, duplicate confirmation, free sandbox, fallback, terms immutability, cross-asset valuations and month boundaries before production. Production configuration must include accepted terms for every enabled currency. Credentials alone do not qualify a payment method for launch.
