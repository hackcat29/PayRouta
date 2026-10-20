// Who pays the fees on a payment.
//
//   merchant  (default) the customer pays the price; fees come out of it
//   customer  the price is raised so the merchant still receives it in full
//
// Pass-through is fixed when the payment is created, because quoted amounts
// can never change afterwards (see the payment_fee_snapshot_immutable
// trigger). Stablecoin and crypto payments pass on PayRouta's fee exactly.
// Partner-processed payments pass on PayRouta's fee plus the partner's
// standard fee for the most expensive method the payment accepts on the
// merchant's rails, so a card-only payment passes on exactly the card cost.
import { db } from "../portal/db";
import { PortalError } from "../portal/domain";
import { minor } from "./contracts";
import { defaultDirectBps, defaultPartnerBps, feeSnapshotSchema, partnerCaps, type FeeSnapshot } from "./pricing";
import { splitPlatformConfig } from "../treasury/partner-fees";
import { platformModule } from "../treasury/platforms/registry";

export const feeBearers = ["merchant", "customer"] as const;
export type FeeBearer = (typeof feeBearers)[number];

// The EU's PSD2 (and the UK's equivalent rules) ban surcharges on consumer
// cards and on SEPA transfers and direct debits, so merchants established
// there can't pass card or bank fees to customers.
const surchargeBanned = new Set(
  "AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE IS LI NO GB".split(" "),
);

export const surchargeBannedCountry = (country: string) => surchargeBanned.has(country.toUpperCase());

export function assertPassThroughAllowed(merchantCountry: string, fiat: boolean) {
  if (fiat && surchargeBannedCountry(merchantCountry))
    throw new PortalError("FEE_PASS_THROUGH_NOT_PERMITTED_IN_COUNTRY", 409);
}

type PartnerFee = { bps: number; fixedMinor: bigint };

// Standard partner fees for the given methods and currency on the merchant's
// approved platform links. Split-settlement rails list theirs too: there the
// partner deducts it from the merchant, so it's what the merchant must recover.
export async function passThroughPartnerFees(
  orgId: string,
  environment: string,
  currency: string,
  methods: readonly string[],
): Promise<PartnerFee[]> {
  const links = await db.merchantPlatformLink.findMany({
    where: { orgId, environment, state: "Approved", paymentsEnabled: true },
    include: { platformAccount: true },
  });
  const fees: PartnerFee[] = [];
  for (const link of links) {
    let manifest;
    try {
      manifest = platformModule(link.platformAccount.provider).manifest;
    } catch {
      continue;
    }
    const { standardFees } = splitPlatformConfig(link.platformAccount.config);
    for (const method of methods) {
      const fee = standardFees[method];
      if (!fee || !(manifest.methods as readonly string[]).includes(method)) continue;
      fees.push({ bps: fee.bps, fixedMinor: BigInt(fee.fixedMinor[currency] ?? "0") });
    }
  }
  return fees;
}

const half = (n: bigint, d: bigint) => (n * 2n + d) / (d * 2n);

// The smallest charge G with G - fees(G) >= base, found by fixed-point
// iteration (fees grow by well under 1 per unit, so this converges fast).
export function grossUp(base: bigint, fees: (gross: bigint) => bigint) {
  let gross = base;
  for (let i = 0; i < 64; i++) {
    const next = base + fees(gross);
    if (next <= gross) return gross;
    gross = next;
  }
  throw new PortalError("FEE_PASS_THROUGH_UNSTABLE", 409);
}

export function chargeForCustomer(input: {
  amount: string;
  precision: number;
  snapshot: FeeSnapshot | unknown;
  direct: boolean;
  partnerFees: PartnerFee[];
  // The payment's currency, for the published cap where the terms are free (sandbox).
  currency?: string;
}) {
  const base = minor(input.amount, input.precision);
  const snapshot = feeSnapshotSchema.parse(input.snapshot);
  // Sandbox terms are free; pass-through still uses the standard rates there
  // so merchants can see what customers will pay.
  const schedule = !snapshot.free && "partnerBps" in (snapshot.schedule ?? {}) ? snapshot.schedule : null;
  const bps = BigInt(
    input.direct
      ? ((schedule as { directBps?: number } | null)?.directBps ?? defaultDirectBps)
      : ((schedule as { partnerBps?: number } | null)?.partnerBps ?? defaultPartnerBps),
  );
  // The cap is in the billing currency; it only applies directly when that
  // is the payment's own currency (fiat). Crypto has no cap.
  const cap =
    !input.direct && schedule && (schedule as { conversionNumerator: string }).conversionNumerator === "1" &&
    (schedule as { conversionDenominator: string }).conversionDenominator === "1"
      ? (schedule as { partnerCapMinor?: string }).partnerCapMinor
      : !input.direct && !schedule && input.currency
        ? partnerCaps()[input.currency]
        : undefined;
  const fees = (g: bigint) => {
    const uncapped = half(g * bps, 10000n);
    const ours = cap !== undefined && uncapped > BigInt(cap) ? BigInt(cap) : uncapped;
    const partner = input.direct
      ? 0n
      : input.partnerFees.reduce((max, f) => {
          const fee = half(g * BigInt(f.bps), 10000n) + f.fixedMinor;
          return fee > max ? fee : max;
        }, 0n);
    return ours + partner;
  };
  const gross = grossUp(base, fees);
  const text = gross.toString().padStart(input.precision + 1, "0");
  return {
    amount: input.precision ? `${text.slice(0, -input.precision)}.${text.slice(-input.precision)}` : text,
    baseAmount: input.amount,
    customerFeeMinor: (gross - base).toString(),
  };
}
