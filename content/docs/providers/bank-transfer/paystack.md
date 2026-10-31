# Paystack

**Category**: [Bank Transfer](providers/bank-transfer/README.md)  
**Provider**: Paystack Payments Limited (Stripe subsidiary)  
**Method ID**: `bank-transfer`, `card`, `ussd`, `mobile-money`  
**Integration Mode**: `NATIVE`

Paystack is a leading payment processor across Africa, powering instant bank transfers, local cards, USSD codes, and mobile money in Nigeria, Ghana, Kenya, and South Africa.

---

## Integration Details

- **Adapter**: Native Paystack adapter in PayRouta.
- **Base URL**: `https://api.paystack.co`
- **Supported Operations**: `pay-in`, `payout`, `settlement`
- **Authentication**: `Bearer <secretKeyRef>` via PayRouta's encrypted credential vault.
- **Webhook Signature**: `HMAC-SHA512(body, secretKey)` evaluated via timing-safe comparison.

---

## Capabilities & Corridors

| Country | Method | Currency | Rail Description |
| --- | --- | --- | --- |
| **Nigeria (NG)** | `bank-transfer` | `NGN` | NIP instant dynamic account numbers (Titan, Wema, Sterling) |
| **Nigeria (NG)** | `card` | `NGN` | Verve, Visa, Mastercard domestic acquiring |
| **Ghana (GH)** | `mobile-money` | `GHS` | MTN MoMo, Vodafone Cash, AirtelTigo |
| **South Africa (ZA)** | `bank-transfer` | `ZAR` | Ozow EFT, automated interbank transfer |

---

## Configuration Example

```json
{
  "adapter": "paystack",
  "mode": "NATIVE",
  "maintainedBy": "PAYROUTA",
  "secretKeyRef": "vault:paystack:secret_key",
  "timeoutMs": 8000
}
```

---

## Status Mapping

| Paystack Status | PayRouta Normalized State | Action |
| --- | --- | --- |
| `success` | `Confirmed` | Payment completed, funds settled |
| `abandoned`, `failed` | `Rejected` | Attempt failed, eligible for failover |
| `ongoing`, `pending` | `Requires action` / `Pending` | Waiting for payer transfer |
