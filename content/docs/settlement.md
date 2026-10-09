# Settlement

Your providers settle to you directly, into the destination you configured in your own account with each provider. PayRouta never receives, holds or forwards your funds. What PayRouta does is **track and reconcile** settlement across all your providers in one place.

## Confirmation versus settlement

These are separate facts:

| Fact | Meaning | Event |
| --- | --- | --- |
| Confirmation | The provider accepted the customer's funds | `payment.confirmed` |
| Settlement | The provider reported paying your share to you | `settlement.completed` |

Fulfil orders on confirmation. Settlement timing follows each provider's own schedule, which may be daily or weekly, and differs between methods.

## Reconciliation

PayRouta matches:

- each confirmed payment
- the provider's settlement report
- the fee the provider actually deducted
- the allocation of each settlement to individual payments

Matching is by exact reference, never by amount or date alone. These differences become **exceptions**, which PayRouta raises instead of adjusting silently:

- missing payments
- conflicting outcomes
- amount or currency differences
- fee mismatches
- partial or unallocated settlements
- funds that arrive after an intent expired
- outcomes still unknown after five minutes

Exceptions appear in the dashboard under **Payment issues** and are sent as `settlement.exception` events.

## Settlement API

`GET /settlements` lists settlements that include your payments. Amounts are integer strings in minor units; `gross`, `fee` and `net` cover only your allocations. `reconciliation` reports whether the provider's figures matched.

## Records

PayRouta keeps an operational journal of what each provider reported for your payments. It is a record of your providers' activity, **not** a balance held by PayRouta.
