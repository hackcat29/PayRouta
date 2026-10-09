# MTN MoMo

> **Implementation status:** Provider code path: mtn-momo, paystack, flutterwave. Not live-qualified by code alone. Merchant account enablement, credentials and sandbox qualification are required. See [current coverage](provider-coverage.md).

**Category**: [Mobile Money](providers/mobile-money/README.md)  
**Provider**: MTN Group Fintech  
**Method ID**: `mobile-money`  
**Integration Mode**: `NATIVE` / `STANDARD`

MTN Mobile Money (MoMo) provides mobile payment services across 16 markets in Africa, including Ghana, Uganda, Nigeria (MoMo PSB), Côte d'Ivoire, Cameroon, and Rwanda.

---

## Capabilities

- **Collections API**: RequestToPay functionality with automated prompt to the customer's device.
- **Disbursements API**: Direct automated supplier and vendor payouts directly into MoMo wallets.
- **Corridors**: `GHS`, `UGX`, `NGN`, `XOF`, `XAF`.
