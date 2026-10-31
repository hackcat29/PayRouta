# Mastercard & Mastercard Send

**Category**: [Cards](providers/cards/README.md)  
**Provider**: Mastercard International  
**Method ID**: `card`  
**Integration Mode**: `STANDARD` / `NATIVE`

Mastercard provides global consumer and commercial card clearing, network tokenization (MDES), and instant push rails through Mastercard Send.

---

## Tokenization & Security

- **Network Tokens**: Replaces vulnerable 16-digit card numbers with secure cryptographic tokens, improving authorization rates by up to 300 basis points.
- **Mastercard Identity Check**: Frictionless biometric checkout and risk-based Strong Customer Authentication (SCA).

---

## Failover Strategy

PayRouta balances traffic between Stripe, local processors, and direct Mastercard clearing routes based on merchant preference policy (`Balanced`, `Lower cost`, or `Faster`).
