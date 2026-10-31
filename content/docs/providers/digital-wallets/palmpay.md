# PalmPay Wallet

**Category**: [Digital Wallets](providers/digital-wallets/README.md)  
**Provider**: PalmPay Limited  
**Method ID**: `digital-wallet`  
**Integration Mode**: `NATIVE` / `STANDARD`

PalmPay is a high-growth mobile wallet platform operating across Nigeria and Ghana, providing instant digital balance deductions, QR code scanning, and zero-fee checkout incentives.

---

## Technical Flow

- **Direct Push Notification**: The customer receives a payment request notification on their smartphone.
- **In-App PIN Authorization**: The customer inputs their secure PIN to confirm the payment.
- **Instant Webhook Resolution**: PayRouta receives an authorized status callback and settles the payment immediately.
