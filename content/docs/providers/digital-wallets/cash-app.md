# Cash App Pay

**Category**: [Digital Wallets](providers/digital-wallets/README.md)  
**Provider**: Block, Inc. (formerly Square)  
**Method ID**: `digital-wallet`  
**Integration Mode**: `STANDARD` / `CONFIGURABLE`

Cash App Pay allows over 55 million monthly active Cash App users in the United States to pay seamlessly from their Cash App balance or linked debit card using QR codes or mobile deep links.

---

## Technical Specifications

- **Corridor**: United States (`USD`).
- **Payment Experience**:
  - **Mobile**: Dynamic button tap opens Cash App for instant $Cashtag confirmation.
  - **Desktop**: Renders dynamic on-screen QR code scanned with the Cash App camera.
- **Settlement**: Next-business-day ACH deposit to merchant US bank account.

---

## Payment Intent Example

```json
{
  "amount": "65.00",
  "currency": "USD",
  "payer_context": {
    "country": "US"
  },
  "accepted_methods": [
    "digital-wallet",
    "card"
  ],
  "metadata": {
    "preferred_wallet": "cash-app"
  }
}
```

---

## Failover Strategy

PayRouta balances US mobile wallet checkouts across Cash App Pay, **Apple Pay**, and **Venmo**.
