# Merchant stage audit — 2026-09-20

Inspection precedes changes. Existing uncommitted portal/payment work is preserved.

| Area | Existing files and behavior | Verified status at inspection | Required change |
|---|---|---|---|
| Approval → publication | lib/portal/service.ts, registry.ts; versioned review and published profiles | Existing; tests not yet rerun | Reuse for account qualification |
| Availability → customer choice | availability-service.ts, app/checkout, payments/service.ts | Existing sandbox implementation | Keep contextual method selection |
| Route → execution | payments/service.ts, execution.ts, processing.ts | Partial: persistent simulator only, live closed | Real account-specific adapters and economics |
| Settlement → reconciliation → journal | payments/processing.ts, reports.ts, journal.ts; database guards | Existing sandbox implementation | Real provider evidence and qualification |
| Merchant access | MerchantConfig and Membership; session API /api/payments | Partial; one environment per merchant config | Scoped API credentials, public projections, API contract |
| Merchant webhooks | payments/delivery.ts, MerchantEvent/Delivery | Existing durable signed delivery | Merchant controls and SDK verification |
| Dashboard | provider/payments fixture, ops/payments | Merchant workspace missing | Merchant-scoped queries and interfaces |
| Risk/compliance | Portal evidence/reviews, trusted availability restrictions | Partial; no merchant review/velocity workflow | Reuse evidence and audit, add merchant-specific policy |
| SDKs | None | Missing | Node/Python clients and tests |
| Pilot/coverage | Simulator fixtures, published profiles | Partial; no real pilot evidence | Explicit qualification/preflight and stop gates |

The existing MerchantConfig has one environment per organization. This stage must reject mismatched environment access rather than imply simultaneous live/sandbox configuration is supported. Production execution remains closed until real adapter and account qualification are implemented and verified.
