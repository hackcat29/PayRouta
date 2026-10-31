// What people see when a request fails. API routes answer with an error code
// (lib/payments/http.ts failure()); this turns the code into a sentence that
// says what happened and what to do next. Codes without their own sentence
// fall back to one chosen by HTTP status, and server faults carry a reference
// that support can find in the logs. Never show a raw code or stack.

const copy: Record<string, string> = {
  // Session and permissions
  UNAUTHORIZED: "Your session has ended. Sign in again to continue.",
  SESSION_EXPIRED: "Your session has ended. Sign in again to continue.",
  FORBIDDEN: "Your role can't do this. Ask an owner or admin.",
  MERCHANT_ACCESS_DENIED: "Your role can't do this. Ask an owner or admin.",
  OWNER_REQUIRED: "Only an owner can do this.",
  LAST_OWNER_REQUIRED: "Every business needs at least one owner. Make someone else an owner first.",
  MERCHANT_NOT_CONFIGURED: "This business isn't set up yet. Finish business setup first.",
  ENVIRONMENT_NOT_CONFIGURED: "Live mode isn't on for this business yet. Switch to test mode, or activate payments.",
  WORKSPACE_LIMIT_REACHED: "You've reached the number of businesses you can create. Contact support to add more.",
  // Requests
  INVALID_REQUEST: "Some details aren't valid. Check the highlighted fields and try again.",
  MISSING_BODY: "Some details are missing. Fill in the form and try again.",
  BODY_TOO_LARGE: "That's too much to send at once. Shorten it and try again.",
  REQUEST_TIMEOUT: "The request took too long. Check your connection and try again.",
  RATE_LIMITED: "Too many attempts. Wait a minute and try again.",
  IDEMPOTENCY_CONFLICT: "This was already submitted with different details. Refresh the page and try again.",
  NOT_FOUND: "We couldn't find that. It may have been removed; refresh the page.",
  SERVICE_UNAVAILABLE: "Something went wrong on our side and nothing was saved. Try again in a minute.",
  // Payment links
  INVALID_AMOUNT: "Check the amount: it's zero, or has more decimal places than the currency allows.",
  UNSUPPORTED_CURRENCY: "That currency isn't supported yet.",
  PAYMENT_LINK_CRYPTO_REQUIRES_USD: "Stablecoins are offered on USD links only.",
  PAYMENT_LINK_CRYPTO_NOT_CONFIGURED: "Add a stablecoin receive address under Payment methods first.",
  PAYMENT_LINK_METHOD_NOT_ON: "One of those ways to pay isn't on for your account yet. Activate payments first.",
  PAYMENT_LINK_UNAVAILABLE: "This payment link is turned off or no longer exists.",
  // Activation and onboarding
  ACTIVATION_PREREQUISITES_REQUIRED: "Finish business setup before activating payments.",
  KYB_PROFILE_REQUIRED: "Add your business details in Business setup first.",
  MERCHANT_PROFILE_REQUIRED: "Add your business details in Business setup first.",
  MERCHANT_TERMS_NOT_ACCEPTED: "Accept the merchant terms in Business setup first.",
  MERCHANT_SCREENING_REQUIRED: "Your business is still being reviewed. We'll email you when it's done.",
  MERCHANT_NOT_LIVE: "Live payments aren't on for this business yet.",
  LIVE_SCOPE_NOT_APPROVED: "Live payments aren't approved for this business yet.",
  APPLICATION_CONFLICT: "Someone else changed this application. Refresh the page to see the latest version.",
  PROFILE_VERSION_CONFLICT: "Someone else changed these details. Refresh the page to see the latest version.",
  MERCHANT_ACCOUNT_VERSION_CONFLICT: "Someone else changed these details. Refresh the page to see the latest version.",
  OWNER_DETAILS_MUST_MATCH_PROFILE: "Owner details must match the ones in your business profile.",
  VERIFICATION_DETAILS_REQUIRED: "Add the verification details we asked for first.",
  // Checkout and payments
  CHECKOUT_EXPIRED: "This checkout has expired. Go back to the store and start again.",
  CHECKOUT_EXPIRED_OR_UNAUTHORIZED: "This checkout has expired. Go back to the store and start again.",
  PAYMENT_ALREADY_IN_PROGRESS: "A payment is already in progress for this order.",
  PAYMENT_NOT_FOUND: "We couldn't find that payment.",
  QUOTE_EXPIRED: "The price expired. Choose your payment method again.",
  QUOTE_EXPIRED_RESELECT_METHOD: "The price expired. Choose your payment method again.",
  SELECTED_METHOD_NOT_AVAILABLE: "That way to pay isn't available right now. Choose another.",
  SELECTED_METHOD_NO_LONGER_AVAILABLE: "That way to pay isn't available right now. Choose another.",
  PAYMENT_METHOD_COMING_SOON: "That way to pay is coming soon. Choose another for now.",
  CREDIT_PLAN_NO_LONGER_OFFERED: "That instalment plan is no longer offered. Choose another.",
  CROSS_CHAIN_AMOUNT_TOO_SMALL: "That amount is below the minimum for paying from another chain. Pay on the listed network instead.",
  CROSS_CHAIN_UNAVAILABLE: "Paying from another chain isn't available right now. Pay on the listed network instead.",
  CROSS_CHAIN_RATE_LIMITED: "Paying from another chain is busy. Try again in a minute.",
  CROSS_CHAIN_REFUND_ADDRESS_INVALID: "That refund address isn't valid for the chain you're paying from.",
  CRYPTO_QUOTE_EXPIRED: "The price expired. Get a new quote and try again.",
  CRYPTO_PRICE_STALE: "We couldn't get a fresh price. Try again in a minute.",
  INVALID_PAYMENT_ADDRESS: "That wallet address isn't valid for this network.",
  INVALID_PAYER_ADDRESS: "That wallet address isn't valid for this network.",
  RECEIVE_ADDRESS_ALREADY_USED: "That address is already used by another business. Use a different one.",
  // NEAR Intents account
  INTENTS_LIVE_ONLY: "NEAR Intents runs on mainnet only. Switch to live mode to use it.",
  INTENTS_ACCOUNT_INVALID: "That isn't a NEAR Intents account. Use a NEAR account like shop.near, or an EVM address.",
  INTENTS_CHALLENGE_EXPIRED: "The signing request expired. Connect your wallet again.",
  INTENTS_SIGNATURE_INVALID: "The wallet's signature didn't check out. Sign again with the wallet that owns the account.",
  INTENTS_KEY_NOT_ACCOUNT_OWNER: "That wallet key doesn't control the account. Use a key with full access.",
  INTENTS_ACCOUNT_NOT_CONNECTED: "Connect your NEAR Intents account first.",
  INTENTS_BALANCE_INSUFFICIENT: "Your NEAR Intents balance is too low for this.",
  INTENTS_RECIPIENT_INVALID: "That address isn't valid for the network they receive on.",
  INTENTS_QUOTE_EXPIRED: "The quote expired before it was signed. Review it again.",
  INTENTS_INTENT_REFUSED: "NEAR Intents couldn't prepare this transfer. Try again in a minute.",
  INTENTS_INTENT_UNEXPECTED: "NEAR Intents asked to sign something other than this payout, so nothing was sent. Try again.",
  INTENTS_SIGNATURE_REJECTED: "NEAR Intents didn't accept the signature. If your account is a NEAR account, register your wallet key first.",
  REFUND_DESTINATION_MISMATCH: "Refunds go back to the customer's own address, in what they paid with.",
  PAYOUT_NOT_FOUND: "We couldn't find that payout. Refresh the page.",
  NEAR_RPC_UNAVAILABLE: "NEAR isn't answering right now. Try again in a minute.",
  NEAR_RPC_RATE_LIMITED: "NEAR is busy. Try again in a minute.",
  // Agentic payments
  AGENT_MERCHANT_NOT_ALLOWED: "This agent key can't pay this merchant.",
  AGENT_PAYER_NOT_ALLOWED: "This agent key can only pay from its own NEAR Intents account.",
  AGENT_PAYMENT_OVER_LIMIT: "This payment is over the agent key's limit per payment.",
  AGENT_BUDGET_EXCEEDED: "This payment would go over the agent key's budget for the period.",
  AGENT_MERCHANT_UNKNOWN: "One of the merchants isn't a PayRouta payment link or merchant ID.",
  AGENT_LIMITS_INVALID: "Set a budget and a per-payment limit above zero, with the per-payment limit no more than the budget.",
  AGENT_AMOUNT_UNPRICED: "This checkout isn't priced in US dollars, so an agent key can't pay it.",
  AGENT_PAYMENT_NOT_OFFERED: "This payment link doesn't take crypto, so an agent can't pay it.",
  AGENT_INSTRUCTIONS_NOT_READY: "Payment instructions aren't ready yet. Try again in a few seconds.",
  // Money movement
  INSUFFICIENT_AVAILABLE_BALANCE: "Your available balance is too low for this.",
  NOTHING_TO_PAY_OUT: "There's nothing ready to pay out yet.",
  PAYOUTS_NOT_ENABLED: "Payouts aren't on for this business yet. Finish activation first.",
  PAYOUT_CURRENCY_NOT_SUPPORTED: "Payouts in that currency aren't supported yet.",
  PAYOUT_ACCOUNT_NAME_MISMATCH: "The bank account name doesn't match your business name.",
  REFUND_EXCEEDS_PAYMENT: "A refund can't be more than what's left of the payment.",
  REFUND_NOT_SUPPORTED_ON_RAIL: "This payment method doesn't support refunds through PayRouta. Refund the customer directly.",
  // Disputes and evidence
  EVIDENCE_DEADLINE_PASSED: "The deadline to respond to this dispute has passed.",
  EVIDENCE_ALREADY_SUBMITTED: "You've already responded to this dispute.",
  DISPUTE_CLOSED: "This dispute is closed.",
  // Exports and billing
  EXPORT_TOO_LARGE_NARROW_DATE_RANGE: "That's too much to export at once. Choose a shorter date range.",
  EXPORT_WINDOW_TOO_LARGE: "That's too much to export at once. Choose a shorter date range.",
  BILLING_EXPORT_TOO_LARGE: "That month is too large to export here. Contact support for a full export.",
  INVALID_BILLING_MONTH: "Choose a month in the format YYYY-MM.",
  INVALID_DATE_RANGE: "Check the dates: the start must be before the end.",
  // Settings
  EXPIRY_MUST_BE_FUTURE: "Choose an expiry date in the future.",
  RETURN_ORIGIN_MUST_BE_HTTPS: "Use an https:// address.",
  RETURN_ORIGIN_NOT_REGISTERED: "Add this site's address under Developers first.",
  FEE_PASS_THROUGH_NOT_PERMITTED_IN_COUNTRY: "The law in this country doesn't allow adding fees for customers.",
  SHOPIFY_SHOP_INVALID: "Enter your store's myshopify.com address, e.g. your-store.myshopify.com.",
  SHOPIFY_SHOP_NOT_INSTALLED: "Install the PayRouta app in your Shopify admin first.",
  TURNSTILE_VERIFICATION_FAILED: "We couldn't confirm you're human. Refresh the page and try again.",
};

const byStatus: Record<number, string> = {
  400: copy.INVALID_REQUEST,
  401: copy.UNAUTHORIZED,
  403: "You don't have access to do this.",
  404: copy.NOT_FOUND,
  409: "This changed since you opened the page. Refresh and try again.",
  413: copy.BODY_TOO_LARGE,
  429: copy.RATE_LIMITED,
};

// A code like PAYMENT_LINK_METHOD_NOT_ON, optionally with ":detail".
const isCode = (value: string) => /^[A-Z][A-Z0-9_]*(:[\w.-]+)?$/.test(value);

export function errorText(body: unknown, status = 0): string {
  const b = (body && typeof body === "object" ? body : {}) as { error?: unknown; reference?: unknown };
  const raw = typeof b.error === "string" ? b.error : typeof (b.error as { code?: unknown })?.code === "string" ? (b.error as { code: string }).code : "";
  const reference = typeof b.reference === "string" ? b.reference : "";
  if (raw && copy[raw.split(":")[0]] && raw !== "SERVICE_UNAVAILABLE") return copy[raw.split(":")[0]];
  // Sentences written for people (4xx PortalErrors) are shown as they are.
  if (raw && !isCode(raw) && status < 500) return raw;
  if (status && status < 500 && byStatus[status]) return byStatus[status];
  if (status && status < 500) return "That didn't work. Check the details and try again.";
  return reference
    ? `${copy.SERVICE_UNAVAILABLE} If it keeps happening, contact support and quote ${reference}.`
    : copy.SERVICE_UNAVAILABLE;
}

export const offline = "We couldn't reach PayRouta. Check your connection and try again.";

// Read a failed fetch Response into a sentence for people.
export async function responseError(response: Response) {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return errorText(body, response.status);
}

// The sentence to show for a caught exception: a dropped connection (fetch
// throws TypeError) reads as one, and our own Error messages are already
// sentences from errorText().
export const shown = (e: unknown) => (e instanceof TypeError ? offline : e instanceof Error && e.message ? e.message : offline);
