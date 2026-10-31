=== PayRouta Checkout ===
Contributors: payrouta
Tags: payments, checkout, buy now pay later, mobile money, crypto
Requires at least: 6.4
Tested up to: 7.1
Requires PHP: 7.4
Stable tag: 0.1.0
License: GPLv2 or later

One checkout for every way your customers pay, including credit.

== Description ==

PayRouta gives your store one payment option that opens a secure PayRouta checkout. Customers choose how to pay there:

* Cards, Apple Pay and Google Pay
* Digital wallets such as PayPal and local wallets, where available
* Bank transfer, USSD and mobile money (M-Pesa, MTN MoMo and others)
* Pay with credit: instalments from licensed lenders in the customer's country. You are paid in full; the lender carries the credit risk.
* Stablecoins and crypto from any wallet, on any network (USD stores)

Only methods that PayRouta has opened for your account and the customer's country are shown. Card details, credit applications and wallet signatures never touch WordPress.

== Installation ==

1. Upload the plugin and activate it. WooCommerce 8.2+ is required.
2. In PayRouta, set your return origin to this store's address and create an API key with payments:write and payments:read.
3. In WooCommerce > Settings > Payments > PayRouta, enter the API URL, environment and secret key.
4. In PayRouta Developers, set the webhook endpoint to https://YOUR-STORE/wp-json/payrouta/v1/webhook with a key ID and secret, and enter the same key ID and secret in the plugin.
5. Place a test order in sandbox mode.

== Frequently Asked Questions ==

= When is an order marked paid? =

Only after a signed payment.confirmed webhook arrives and the plugin reads the payment back from the PayRouta API and checks the amount and currency. Returning from checkout alone never marks an order paid.

= Refunds? =

Issue refunds from your PayRouta dashboard. Refunding from WooCommerce is not supported in this version.

== Changelog ==

= 0.1.0 =
* First private release.
