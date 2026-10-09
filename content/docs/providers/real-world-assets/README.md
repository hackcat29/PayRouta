# Real-World Asset (RWA) Providers

Tokenized Real-World Assets (RWAs) enable merchants to hold and settle payments in yield-bearing, institutional-grade instruments backed by short-term US Treasury bills and bank demand deposits.

---

## Supported Providers

| Provider / Asset | Underlying Collateral | Target Yield | Settlement Type |
| --- | --- | --- | --- |
| [**Ondo USDY**](providers/real-world-assets/ondo-usdy.md) | US Treasuries & Bank Demand Deposits | ~5.0%+ variable APY | On-chain token transfer / note |

---

## Treasury Management at Checkout

Instead of holding non-interest-bearing fiat balances, enterprise merchants can specify RWA target instruments in the `settlement` object of their PayRouta Payment Intent. Payments automatically settle into yield-bearing assets upon completion.
