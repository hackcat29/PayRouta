# Mobile Money Providers

Mobile money accounts issued by telecom operators dominate consumer payments across Sub-Saharan Africa and parts of South Asia. Customers pay by approving an instant prompt on their mobile phone (SIM Toolkit STK Push or USSD menu).

PayRouta connects merchants to licensed mobile money operators with automated fallback routing and instant status verification.

---

## Supported Mobile Money Providers

| Provider | Region | Rails | Features |
| --- | --- | --- | --- |
| [**Safaricom M-Pesa**](providers/mobile-money/mpesa.md) | Kenya, Tanzania, Ethiopia | STK Push, Daraja C2B/B2C, Paybill | > 90% market share in East Africa |
| [**MTN MoMo**](providers/mobile-money/mtn-momo.md) | Ghana, Uganda, Nigeria, Côte d'Ivoire | MoMo API STK & USSD | 60M+ active users across 16 countries |
| [**Airtel Money**](providers/mobile-money/airtel-money.md) | Kenya, Uganda, Nigeria, India | Direct telco API push | Instant cross-network mobile settlements |

---

## Failover Within Mobile Money

If Safaricom or MTN MoMo gateway experiences an STK push timeout, PayRouta automatically presents USSD shortcodes (*334#, *170#) or fails over to alternative regional collection switches so transactions do not drop.
