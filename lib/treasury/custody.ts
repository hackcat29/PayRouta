// Who holds merchant funds on a rail (docs/AGGREGATOR.md §1).
//
//   merchant-owned    the merchant's own provider account (lib/partners)
//   partner-held      a per-merchant balance inside the partner's licensed
//                     platform (Adyen for Platforms, dLocal)
//   split-settlement  the provider pays the merchant's share straight to the
//                     merchant's bank (Paystack/Flutterwave subaccounts)
//   payrouta-held     PayRouta's own master account; needs PayRouta's own
//                     licence in the merchant's country
export const custodyModes = [
  "merchant-owned",
  "partner-held",
  "split-settlement",
  "payrouta-held",
] as const;
export type CustodyMode = (typeof custodyModes)[number];
export const platformCustodyModes = [
  "partner-held",
  "split-settlement",
  "payrouta-held",
] as const;
export type PlatformCustody = (typeof platformCustodyModes)[number];

// Why a PayRouta company may not onboard a merchant from `merchantCountry`
// onto a platform account, or null when it may.
export function custodyBlocker(input: {
  custody: PlatformCustody;
  merchantCountry: string;
  merchantCountries: readonly string[];
  licensedCountries: readonly string[];
}) {
  if (!input.merchantCountries.includes(input.merchantCountry))
    return "PLATFORM_ACCOUNT_COUNTRY_NOT_COVERED";
  if (
    input.custody === "payrouta-held" &&
    !input.licensedCountries.includes(input.merchantCountry)
  )
    return "PAYROUTA_LICENCE_REQUIRED";
  return null;
}
