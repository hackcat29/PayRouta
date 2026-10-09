// Plain-language wording for treasury states, shared by the merchant
// workspace, the operations console and the API. Merchants only ever see
// PayRouta's words: no provider names or provider field paths.

import { currencyExponent } from "../partners/money";

export type Tone = "good" | "bad" | "neutral" | "warn";

export const requirementText: Record<string, string> = {
  "business-details": "Some business details need correcting",
  "business-document": "A business registration document is needed",
  "representative-details": "Your representative's details need correcting",
  "owner-details": "An owner's details need correcting",
  "director-details": "Director details are needed",
  "identity-document": "An identity document is needed",
  "payout-account": "Check your payout bank account",
  "terms-acceptance": "Accept the current terms",
  review: "Our team is reviewing your account",
};

export const accountState: Record<string, { label: string; tone: Tone; detail: string }> = {
  Submitted: { label: "Submitted", tone: "neutral", detail: "We have your details and will start the review shortly." },
  Underwriting: { label: "In review", tone: "neutral", detail: "We are verifying your business. This usually takes one to two business days." },
  Returned: { label: "Action needed", tone: "warn", detail: "We need changes before we can continue." },
  Live: { label: "Active", tone: "good", detail: "You can accept payments and receive payouts." },
  Restricted: { label: "Restricted", tone: "bad", detail: "New payments and payouts are paused. Refunds still work. Contact support." },
  Offboarding: { label: "Closing", tone: "warn", detail: "Your remaining balance is being paid out." },
  Closed: { label: "Closed", tone: "neutral", detail: "This account is closed." },
};

export const payoutTone: Record<string, Tone> = { Queued: "neutral", "In transit": "neutral", Paid: "good", Failed: "bad" };
export const refundTone: Record<string, Tone> = { Queued: "neutral", Pending: "neutral", Succeeded: "good", Failed: "bad" };
export const disputeTone: Record<string, Tone> = { Open: "warn", Won: "good", Lost: "bad" };
export const disputeLabel: Record<string, string> = { Open: "Needs attention", Won: "Won", Lost: "Lost" };


// "fiat:GBP:" + "3600" → "£36.00" (falls back to "36.00 GBP").
export function money(asset: string, minor: string | bigint, locale = "en-GB") {
  const currency = asset.match(/^fiat:([A-Z]{3}):$/)?.[1] ?? asset;
  const exp = currencyExponent(currency) ?? 2;
  const v = BigInt(minor);
  const negative = v < 0n;
  const abs = negative ? -v : v;
  const whole = abs / 10n ** BigInt(exp);
  const frac = exp ? (abs % 10n ** BigInt(exp)).toString().padStart(exp, "0") : "";
  const number = Number(`${whole}${exp ? `.${frac}` : ""}`) * (negative ? -1 : 1);
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: exp, maximumFractionDigits: exp }).format(number);
  } catch {
    return `${negative ? "-" : ""}${whole}${exp ? `.${frac}` : ""} ${currency}`;
  }
}

export const scheduleText: Record<string, string> = {
  daily: "Daily",
  weekly: "Weekly, on Mondays",
  monthly: "Monthly, on the 1st",
  manual: "On request",
};
