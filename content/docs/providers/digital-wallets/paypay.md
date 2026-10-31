# PayPay

**Category**: [Digital Wallets](providers/digital-wallets/README.md)  
**Provider**: PayPay Corporation (SoftBank & LY Corporation)  
**Method ID**: `digital-wallet`  
**Integration Mode**: `STANDARD` / `CONFIGURABLE`

PayPay is Japan's dominant QR code and mobile digital wallet with over 64 million registered users, commanding more than two-thirds of Japan's code payment market.

---

## Technical Specifications

- **Corridor**: Japan (`JPY`).
- **Checkout Experience**:
  - **App-to-App Calling**: On smartphones, deep links straight into the PayPay app for 1-tap confirmation.
  - **Desktop Display**: Dynamic QR code scanned with the Japanese consumer's smartphone.
- **Settlement**: Japanese domestic Zengin bank transfers into the merchant's corporate bank account.

---

## Payment Intent Example

```json
{
  "amount": "12500",
  "currency": "JPY",
  "payer_context": {
    "country": "JP"
  },
  "accepted_methods": [
    "digital-wallet",
    "card"
  ],
  "metadata": {
    "preferred_wallet": "paypay"
  }
}
```

---

## Failover Strategy

If PayPay experiences carrier downtime in Japan, PayRouta fails over to **LINE Pay**, **Rakuten Pay**, or domestic **JCB** cards.
