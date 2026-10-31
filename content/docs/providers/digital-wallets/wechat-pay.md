# WeChat Pay (Tenpay)

**Category**: [Digital Wallets](providers/digital-wallets/README.md)  
**Provider**: Tencent Holdings Limited / Tenpay  
**Method ID**: `digital-wallet`  
**Integration Mode**: `STANDARD` / `CONFIGURABLE`

WeChat Pay is embedded directly inside WeChat, China's ubiquitous social and messaging super-app, serving over 1.3 billion monthly active users for peer-to-peer and merchant commerce.

---

## Technical Specifications

- **Corridors**: China domestic (`CNY`), cross-border payments settling in `USD`, `EUR`, `GBP`, `HKD`, `JPY`, `SGD`.
- **Integration Types**: 
  - **Native In-App**: In-app mini-program or app-to-app call.
  - **Quick Pay / QR**: Dynamic QR scanning via the WeChat camera.
  - **H5 Web Pay**: Seamless mobile browser checkout jumping into the WeChat app.
- **Security**: WeChat payment password or Face ID / Touch ID biometric verification.

---

## Webhook Signature Verification

Tenpay events are signed using `RSA-SHA256` or `HMAC-SHA256` using the merchant's API v3 key and platform certificate. PayRouta validates timestamps, nonces, and certificates to guarantee replay prevention.

---

## Payment Intent Example

```json
{
  "amount": "120.00",
  "currency": "EUR",
  "payer_context": {
    "country": "CN"
  },
  "accepted_methods": [
    "digital-wallet"
  ],
  "metadata": {
    "preferred_wallet": "wechat-pay"
  }
}
```

---

## Same-Method Failover

WeChat Pay serves as an immediate backup route to Alipay for Chinese consumers and cross-border Asian travel checkouts.
