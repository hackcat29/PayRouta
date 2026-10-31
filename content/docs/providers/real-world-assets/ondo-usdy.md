# Ondo USDY (US Dollar Yield)

**Category**: [Real-World Assets](providers/real-world-assets/README.md)  
**Provider**: Ondo Finance  
**Method ID**: `ondo_usdy`, `rwa`  
**Integration Mode**: `NATIVE` (Institutional Asset Note)

Ondo USDY (US Dollar Yield) is a tokenized note secured by short-term US Treasuries and high-grade bank demand deposits, offering institutional yield for cross-border merchants.

---

## Technical Specifications

- **Token Standard**: ERC-20 token on Ethereum, Arbitrum, Solana, and Mantle.
- **Yield Mechanism**: Variable APY (~5.0%+) accruing continuously through token value appreciation or rebasing.
- **Bankruptcy-Remote**: Structured through an independent bankruptcy-remote trust with Ankura Trust acting as collateral agent.

---

## Settlement Configuration

To settle transactions into Ondo USDY, specify `ondo_usdy` in the payment intent `settlement` object:

```json
{
  "amount": "1200.00",
  "currency": "USD",
  "payer_context": {
    "country": "US"
  },
  "settlement": {
    "currency": "USD",
    "target_instrument": "ondo_usdy"
  },
  "accepted_methods": [
    "card",
    "bank-transfer",
    "stablecoin"
  ]
}
```
