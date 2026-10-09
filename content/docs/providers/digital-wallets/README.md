# Digital Wallet Providers

Digital wallets offer fast, 1-tap, biometric checkout experiences by allowing shoppers to pay with stored balances, linked bank accounts, or tokenized cards.

PayRouta connects merchants to global tech wallets as well as dominant regional champion wallets across Africa, Asia, Latin America, Europe, and North America through merchant-owned accounts.

---

## Global Directory of Digital Wallets

Explore dedicated provider integration guides organized by geographic region:

### Global & Multi-Regional
| Provider | Coverage | Key Modalities |
| --- | --- | --- |
| [**Apple Pay**](providers/digital-wallets/apple-pay.md) | iOS / macOS Global | Face ID / Touch ID biometric 1-tap, network tokens |
| [**Google Pay**](providers/digital-wallets/google-pay.md) | Android / Chrome Global | Frictionless Google Wallet tokenized checkout |
| [**PayPal**](providers/digital-wallets/paypal.md) | Global (200+ countries) | Stored wallet balance, buyer protection, multi-currency |

### East Asia (China, Japan, South Korea)
| Provider | Primary Markets | Features |
| --- | --- | --- |
| [**Alipay**](providers/digital-wallets/alipay.md) | China & Global Cross-border | 1B+ users, dynamic barcode/QR, zero chargebacks |
| [**WeChat Pay**](providers/digital-wallets/wechat-pay.md) | China & Global Cross-border | 1.3B+ users, Tenpay mini-program & in-app checkout |
| [**PayPay**](providers/digital-wallets/paypay.md) | Japan | 64M+ users, Japan's #1 QR & smartphone wallet |
| [**KakaoPay**](providers/digital-wallets/kakaopay.md) | South Korea | KakaoTalk integrated 1-tap biometric authorization |

### Southeast Asia
| Provider | Primary Markets | Features |
| --- | --- | --- |
| [**GrabPay**](providers/digital-wallets/grabpay.md) | Singapore, Malaysia, Philippines, Vietnam | Grab super-app ecosystem wallet & PIN authorization |
| [**GCash**](providers/digital-wallets/gcash.md) | Philippines | 80M+ users, QR Ph standard, BSP-regulated |
| [**ShopeePay**](providers/digital-wallets/shopeepay.md) | Southeast Asia & Brazil | SeaMoney in-app wallet, QRIS / DuitNow QR support |

### South Asia (India)
| Provider | Primary Markets | Features |
| --- | --- | --- |
| [**PhonePe**](providers/digital-wallets/phonepe.md) | India | 500M+ users, #1 UPI digital wallet (48% market share) |
| [**Paytm**](providers/digital-wallets/paytm.md) | India | Pioneer stored wallet balance, dynamic UPI QR |

### Latin America
| Provider | Primary Markets | Features |
| --- | --- | --- |
| [**Mercado Pago**](providers/digital-wallets/mercado-pago.md) | Brazil, Mexico, Argentina, Colombia, Chile | 100M+ users, wallet balance, installments, Pix hybrid |
| [**PicPay**](providers/digital-wallets/picpay.md) | Brazil | 35M+ users, dynamic in-app QR code, instant push |

### Europe & United Kingdom
| Provider | Primary Markets | Features |
| --- | --- | --- |
| [**Revolut Pay**](providers/digital-wallets/revolut-pay.md) | UK & Europe | 45M+ users, 1-click biometric in-app push, 25+ currencies |
| [**Wero (EPI)**](providers/digital-wallets/wero.md) | Germany, France, Benelux | Pan-European SCT Inst bank wallet backed by major Eurozone banks |

### North America (United States)
| Provider | Primary Markets | Features |
| --- | --- | --- |
| [**Cash App Pay**](providers/digital-wallets/cash-app.md) | United States | 55M+ users, $Cashtag 1-tap mobile & desktop QR checkout |
| [**Venmo**](providers/digital-wallets/venmo.md) | United States | 85M+ users, social payments feed, mobile app switch |

### Africa & Diaspora
| Provider | Primary Markets | Features |
| --- | --- | --- |
| [**OPay Wallet**](providers/digital-wallets/opay.md) | Nigeria / West Africa | 40M+ consumers, instant biometric approval |
| [**PalmPay Wallet**](providers/digital-wallets/palmpay.md) | Nigeria / Ghana | High authorization rates, in-app QR, zero network drops |
| [**Chipper Cash**](providers/digital-wallets/chipper-cash.md) | Pan-Africa, UK, US | Multicurrency wallet, cross-border diaspora settlements |

---

## Same-Method Failover Within Digital Wallets

PayRouta maintains regional failover clusters within the digital wallet family:
- **US**: If Cash App Pay times out, PayRouta presents Apple Pay or Venmo.
- **UK / Europe**: If Revolut Pay or Wero encounters gateway latency, checkout offers Apple Pay, Google Pay, or SEPA Instant.
- **East Asia**: If Alipay reports bank route maintenance, checkout fails over to WeChat Pay.
- **Southeast Asia**: If GrabPay reports gateway maintenance, checkout fails over to ShopeePay or localized instant bank QR.
- **Latin America**: If Mercado Pago experiences acquiring delays, PayRouta routes to PicPay or Pix in Brazil.
- **West Africa**: If OPay experiences carrier downtime, PayRouta routes immediately to PalmPay or Chipper Cash.
