# Airtel Money

**Category**: [Mobile Money](providers/mobile-money/README.md)  
**Provider**: Airtel Africa / Bharti Airtel  
**Method ID**: `mobile-money`  
**Integration Mode**: `NATIVE` / `STANDARD`

Airtel Money is a major mobile financial services provider across 14 African countries and India (Airtel Payments Bank).

---

## Technical Specifications

- **Integration**: Direct REST collection prompts with webhook status delivery.
- **Failover**: Serves as the primary backup rail when Safaricom or MTN switches experience carrier-specific congestion.
- **Currency Support**: `KES`, `UGX`, `TZS`, `MWK`, `ZMW`, `INR`.
