<?php
/**
 * PayRouta in the block-based Cart and Checkout.
 */

defined( 'ABSPATH' ) || exit;

use Automattic\WooCommerce\Blocks\Payments\Integrations\AbstractPaymentMethodType;

final class PayRouta_Blocks extends AbstractPaymentMethodType {
	protected $name = 'payrouta';

	public function initialize() {
		$this->settings = get_option( 'woocommerce_payrouta_settings', array() );
	}

	public function is_active() {
		$gateways = WC()->payment_gateways()->payment_gateways();
		return isset( $gateways['payrouta'] ) && $gateways['payrouta']->is_available();
	}

	public function get_payment_method_script_handles() {
		wp_register_script(
			'payrouta-blocks',
			plugins_url( 'assets/blocks.js', PAYROUTA_CHECKOUT_FILE ),
			array( 'wc-blocks-registry', 'wc-settings', 'wp-element', 'wp-html-entities' ),
			PAYROUTA_CHECKOUT_VERSION,
			true
		);
		return array( 'payrouta-blocks' );
	}

	public function get_payment_method_data() {
		return array(
			'title'       => isset( $this->settings['title'] ) ? $this->settings['title'] : 'PayRouta',
			'description' => isset( $this->settings['description'] ) ? $this->settings['description'] : '',
			'supports'    => array( 'products' ),
		);
	}
}
