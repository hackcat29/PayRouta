# PhonePe

> **Implementation status:** Provider code path: phonepe. Not live-qualified by code alone. UPI checkout can use PhonePe or another UPI app; wallet-balance debit is not implemented. See [current coverage](provider-coverage.md).

**Category**: [Digital Wallets](providers/digital-wallets/README.md)  
**Provider**: PhonePe Private Limited (Walmart subsidiary)  
**Method ID**: `digital-wallet`  
**Integration Mode**: `STANDARD` / `CONFIGURABLE`

PhonePe is India's leading digital payments super-app, commanding over 48% market share of all Unified Payments Interface (UPI) transactions with more than 500 million registered users.

---

## Technical Specifications

- **Corridor**: India (`INR`).
- **Payment Modes**:
  - **UPI Intent Flow**: Automatically triggers the PhonePe Android / iOS app on mobile checkout for 1-tap UPI PIN entry.
  - **PhonePe Wallet**: Stored balance deduction with zero bank-server dependencies.
  - **Dynamic UPI QR**: On desktop, renders dynamic UPI QR for mobile scan.
- **Settlement**: NPCI interbank clearing settling directly to merchant Current Account in India.

---

## Payment Intent Example

```json
{
  "amount": "1499.00",
  "currency": "INR",
  "payer_context": {
    "country": "IN"
  },
  "accepted_methods": [
    "digital-wallet",
    "upi"
  ],
  "metadata": {
    "preferred_wallet": "phonepe"
  }
}
```

---

## Failover Within India

If PhonePe or its sponsor bank switch reports latency, PayRouta instantly reroutes checkout to **Paytm**, **Google Pay (Tez)**, or direct RuPay debit rails.
