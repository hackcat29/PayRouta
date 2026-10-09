# OPay Wallet

> **Implementation status:** Native `opay` wallet QR and authenticated status polling are implemented. NGN/Nigeria only; account approval and sandbox qualification remain required. See [current coverage](provider-coverage.md).

**Method ID**: `digital-wallet`  
**Integration Mode**: `NATIVE`

Configure a Nigerian merchant ID and secret-store key reference. Test and live API origins are fixed to OPay's official environment endpoints. Checkout explicitly requests `OpayWalletNgQR`; it never substitutes card funding. Optional `metadata.preferred_wallet: "opay"` restricts the wallet selection.

Creation signs the exact request JSON with HMAC-SHA512, sends integer NGN minor units and a stable merchant reference, and validates the returned reference, order and amount. The provider's wallet QR URL is encoded locally and displayed for scanning in OPay. Confirmation requires authenticated signed status polling and an exact `SUCCESS` receipt. Buyer scanning or callbacks alone do not confirm funds. No refunds, payouts or settlement reports were added.

See [OPay wallet payment](https://documentation.opaycheckout.com/opay-wallet-payment) and [status queries](https://documentation.opaycheckout.com/query-payment-status).
