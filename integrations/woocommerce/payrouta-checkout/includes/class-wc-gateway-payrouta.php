<?php
/**
 * The PayRouta payment gateway: one option at checkout that opens PayRouta's
 * hosted checkout with every method the store accepts, including credit
 * from licensed lenders and (for USD stores) stablecoins and crypto.
 */

defined( 'ABSPATH' ) || exit;

class WC_Gateway_PayRouta extends WC_Payment_Gateway {

	const FIAT_METHODS = array( 'card', 'bank-transfer', 'mobile-money', 'digital-wallet', 'ussd', 'direct-debit', 'bnpl' );

	public function __construct() {
		$this->id                 = 'payrouta';
		$this->method_title       = __( 'PayRouta', 'payrouta-checkout' );
		$this->method_description = __( 'One checkout for cards, digital wallets, bank transfer, mobile money, USSD, credit from licensed lenders, and stablecoins or crypto from any wallet.', 'payrouta-checkout' );
		$this->has_fields         = false;
		$this->supports           = array( 'products' );

		$this->init_form_fields();
		$this->init_settings();

		$this->title       = $this->get_option( 'title' );
		$this->description = $this->get_option( 'description' );
		$this->enabled     = $this->get_option( 'enabled' );

		add_action( 'woocommerce_update_options_payment_gateways_' . $this->id, array( $this, 'process_admin_options' ) );
	}

	public function init_form_fields() {
		$this->form_fields = array(
			'enabled'        => array(
				'title'   => __( 'Enable', 'payrouta-checkout' ),
				'type'    => 'checkbox',
				'label'   => __( 'Offer PayRouta at checkout', 'payrouta-checkout' ),
				'default' => 'no',
			),
			'title'          => array(
				'title'   => __( 'Title', 'payrouta-checkout' ),
				'type'    => 'text',
				'default' => __( 'Pay with card, wallet, bank, mobile money, credit or crypto', 'payrouta-checkout' ),
			),
			'description'    => array(
				'title'   => __( 'Description', 'payrouta-checkout' ),
				'type'    => 'textarea',
				'default' => '',
			),
			'environment'    => array(
				'title'   => __( 'Environment', 'payrouta-checkout' ),
				'type'    => 'select',
				'options' => array(
					'sandbox'    => __( 'Sandbox (test mode)', 'payrouta-checkout' ),
					'production' => __( 'Production', 'payrouta-checkout' ),
				),
				'default' => 'sandbox',
			),
			'api_url'        => array(
				'title'       => __( 'PayRouta API URL', 'payrouta-checkout' ),
				'type'        => 'text',
				'description' => __( 'For example https://pay.example/api/v1/. Your PayRouta return origin must be this store\'s address.', 'payrouta-checkout' ),
				'default'     => '',
			),
			'secret_key'     => array(
				'title'       => __( 'Secret API key', 'payrouta-checkout' ),
				'type'        => 'password',
				'description' => __( 'A key with payments:write and payments:read, from PayRouta Developers. It starts with pr_sandbox_ or pr_production_.', 'payrouta-checkout' ),
				'default'     => '',
			),
			'webhook_key_id' => array(
				'title'       => __( 'Webhook key ID', 'payrouta-checkout' ),
				'type'        => 'text',
				'description' => sprintf(
					/* translators: %s: webhook URL */
					__( 'Set your PayRouta webhook endpoint to %s with the same key ID and secret.', 'payrouta-checkout' ),
					'<code>' . esc_html( rest_url( 'payrouta/v1/webhook' ) ) . '</code>'
				),
				'default'     => 'v1',
			),
			'webhook_secret' => array(
				'title'   => __( 'Webhook secret', 'payrouta-checkout' ),
				'type'    => 'password',
				'default' => '',
			),
			'methods'        => array(
				'title'   => __( 'Methods to offer', 'payrouta-checkout' ),
				'type'    => 'multiselect',
				'class'   => 'wc-enhanced-select',
				'options' => array(
					'card'           => __( 'Cards and Apple Pay / Google Pay', 'payrouta-checkout' ),
					'bank-transfer'  => __( 'Bank transfer', 'payrouta-checkout' ),
					'mobile-money'   => __( 'Mobile money', 'payrouta-checkout' ),
					'digital-wallet' => __( 'Digital wallets', 'payrouta-checkout' ),
					'ussd'           => __( 'USSD', 'payrouta-checkout' ),
					'direct-debit'   => __( 'Direct debit', 'payrouta-checkout' ),
					'bnpl'           => __( 'Pay with credit (licensed lenders)', 'payrouta-checkout' ),
				),
				'default' => array( 'card', 'digital-wallet', 'bank-transfer', 'mobile-money', 'bnpl' ),
			),
			'crypto_options' => array(
				'title'       => __( 'Crypto (USD stores)', 'payrouta-checkout' ),
				'type'        => 'textarea',
				'description' => __( 'One network|identifier per line, e.g. eip155:8453|erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913 for USDC on Base. Leave empty for no crypto. Requires receive addresses in PayRouta.', 'payrouta-checkout' ),
				'default'     => '',
			),
		);
	}

	public function client() {
		return new PayRouta_Client( $this->get_option( 'api_url' ), $this->get_option( 'secret_key' ), $this->get_option( 'environment' ) );
	}

	public function is_available() {
		return parent::is_available() && $this->client()->is_configured();
	}

	private function crypto_options() {
		$out = array();
		foreach ( preg_split( '/\r\n|\r|\n/', (string) $this->get_option( 'crypto_options' ) ) as $line ) {
			$parts = array_map( 'trim', explode( '|', $line ) );
			if ( 2 === count( $parts ) && '' !== $parts[0] && '' !== $parts[1] ) {
				$out[] = array(
					'network'    => $parts[0],
					'identifier' => $parts[1],
				);
			}
		}
		return array_slice( $out, 0, 20 );
	}

	/** Stable per order, within PayRouta's 8–80 character key format. */
	public static function idempotency_key( WC_Order $order ) {
		return 'wc-' . substr( hash( 'sha256', home_url() . '|' . $order->get_id() . '|' . $order->get_order_key() ), 0, 40 );
	}

	public function process_payment( $order_id ) {
		$order    = wc_get_order( $order_id );
		$currency = $order->get_currency();
		$methods  = array_values( array_intersect( (array) $this->get_option( 'methods', array() ), self::FIAT_METHODS ) );
		$crypto   = 'USD' === $currency ? $this->crypto_options() : array();
		$country  = $order->get_billing_country() ? $order->get_billing_country() : WC()->countries->get_base_country();

		$input = array(
			'reference'    => (string) $order->get_order_number(),
			'payerCountry' => strtoupper( $country ),
			'amount'       => wc_format_decimal( $order->get_total(), wc_get_price_decimals() ),
			'currency'     => $currency,
			'methods'      => $methods,
			'returnUrl'    => $this->get_return_url( $order ),
			'metadata'     => array(
				'woocommerce_order' => (string) $order->get_id(),
				'payer_email'       => (string) $order->get_billing_email(),
			),
		);
		if ( $crypto ) {
			$input['crypto'] = array( 'options' => $crypto );
		}

		try {
			$checkout = $this->client()->create_checkout( $input, self::idempotency_key( $order ) );
		} catch ( Exception $e ) {
			wc_get_logger()->warning( 'PayRouta checkout failed: ' . $e->getMessage(), array( 'source' => 'payrouta' ) );
			wc_add_notice( __( 'We couldn\'t start the secure checkout. Please try again or choose another payment option.', 'payrouta-checkout' ), 'error' );
			return array( 'result' => 'failure' );
		}

		$order->update_meta_data( '_payrouta_checkout', sanitize_text_field( $checkout['id'] ) );
		foreach ( (array) $checkout['intents'] as $intent ) {
			if ( isset( $intent['kind'], $intent['intentId'] ) && in_array( $intent['kind'], array( 'fiat', 'crypto' ), true ) ) {
				$order->update_meta_data( '_payrouta_intent_' . $intent['kind'], sanitize_text_field( $intent['intentId'] ) );
			}
		}
		$order->update_status( 'pending', __( 'Customer sent to PayRouta checkout.', 'payrouta-checkout' ) );
		$order->save();

		return array(
			'result'   => 'success',
			'redirect' => $this->client()->origin() . $checkout['checkoutPath'],
		);
	}
}
