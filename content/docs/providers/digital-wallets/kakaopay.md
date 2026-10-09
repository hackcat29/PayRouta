# KakaoPay

> **Implementation status:** Provider code path: adyen. Not live-qualified by code alone. Merchant account enablement, credentials and sandbox qualification are required. See [current coverage](provider-coverage.md).

**Category**: [Digital Wallets](providers/digital-wallets/README.md)  
**Provider**: KakaoPay Corp. (Kakao Corporation & Ant Group)  
**Method ID**: `digital-wallet`  
**Integration Mode**: `STANDARD` / `CONFIGURABLE`

KakaoPay is South Korea's premier digital wallet, built directly into KakaoTalk—the country's primary messenger used by over 95% of South Koreans.

---

## Technical Specifications

- **Corridor**: South Korea (`KRW`), cross-border merchant settlement in `USD`.
- **Payment Experience**:
  - **KakaoTalk Push**: Automatic push alert directly inside KakaoTalk messenger.
  - **Biometric 1-Tap**: Secured by KakaoPay biometric fingerprint / face authentication.
- **Zero Chargeback Risk**: Regulated electronic financial transaction with non-repudiable user confirmation.

---

## Failover Strategy

PayRouta falls over between KakaoPay, **Naver Pay**, and domestic Korean card acquiring networks (BC Card, Shinhan, Hyundai).
