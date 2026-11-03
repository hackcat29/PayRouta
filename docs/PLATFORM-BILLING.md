# Platform pricing and billing

Pricing v2 (`2026-10-v2`), from 9 October 2026. v1 (`launch-2026-10-v1`: 0.25%/0.10% with USD caps) remains for payments created before then; their saved snapshots are always calculated with v1 rules and never repriced.

| Selected normalized method | PayRouta fee | Partner fee |
| --- | ---: | --- |
| Card, digital wallet, BNPL, bank transfer, direct debit, USSD, mobile money | 1% (100 bps), capped at $5 | The processing partner's standard fee, charged to the merchant on top |
| Stablecoin, crypto app (native crypto) | 1.5% (150 bps) | None: PayRouta is the only processor |

Sandbox is free. Fees apply once per **payment intent**, after authenticated, amount/asset-matching provider confirmation. Failure, pending, unknown and unsuccessful fallback attempts accrue nothing; the successful fallback accrues once. A later refund does not remove the fee.

Integer arithmetic, half-up rounding once, no minimum fee. The 1% is capped at $5 a payment; with no fiat FX feed, each currency has a fixed cap at or just under $5 in `defaultPartnerCaps` (`lib/payments/pricing.ts`), extendable with `PAYMENT_FEE_CAPS` (`{"CAD":"650"}`). Review the caps when exchange rates move. A fiat currency without a cap is refused unless it has a `PAYMENT_FEE_SCHEDULES` entry; negotiated schedules can lower the cap but never lift it above the published one. The 1.5% direct rate and partner fees are uncapped. Unknown currency codes and mismatched precision are refused. Blockchain assets need an evidenced USD valuation: the CoinGecko quote for crypto checkouts, or an operator schedule for stablecoins.

## Partner fees (`lib/treasury/partner-fees.ts`)

- **Split settlement (Paystack, Flutterwave):** the partner deducts its fee from the merchant's share (`merchantBearsProcessingFee`). PayRouta withholds only its 1% (`transaction_charge`); availability records the partner's deduction as `providerFeeMinor`.
- **PayRouta pays the partner (dLocal, Tink):** the partner's published standard fee per method is configured on the platform account as `standardFees` (`{"card": {"bps": 290, "fixedMinor": {"USD": "30"}, "source": "<url>"}}`). It is withheld with PayRouta's fee (or invoiced, for Tink) and stored as `PaymentFee.partnerFeeMinor` / `PlatformPayment.partnerFeeMinor`. A production platform account of this kind can't be enabled until every method it supports has a standard fee (`PLATFORM_STANDARD_FEES_REQUIRED`), and a payment without one is refused (`PARTNER_STANDARD_FEE_REQUIRED`). The actual fee the partner charges PayRouta can differ from the standard rate; the difference is PayRouta's margin or cost and is reconciled against partner reports.
- **Merchant-owned accounts:** the processor bills the merchant directly; PayRouta's 1% is invoiced monthly.

The whole withheld amount is booked to `fee-collected` in the merchant-funds book (database triggers fix the account list); the split lives on the fee records. The dashboard shows PayRouta's fee and processing (partner) fees separately.

## Who pays fees (`lib/payments/fee-bearer.ts`)

`MerchantConfig.feeBearer` (`merchant` default, or `customer`), overridable per payment with `feeBearer`. With `customer`, each payment option's amount is raised at creation (quoted amounts are immutable afterwards, by trigger) to the smallest amount that leaves the merchant its `baseAmount` after fees:

- stablecoin and crypto options: the direct rate exactly;
- fiat options: PayRouta's rate plus the highest standard partner fee among the accepted methods on the merchant's approved rails (configure `standardFees` on split rails too, for this purpose); a single-method payment is exact.

`baseAmount` and `customerFeeMinor` are stored on each option in `paymentOptions`; the API returns `baseAmount` and `customerFee`, and checkout shows the fee as its own line. `PaymentIntent.feeBearer` is immutable. Pass-through of fiat fees is refused for merchants in the EEA and UK (PSD2 surcharge ban); card network surcharge rules elsewhere are the merchant's responsibility under the Terms.

## Saved terms

`PaymentIntent.feeSnapshot` records pricing version, exact payment asset/precision, billing currency/precision, rates, caps and any conversion evidence when the intent is created. Database triggers prevent changing it later. Existing intents with no snapshot are never back-billed; a production confirmation records `PAYMENT_FEE_TERMS_MISSING` for inspection. Changes affect new intents only, including for idempotent replay of an existing request.

`PAYMENT_FEE_SCHEDULES` is an operator-maintained JSON array, never client metadata. You only need it for negotiated terms and for stablecoin valuations: every fiat currency already has the standard 1%/1.5% terms. Optional `orgId` limits terms to one merchant and takes priority over a general entry for the same asset. Rates (`partnerBps`, `directBps`) can be set from 0 to 1000 bps; optional `partnerCapMinor`/`directCapMinor` cap the fee per payment in the billing currency.

Example: a negotiated 0.7% card rate for one merchant, capped at $5:

```json
[
  {
    "version": "acme-2026-11",
    "asset": "fiat:USD:",
    "inputPrecision": 2,
    "currency": "USD",
    "billingPrecision": 2,
    "partnerBps": 70,
    "partnerCapMinor": "500",
    "orgId": "<merchant org id>"
  }
]
```

A same-currency schedule must use identity conversion, and the billing precision must match the currency's minor unit.

Crypto/cross-currency schedules require `conversionNumerator`, `conversionDenominator`, `valuationReference` and `validUntil`. The rational rate converts **payment-asset minor units to billing-fiat minor units**. It must be an independently sourced, contract-approved valuation covering the 30-minute checkout lifetime. No automatic FX feed or stablecoin peg assumption exists. The locked valuation remains the charge basis for late authoritative confirmation; review this policy in the agreement. For example a *fictional* quote of $1.01 per 6-decimal token uses numerator 101 and denominator 1000000 when USD has 2 decimals. Any cap applies after fiat valuation. Configure distinct exact network/contract asset keys. The stablecoin MVP supports exact reviewed token/network live scopes; production remains gated by ownership/business evidence, current screening, approved countries/limits and billing valuations.

Unknown currencies, inconsistent precision, duplicate schedules, malformed configuration and expired valuations reject new intent creation before provider dispatch. No guessed price is used.

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

Generate the Prisma client and apply the additive migrations `20261006020000_platform_fees`, `20261009080000_partner_fee_split` and `20261009090000_fee_bearer` using the existing release process. The migration adds the saved terms, fee and statement tables, immutability/scope guards and segregated journal accounts. No historical backfill is performed. Test fee rates, rounding, caps, duplicate confirmation, free sandbox, fallback, terms immutability, cross-asset valuations and month boundaries before production. Production configuration must include accepted terms for every enabled currency. Credentials alone do not qualify a payment method for launch.
