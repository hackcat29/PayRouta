# GrabPay

> **Implementation status:** Provider code path: stripe, adyen, xendit. Not live-qualified by code alone. Merchant account enablement, credentials and sandbox qualification are required. See [current coverage](provider-coverage.md).

**Category**: [Digital Wallets](providers/digital-wallets/README.md)  
**Provider**: Grab Holdings Inc.  
**Method ID**: `digital-wallet`  
**Integration Mode**: `STANDARD` / `CONFIGURABLE`

GrabPay is the leading everyday digital wallet across Southeast Asia, deeply integrated into the Grab super-app ecosystem spanning Singapore, Malaysia, the Philippines, Indonesia, and Vietnam.

---

## Technical Specifications

- **Corridors**: Singapore (`SGD`), Malaysia (`MYR`), Philippines (`PHP`), Thailand (`THB`), Vietnam (`VND`).
- **Authorization Flow**:
  - **Mobile**: Universal Links jump straight into the Grab app for 1-tap PIN or biometric confirmation.
  - **Desktop**: QR code displayed on screen for instant phone scanning.
- **Settlement**: Direct local bank transfer to merchant accounts or regional GrabPay merchant wallets.

---

## Merchant-Owned Accounts

Merchants contract directly with Grab Financial Services, maintaining control over their Grab Merchant portal, transaction records, and settlement currency preferences.

---

## Payment Intent Example

```json
{
  "amount": "85.00",
  "currency": "SGD",
  "payer_context": {
    "country": "SG"
  },
  "accepted_methods": [
    "digital-wallet",
    "bank-transfer"
  ],
  "metadata": {
    "preferred_wallet": "grabpay"
  }
}
```

---

## Failover Within Southeast Asia

If GrabPay encounters gateway degradation, PayRouta automatically falls over to **ShopeePay**, regional bank transfers (e.g. MAS PayNow in Singapore or DuitNow in Malaysia), or local cards.
