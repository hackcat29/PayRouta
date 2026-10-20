<?php
/**
 * POST /wp-json/payrouta/v1/webhook
 *
 * Verifies PayRouta's signature on the untouched body, ignores events it has
 * already handled, and re-reads the payment from the PayRouta API before
 * marking an order paid: a webhook only prompts a check, it never changes an
 * order by itself.
 */

defined( 'ABSPATH' ) || exit;

class PayRouta_Webhook {

	public static function register() {
		add_action(
			'rest_api_init',
			function () {
				register_rest_route(
					'payrouta/v1',
					'/webhook',
					array(
						'methods'             => 'POST',
						'callback'            => array( __CLASS__, 'handle' ),
						// Authenticated by the PayRouta signature below.
						'permission_callback' => '__return_true',
					)
				);
			}
		);
	}

	private static function gateway() {
		$gateways = WC()->payment_gateways()->payment_gateways();
		return isset( $gateways['payrouta'] ) ? $gateways['payrouta'] : null;
	}

	public static function handle( WP_REST_Request $request ) {
		$gateway = self::gateway();
		if ( ! $gateway ) {
			return new WP_REST_Response( null, 503 );
		}
		$raw = $request->get_body();
		$ok  = PayRouta_Client::verify_webhook(
			$raw,
			(string) $request->get_header( 'payrouta-timestamp' ),
			(string) $request->get_header( 'payrouta-event-id' ),
			(string) $request->get_header( 'payrouta-key-id' ),
			(string) $request->get_header( 'payrouta-signature' ),
			array( (string) $gateway->get_option( 'webhook_key_id' ) => (string) $gateway->get_option( 'webhook_secret' ) )
		);
		if ( ! $ok ) {
			return new WP_REST_Response( null, 400 );
		}
		$event = json_decode( $raw, true );
		if ( ! is_array( $event ) || empty( $event['objectId'] ) || empty( $event['type'] ) ) {
			return new WP_REST_Response( null, 400 );
		}
		$order = self::order_for( (string) $event['objectId'] );
		// Not ours (another integration on the same workspace): acknowledge.
		if ( ! $order ) {
			return new WP_REST_Response( null, 204 );
		}
		$seen = (array) $order->get_meta( '_payrouta_events' );
		if ( in_array( $event['id'], $seen, true ) ) {
			return new WP_REST_Response( null, 204 );
		}

		if ( 'payment.confirmed' === $event['type'] && ! $order->is_paid() ) {
			try {
				$payment = $gateway->client()->get_payment( (string) $event['objectId'] );
			} catch ( Exception $e ) {
				// PayRouta retries the delivery.
				return new WP_REST_Response( null, 503 );
			}
			$currency = isset( $payment['asset']['identifier'] ) ? $payment['asset']['identifier'] : '';
			$fiat     = isset( $payment['asset']['kind'] ) && 'fiat' === $payment['asset']['kind'];
			// With fees passed to the customer, the order total is the base amount.
			$charged  = ! empty( $payment['baseAmount'] ) ? $payment['baseAmount'] : ( isset( $payment['amount'] ) ? $payment['amount'] : '' );
			$matches  = ! $fiat || ( $currency === $order->get_currency()
				&& wc_format_decimal( $charged, wc_get_price_decimals() ) === wc_format_decimal( $order->get_total(), wc_get_price_decimals() ) );
			if ( isset( $payment['state'] ) && 'Confirmed' === $payment['state'] && $matches ) {
				$order->payment_complete( (string) $event['objectId'] );
				$order->add_order_note(
					sprintf(
						/* translators: 1: method, 2: amount */
						__( 'Paid through PayRouta (%1$s, %2$s).', 'payrouta-checkout' ),
						isset( $payment['selectedMethod'] ) ? $payment['selectedMethod'] : 'unknown method',
						$payment['amount'] . ' ' . ( $fiat ? $currency : 'on-chain' )
					)
				);
			} elseif ( isset( $payment['state'] ) && 'Confirmed' === $payment['state'] ) {
				$order->update_status( 'on-hold', __( 'PayRouta confirmed a payment that does not match this order. Review it in PayRouta.', 'payrouta-checkout' ) );
			}
		} elseif ( 'payment.failed' === $event['type'] ) {
			$order->add_order_note( __( 'A PayRouta payment attempt failed. The customer can try again.', 'payrouta-checkout' ) );
		}

		$seen[] = $event['id'];
		$order->update_meta_data( '_payrouta_events', array_slice( $seen, -50 ) );
		$order->save();
		return new WP_REST_Response( null, 204 );
	}

	private static function order_for( $intent_id ) {
		foreach ( array( '_payrouta_intent_fiat', '_payrouta_intent_crypto' ) as $key ) {
			$orders = wc_get_orders(
				array(
					'limit'      => 1,
					'meta_key'   => $key, // phpcs:ignore WordPress.DB.SlowDBQuery
					'meta_value' => $intent_id, // phpcs:ignore WordPress.DB.SlowDBQuery
				)
			);
			if ( $orders ) {
				return $orders[0];
			}
		}
		return null;
	}
}
