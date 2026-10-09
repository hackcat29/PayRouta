# Chipper Cash

> **Implementation status:** Direct execution is not implemented; this guide describes planned/reference scope. Requires partner API contract and credentials. See [current coverage](provider-coverage.md).

**Category**: [Digital Wallets](providers/digital-wallets/README.md)  
**Provider**: Critical Ideas, Inc. (Chipper Cash)  
**Method ID**: `digital-wallet`  
**Integration Mode**: `STANDARD` / `CONFIGURABLE`

Chipper Cash is a leading cross-border fintech and digital wallet across Africa, enabling seamless peer-to-peer payments, merchant checkouts, and international remittances across Nigeria, Ghana, Kenya, Rwanda, Uganda, the UK, and the US.

---

## Technical Specifications

- **Corridors**: Nigeria (`NGN`), Ghana (`GHS`), Kenya (`KES`), Uganda (`UGX`), Rwanda (`RWF`), United Kingdom (`GBP`), United States (`USD`).
- **Features**: Cross-border multicurrency wallet, direct account push, virtual card processing.
- **Settlement**: Rapid local currency bank clearing or USD treasury settlement for international merchants.

---

## Failover Strategy

PayRouta balances African wallet checkouts between Chipper Cash, **OPay**, **PalmPay**, and telecom-backed mobile money rails (M-Pesa, MTN MoMo).
