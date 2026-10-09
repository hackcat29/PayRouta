# PayRouta global launch checklist

Assessment: 7 October 2026, based on the current local repository. No real provider qualification, production deployment, legal approvals or live-money pilot was verified in this task. Existing audit documents include historical snapshots; this checklist and the current code/coverage describe the present remaining work.

Card/provider-specific onboarding, PCI and chargeback checklist items are required when those methods are activated in a future release. The stablecoin launch requirements are summarized in the final section below.

Current release scope is **stablecoin and direct crypto wallet pay-ins**; seven other merchant payment categories and exchange-app payments are Coming soon. See [Crypto wallet payments](crypto-payments.md). See [Stablecoin MVP](STABLECOIN-MVP.md) and the [multichain guide](MULTICHAIN.md).

Global from launch means eligible merchants in several explicitly approved countries. It cannot mean every provider, method, country or currency is automatically enabled. Keep unavailable methods closed and publish an accurate country/method/currency availability matrix.

## Founder and commercial decisions

- [ ] Select the initial merchant countries, payer countries, providers, methods and settlement currencies. Name prohibited industries and merchant eligibility rules. Assign accountable owners for engineering, security, compliance, support and finance.
- [ ] Confirm the operating legal entity, company registration, business bank account, invoicing identity and accounting system.
- [ ] Have local payments counsel assess the actual flows in every selected market: the aggregator model (merchant sub-accounts under PayRouta's platform accounts, partner-held and split-settlement funds, PayRouta-initiated payouts, reserves and set-off, the merchant terms incorporating each partner's agreement), merchant-owned accounts and crypto, including onboarding, routing, cross-border use and any licensing/registration implications. Do not assume the technology-provider description exempts the company.
- [ ] Obtain relevant provider partner/aggregator approvals and execute commercial, processing/data-sharing and data-processing agreements. Confirm your model, supported countries, merchant-owned settlement destinations, permitted sandbox/live testing and dispute responsibility in writing.
- [ ] Agree billing contracts: 25/10 bps, USD caps, explicit caps for each other currency, negotiated merchant terms, rounding, successful-payment trigger, taxes, invoice due dates, payment method, refund/fee-credit policy and nonpayment process. Configure approved schedules; no global FX/cap defaults exist.
- [ ] For crypto, agree invoice currency and independently sourced valuation policy, rate refresh/expiry and late-payment treatment. Qualify the implemented CoinGecko feed and two-minute immutable quotes, stale-price rejection, rounding, late-payment inspection and production API capacity. Complete real wallet payments for each enabled family.
- [ ] Choose and operate monthly invoice issuance, tax calculation, collection, receipts, credit notes and finance reconciliation. Code currently creates pretax usage statements, not tax invoices or automatic merchant charges. Complete a full sample billing month before charging customers.
- [ ] Establish a support address, complaints/escalation process, refund/dispute ownership, service targets and incident contacts. Promises must match measured capability; do not advertise an unsupported SLA.

## Legal, privacy and security sign-off

- [ ] Obtain jurisdiction-specific review of merchant terms, acceptable-use policy, privacy/cookie notices, screening disclosures and partner data-sharing consent. Publish reviewed documents and record acceptance of the applicable fee version. No newly signed acceptance was obtained by this implementation.
- [ ] Confirm controller/processor roles, subprocessors, data locations, international transfer safeguards, retention/deletion periods, access requests and breach procedures. The development evidence-retention default is not a reviewed global policy. EEA transfers may require a valid transfer mechanism: [EDPB guidance](https://www.edpb.europa.eu/sme/be-compliant/international-data-transfers_en).
- [ ] Validate the applicable PCI DSS scope with a qualified assessor/acquirer for your exact checkout model; outsourced card processing still leaves relevant website obligations: [PCI SSC guidance](https://www.pcisecuritystandards.org/faqs/1604/).
- [ ] Complete an independent penetration test and remediation covering tenant isolation, authorization, MFA/session recovery, checkout tampering, webhook verification/replay, SSRF, uploads, secret handling and APIs. Verify logs redact customer data and credentials.
- [ ] Provision named operations accounts using the reviewed internal process and require authenticator MFA. Test role restrictions, offboarding, API-key rotation and emergency credential revocation. Set up incident response and evidence preservation.
- [ ] Review sanctions/KYB/KYC/AML responsibilities with counsel and providers per market; enable required screening, manual review, ongoing monitoring and provider eligibility checks. Do not claim partner approval solely from a simulated response.

## Provider and method qualification — repeat for every launch combination

- [ ] Obtain approved test and live credentials and exact method-specific pricing for the merchant account. Enable needed features/domains/certificates/customer references (e.g. Apple Pay/Google Pay setup, Stripe bank-transfer customer, US/USD Venmo approval).
- [ ] Register HTTPS provider callbacks and signed merchant webhook receivers; configure secrets in the encrypted store and verify expected webhook types/signatures.
- [ ] Perform real provider sandbox onboarding and a payment through the exact selected method. Verify authenticated receipts match merchant, order, amount, asset, currency, environment and final capture.
- [ ] Test rejection, required action, timeout after provider acceptance, duplicated/out-of-order/missed webhooks, status recovery, retry without duplicate payment, same-method fallback and disabled account/provider behavior. Record provider evidence and qualification IDs.
- [ ] Finish real settlement/report ingestion and account-specific provider-fee reconciliation for each launch provider, or implement an explicit documented manual import process. A confirmed payment alone is not settlement proof; native providers never receive fabricated simulator settlement.
- [ ] Test refunds, partial refunds, disputes/chargebacks, cancellation/expiry, returns/reversals and merchant payout failures through the provider-owned process. Record evidence and define how corrections and platform fee credits are handled. Unified automated refund/dispute ingestion and credit notes remain work.
- [ ] For direct crypto deposits: approve production crypto scope, configure merchant-owned address pools and RPC access, test exact issuer contracts, canonical finalized chain evidence, address exhaustion, wrong amount/token/network, duplicate deposits and late/reorg recovery. Establish funds-access/key ownership and off-ramp/support processes. The MVP live-scope review now accepts exact supported stablecoin token/network pairs.
- [ ] Approve each merchant's current KYB/application, screening, provider account ownership and live scope with exact markets/methods/currency/limits/destination and review deadline. Set cautious transaction and daily limits.
- [ ] Run a small, explicitly authorized real-money pilot with consenting participants, exact amounts and fee budget. Independently verify actual receipt, merchant settlement, reports, ledger, fee statement and webhook delivery. Clear all critical discrepancies before broader access.

## Remaining product work and scope exclusions

- [ ] Build and qualify provider settlement/report import and production economics wherever still missing. End-to-end success/reconciliation claims need this evidence.
- [ ] Complete production crypto review/approval support before advertising live stablecoin checkout. Supporting adapter code is not approval.
- [ ] Obtain private API contracts and implement PalmPay and Chipper Cash if they are in launch scope; otherwise remove/label them unavailable. Direct Daraja and direct Airtel paths are also incomplete; only qualified aggregator paths can be offered.
- [ ] Keep unsupported token networks, instant SEPA/FedNow/RTP promises, payout/refund/dispute APIs and cash/voucher out of launch claims until implemented and qualified. RWA/ONDO is reference material, not a checkout method.
- [ ] Complete automated tax invoices, collection/payment reconciliation, credit notes and overdue handling if these are promised as product features; otherwise establish the documented manual finance process. Add large-volume statement/export handling before merchants exceed 10,000 fee lines/month/currency.
- [ ] Verify every advertised payment method is actually offered by an eligible account in that market. Inventory is 41 guides, 40 payment references, 9 merchant categories; 38 guides map to partial code paths. None of those counts is a count of fully live-qualified methods.
- [ ] Validate onboarding, mobile checkout, accessibility, billing, documentation/SDK examples, account invitations, password recovery, settings and support flows with real pilot merchants. Replace unsupported marketing claims and identify unavailable methods clearly.

## Production systems and release

- [ ] Configure and verify HTTPS domain/DNS, production auth origin/secret, database and connection limits, secret-store keys, SMTP/sender verification, private object storage/IAM, malware scanning and screening service. Check callback reachability and storage/scanner/email failures.
- [ ] Configure approved fee schedules, separate sandbox/live credentials and data, and any enabled hosted sandbox. Never seed or reseed a live financial database with fictional fixtures.
- [ ] Deploy both web and durable worker processes, PostgreSQL and required services; apply all additive migrations. Run `npm run preflight:production`, SDK checks, typecheck/lint, unit/database tests, checkout/browser tests and a production build for the reviewed release.
- [ ] Commit/review all intended files before deployment: the release archives tracked Git files only, while much implementation currently exists as local uncommitted/untracked work. Do not deploy an incomplete archive.
- [ ] Configure uptime and worker heartbeat monitoring, external alert delivery, durable event/job backlog alerts, aged unknown payments, reconciliation/settlement discrepancies, billing failures, latency/error monitoring and capacity/disk checks. Dashboards alone are not paging.
- [ ] Back up database, private evidence and master keys; test a restore in isolation and document recovery objectives. Keep encrypted offsite backups and define retention/access. Test rollback without deleting financial records.
- [ ] Run load/capacity tests for expected launch traffic and provider limits. Exercise provider outage, unavailable database/storage/scanner/mail, worker crash/restart, webhook replay and secret rotation.
- [ ] Prepare incident, provider pause, unknown-payment investigation, reconciliation, merchant notification, refund/dispute and billing close runbooks with named on-call owners. Verify operators can pause new execution without inventing a financial outcome.
- [ ] Review the production release and pilot evidence with engineering, finance/compliance and operations. Open only the approved combinations; monitor closely and expand by qualified scope.

## Stablecoin launch boundary

- [ ] Review the actual Base Sepolia and Solana Devnet USDC payment evidence and repeat a customer-signed test checkout through confirmation, settlement, reconciliation and signed webhook delivery for each additional launch asset/network. The 16-network read-only preflight is not a payment test. USDT have no registered test deployments; qualify each with a consented, budgeted mainnet pilot before approval.
- [ ] Exercise each supported wallet family on desktop/mobile, insufficient gas/token balance, cancellation, network changes, lost relay responses, restart recovery, expired signatures and duplicate submissions. Solana receivers may require a payer-funded token account; Stellar receivers require funded classic accounts and authorized exact-issuer trustlines with sufficient capacity.
- [ ] Approve every merchant quote and fee valuation separately; verify 7-decimal Stellar amounts, 6-decimal ERC-20/SPL amounts, EURC valuation. Never advertise automatic conversion or universal USDT availability.
- [ ] Run a dependency security review and remediate or explicitly accept remaining advisories before release. The current local audit has 8 high and 4 moderate findings (including existing image/build dependencies and Solana library transitive dependencies); there are no critical findings.
- [ ] Provision sufficient fresh merchant-owned receive addresses; verify ownership, backup/recovery and refund responsibility. Configure production RPC capacity and monitor address depletion.
- [ ] Save/review merchant business profiles, connect real screening and complete accepted evidence. Approve exact production token/network, declared payer countries and limits. Sandbox/fictional records cannot qualify a live merchant.
- [ ] Configure approved, expiring valuation schedules and monthly billing operations for stablecoins. Publish the 0.10% charge and approved cap in the merchant agreement; gas is paid by the payer and deposits settle whole.
- [ ] Apply the deposit/fee/scan migrations and deploy reviewed web and worker code. Exercise restarts, rate limits, empty pools, late/wrong/duplicate transfers, read-only expired sessions, reconciliation and signed webhook delivery.
- [ ] Complete counsel/security review and a controlled mainnet pilot before general release. Keep all other methods closed. Retain provider-dashboard workflows only for future provider rollout; this release does not automate custody, token sweeps, refunds or payouts.

Local and testnet checks do not certify production readiness. Global launch remains limited to explicitly approved merchant/payer countries, assets and operational capacity.
