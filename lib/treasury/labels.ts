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

// Onboarding requirements (lib/merchant/requirements.ts).
export const onboardingText: Record<string, string> = {
  name: "Your name or business name",
  country: "Country",
  terms: "Merchant terms",
  "what-you-sell": "What you sell",
  "support-email": "Customer support email",
  "registration-number": "Registration number",
  "business-address": "Business address",
  representative: "Director",
  "personal-details": "Date of birth, phone and address",
  "id-number": "ID number",
  "government-id": "Photo of your ID",
  "registration-certificate": "Registration certificate",
  "payout-account": "Payout bank account",
  owners: "Owners with 25% or more",
  "proof-of-address": "Proof of address",
};
export const onboardingStatus: Record<string, { label: string; tone: Tone }> = {
  done: { label: "Done", tone: "good" },
  "in-review": { label: "In review", tone: "neutral" },
  due: { label: "Needed", tone: "warn" },
  upgrade: { label: "To grow", tone: "warn" },
  later: { label: "Later", tone: "neutral" },
};
export const tierText: Record<string, string> = {
  individual: "Individual",
  business: "Registered business",
  scaled: "Higher volume",
};

// `detail` only where it changes what the merchant does.
export const accountState: Record<string, { label: string; tone: Tone; detail?: string }> = {
  Submitted: { label: "Submitted", tone: "neutral" },
  Underwriting: { label: "In review", tone: "neutral" },
  Returned: { label: "Action needed", tone: "warn" },
  Live: { label: "Active", tone: "good" },
  Restricted: { label: "Restricted", tone: "bad", detail: "New payments and payouts are paused. Refunds still work. Contact support." },
  Offboarding: { label: "Closing", tone: "warn" },
  Closed: { label: "Closed", tone: "neutral" },
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
