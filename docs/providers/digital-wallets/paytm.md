# Paytm

> **Implementation status:** Provider code path: adyen. Not live-qualified by code alone. Merchant account enablement, credentials and sandbox qualification are required. See [current coverage](provider-coverage.md).

**Category**: [Digital Wallets](providers/digital-wallets/README.md)  
**Provider**: One97 Communications Limited  
**Method ID**: `digital-wallet`  
**Integration Mode**: `STANDARD` / `CONFIGURABLE`

Paytm pioneered digital wallets in India and remains an essential consumer payment channel for hundreds of millions of shoppers across e-commerce, utilities, and retail stores.

---

## Technical Specifications

- **Corridor**: India (`INR`).
- **Features**: Paytm Wallet stored balance, UPI push, Paytm Postpaid (BNPL), and NetBanking fallback.
- **Speed**: Sub-second wallet deductions with instant callback confirmation.
- **Merchant Direct Account**: Pre-filled KYB onboarding through PayRouta with direct merchant settlements.
