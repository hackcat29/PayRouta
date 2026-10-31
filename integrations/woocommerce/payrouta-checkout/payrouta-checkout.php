<?php
/**
 * Plugin Name:       PayRouta Checkout
 * Plugin URI:        https://payrouta.com/docs/woocommerce
 * Description:       One checkout for every way your customers pay: cards, digital wallets, bank transfer, mobile money, USSD, credit from licensed lenders, and stablecoins or crypto from any wallet.
 * Version:           0.1.0
 * Requires at least: 6.4
 * Requires PHP:      7.4
 * Requires Plugins:  woocommerce
 * WC requires at least: 8.2
 * WC tested up to:   11.2
 * Author:            PayRouta
 * License:           GPL-2.0-or-later
 * Text Domain:       payrouta-checkout
 *
 * The customer is sent to PayRouta's hosted checkout (no card data touches
 * WordPress). The order is marked paid only after a signed PayRouta webhook
 * arrives and the plugin re-reads the payment from the PayRouta API.
 */

defined( 'ABSPATH' ) || exit;

define( 'PAYROUTA_CHECKOUT_VERSION', '0.1.0' );
define( 'PAYROUTA_CHECKOUT_FILE', __FILE__ );

// Works with High-Performance Order Storage and the block-based checkout.
add_action(
	'before_woocommerce_init',
	function () {
		if ( class_exists( '\Automattic\WooCommerce\Utilities\FeaturesUtil' ) ) {
			\Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility( 'custom_order_tables', __FILE__, true );
			\Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility( 'cart_checkout_blocks', __FILE__, true );
		}
	}
);

add_action(
	'plugins_loaded',
	function () {
		if ( ! class_exists( 'WC_Payment_Gateway' ) ) {
			return;
		}
		require_once __DIR__ . '/includes/class-payrouta-client.php';
		require_once __DIR__ . '/includes/class-wc-gateway-payrouta.php';
		require_once __DIR__ . '/includes/class-payrouta-webhook.php';

		add_filter(
			'woocommerce_payment_gateways',
			function ( $gateways ) {
				$gateways[] = 'WC_Gateway_PayRouta';
				return $gateways;
			}
		);
		PayRouta_Webhook::register();
	}
);

add_action(
	'woocommerce_blocks_loaded',
	function () {
		if ( ! class_exists( '\Automattic\WooCommerce\Blocks\Payments\Integrations\AbstractPaymentMethodType' ) ) {
			return;
		}
		require_once __DIR__ . '/includes/class-payrouta-blocks.php';
		add_action(
			'woocommerce_blocks_payment_method_type_registration',
			function ( $registry ) {
				$registry->register( new PayRouta_Blocks() );
			}
		);
	}
);
