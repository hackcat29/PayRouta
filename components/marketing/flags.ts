import type { ComponentType, SVGProps } from "react";
import AE from "country-flag-icons/react/3x2/AE";
import BR from "country-flag-icons/react/3x2/BR";
import DE from "country-flag-icons/react/3x2/DE";
import FR from "country-flag-icons/react/3x2/FR";
import GB from "country-flag-icons/react/3x2/GB";
import GH from "country-flag-icons/react/3x2/GH";
import ID from "country-flag-icons/react/3x2/ID";
import IN from "country-flag-icons/react/3x2/IN";
import KE from "country-flag-icons/react/3x2/KE";
import MX from "country-flag-icons/react/3x2/MX";
import NG from "country-flag-icons/react/3x2/NG";
import PH from "country-flag-icons/react/3x2/PH";
import US from "country-flag-icons/react/3x2/US";
import ZA from "country-flag-icons/react/3x2/ZA";

type Flag = ComponentType<SVGProps<SVGSVGElement>>;

export const flags = { AE, BR, DE, FR, GB, GH, ID, IN, KE, MX, NG, PH, US, ZA } as unknown as Record<string, Flag>;

// Flag strip: a country and the payment method people there reach for first.
export const stripCountries: [code: string, name: string, method: string][] = [
  ["BR", "Brazil", "Pix"],
  ["IN", "India", "UPI"],
  ["KE", "Kenya", "M-Pesa"],
  ["DE", "Germany", "SEPA Instant"],
  ["US", "United States", "Cards & wallets"],
  ["NG", "Nigeria", "Bank transfer"],
  ["GB", "United Kingdom", "Faster Payments"],
  ["MX", "Mexico", "SPEI & OXXO"],
  ["GH", "Ghana", "MTN MoMo"],
  ["FR", "France", "Cartes Bancaires"],
  ["ID", "Indonesia", "QRIS"],
  ["ZA", "South Africa", "Instant EFT"],
  ["AE", "UAE", "Apple Pay"],
  ["PH", "Philippines", "E-wallets"],
];
