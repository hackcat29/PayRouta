<?php
/**
 * Minimal PayRouta merchant API client over the WordPress HTTP API.
 *
 * Mirrors sdks/node: Bearer secret key, PayRouta-Environment header,
 * Idempotency-Key on writes, no automatic retries of writes, no redirects.
 */

defined( 'ABSPATH' ) || exit;

class PayRouta_Client {
	/** @var string */
	private $base;
	/** @var string */
	private $secret_key;
	/** @var string */
	private $environment;

	public function __construct( $base, $secret_key, $environment ) {
		$this->base        = trailingslashit( $base );
		$this->secret_key  = $secret_key;
		$this->environment = 'production' === $environment ? 'production' : 'sandbox';
	}

	/** The origin hosting checkout pages, from the API URL. */
	public function origin() {
		$parts = wp_parse_url( $this->base );
		if ( empty( $parts['scheme'] ) || empty( $parts['host'] ) ) {
			return '';
		}
		return $parts['scheme'] . '://' . $parts['host'] . ( isset( $parts['port'] ) ? ':' . $parts['port'] : '' );
	}

	public function is_configured() {
		$parts = wp_parse_url( $this->base );
		$local = isset( $parts['host'] ) && in_array( $parts['host'], array( 'localhost', '127.0.0.1' ), true );
		return '' !== $this->secret_key
			&& 0 === strpos( $this->secret_key, 'pr_' . $this->environment . '_' )
			&& isset( $parts['scheme'] )
			&& ( 'https' === $parts['scheme'] || ( 'http' === $parts['scheme'] && $local ) );
	}

	/**
	 * @return array Decoded JSON body.
	 * @throws Exception With the PayRouta error code on failure.
	 */
	public function request( $method, $path, $body = null, $idempotency_key = null ) {
		if ( ! $this->is_configured() ) {
			throw new Exception( 'PAYROUTA_NOT_CONFIGURED' );
		}
		$headers = array(
			'Authorization'        => 'Bearer ' . $this->secret_key,
			'PayRouta-Environment' => $this->environment,
			'Content-Type'         => 'application/json',
			'Accept'               => 'application/json',
		);
		if ( $idempotency_key ) {
			$headers['Idempotency-Key'] = $idempotency_key;
		}
		$response = wp_remote_request(
			$this->base . ltrim( $path, '/' ),
			array(
				'method'      => $method,
				'headers'     => $headers,
				'body'        => null === $body ? null : wp_json_encode( $body ),
				'timeout'     => 15,
				'redirection' => 0,
			)
		);
		if ( is_wp_error( $response ) ) {
			throw new Exception( 'TRANSPORT_ERROR' );
		}
		$status = (int) wp_remote_retrieve_response_code( $response );
		$data   = json_decode( wp_remote_retrieve_body( $response ), true );
		if ( $status < 200 || $status >= 300 ) {
			$code = is_array( $data ) && isset( $data['error']['code'] ) ? (string) $data['error']['code'] : 'API_ERROR';
			throw new Exception( preg_replace( '/[^A-Z_]/', '', $code ) );
		}
		if ( ! is_array( $data ) ) {
			throw new Exception( 'INVALID_RESPONSE' );
		}
		return $data;
	}

	public function create_checkout( array $input, $idempotency_key ) {
		return $this->request( 'POST', 'checkouts', $input, $idempotency_key );
	}

	public function get_payment( $id ) {
		return $this->request( 'GET', 'payments/' . rawurlencode( $id ) );
	}

	/**
	 * Verifies a webhook exactly as sdks/node verifyWebhook: HMAC-SHA256 of
	 * "timestamp.eventId.rawBody", hex, constant-time compare, 300 s window.
	 */
	public static function verify_webhook( $raw_body, $timestamp, $event_id, $key_id, $signature, array $secrets, $now = null ) {
		$now = null === $now ? time() : $now;
		if ( empty( $secrets[ $key_id ] ) || '' === $event_id || ! preg_match( '/^\d+$/', (string) $timestamp )
			|| abs( (int) $timestamp - $now ) > 300 || ! preg_match( '/^[a-f0-9]{64}$/', (string) $signature ) ) {
			return false;
		}
		$expected = hash_hmac( 'sha256', $timestamp . '.' . $event_id . '.' . $raw_body, $secrets[ $key_id ] );
		return hash_equals( $expected, $signature );
	}
}
