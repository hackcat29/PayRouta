/* PayRouta in the block-based checkout. The customer chooses how to pay on
 * PayRouta's hosted checkout after placing the order. */
( function () {
	var registry = window.wc && window.wc.wcBlocksRegistry;
	var settings = window.wc && window.wc.wcSettings ? window.wc.wcSettings.getSetting( 'payrouta_data', {} ) : {};
	var el = window.wp.element.createElement;
	var decode = window.wp.htmlEntities.decodeEntities;
	if ( ! registry ) return;
	var title = decode( settings.title || 'PayRouta' );
	var Content = function () {
		return el( 'p', null, decode( settings.description || '' ) );
	};
	registry.registerPaymentMethod( {
		name: 'payrouta',
		label: el( 'span', null, title ),
		ariaLabel: title,
		content: el( Content ),
		edit: el( Content ),
		canMakePayment: function () {
			return true;
		},
		supports: { features: settings.supports || [ 'products' ] },
	} );
} )();
