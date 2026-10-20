// Credit at checkout (docs/credit.md). A customer pays with credit from a
// licensed lender that PayRouta has a partnership with in their country. The
// lender approves the customer, pays the merchant the full price (less its
// merchant fee) and collects the instalments itself: credit and repayment
// risk stay with the lender, never with the merchant or PayRouta.
//
// Lenders are platform modules whose manifest offers "bnpl" and carries a
// `credit` disclosure. This file holds the arithmetic every lender module
// shares, so a plan reads the same whichever lender priced it.
import type { CreditOffer } from "./platforms/contract";

export const creditMethod = "bnpl" as const;

// Splits `totalMinor` into `count` instalments that differ by at most one
// minor unit, larger ones first, so the first payment is never the smaller.
export function splitInstalments(totalMinor: bigint, count: number) {
  if (count < 1 || totalMinor < 0n) throw new Error("Invalid instalment split");
  const n = BigInt(count);
  const base = totalMinor / n;
  const extra = Number(totalMinor % n);
  return Array.from({ length: count }, (_, i) => base + (i < extra ? 1n : 0n));
}

// The total cost of `bps` basis points on `minor`, rounded half up.
export function costOf(minor: bigint, bps: number) {
  return (minor * BigInt(bps) * 2n + 10000n) / 20000n;
}

export function instalmentOffer(input: {
  id: string;
  lender: string;
  termsUrl: string;
  amountMinor: bigint;
  instalments: number;
  interval: CreditOffer["interval"];
  // Interest and fees across the whole plan, in basis points of the price.
  costBps: number;
  aprBasisPoints: number | null;
  // Whether the first instalment is paid at checkout.
  firstDueToday: boolean;
}): CreditOffer {
  const cost = costOf(input.amountMinor, input.costBps);
  const total = input.amountMinor + cost;
  const parts = splitInstalments(total, input.instalments);
  return {
    id: input.id,
    lender: input.lender,
    kind: input.instalments === 1 ? "pay-later" : "instalments",
    instalments: input.instalments,
    interval: input.interval,
    dueTodayMinor: (input.firstDueToday ? parts[0] : 0n).toString(),
    instalmentMinor: parts[parts.length - 1].toString(),
    ...(parts[0] !== parts[parts.length - 1] ? { firstInstalmentMinor: parts[0].toString() } : {}),
    totalMinor: total.toString(),
    costMinor: cost.toString(),
    aprBasisPoints: input.aprBasisPoints,
    termsUrl: input.termsUrl,
  };
}

// What a checkout shows for an offer, e.g. "4 payments of ₦12,500 every two
// weeks". Formatting of the money itself is left to the caller.
export function offerSummary(offer: Pick<CreditOffer, "instalments" | "interval" | "kind">) {
  if (offer.kind === "pay-later") return `Pay in full in ${offer.interval === "month" ? "30 days" : offer.interval === "week" ? "7 days" : "14 days"}`;
  const every = { week: "every week", "two-weeks": "every two weeks", month: "every month" }[offer.interval];
  return `${offer.instalments} payments, ${every}`;
}
