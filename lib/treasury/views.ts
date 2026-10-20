// Read models for the merchant workspace and the operations console. Callers
// authorise first; these only read. Merchant views never include provider
// names, provider ids or provider requirement paths.
import { db } from "../portal/db";
import { merchantTermsVersion } from "./verification";
import { merchantTerms } from "./terms";
import { platformModule } from "./platforms/registry";

export type BalanceRow = {
  asset: string;
  pending: string;
  available: string;
  reserve: string;
  held: string;
  owed: string;
  inTransit: string;
};

export async function balancesByAsset(orgId: string, environment: string): Promise<BalanceRow[]> {
  const rows = await db.merchantBalance.findMany({ where: { orgId, environment } });
  const by = new Map<string, BalanceRow>();
  const get = (asset: string) =>
    by.get(asset) ??
    by.set(asset, { asset, pending: "0", available: "0", reserve: "0", held: "0", owed: "0", inTransit: "0" }).get(asset)!;
  const field: Record<string, keyof Omit<BalanceRow, "asset">> = {
    "merchant-pending": "pending",
    "merchant-available": "available",
    "merchant-reserve": "reserve",
    "merchant-dispute-hold": "held",
    "merchant-receivable": "owed",
    "payout-in-transit": "inTransit",
  };
  for (const r of rows) {
    const f = field[r.account];
    if (!f) continue;
    // Receivable is stored as a negative (credit-normal) balance.
    get(r.asset)[f] = (f === "owed" ? -BigInt(r.balance.toFixed(0)) : BigInt(r.balance.toFixed(0))).toString();
  }
  return [...by.values()].sort((a, b) => a.asset.localeCompare(b.asset));
}

export async function merchantTreasury(orgId: string, environment: string) {
  const [account, profile, details, agreement, links] = await Promise.all([
    db.merchantAccount.findUnique({ where: { orgId_environment: { orgId, environment } } }),
    db.merchantKybProfile.findFirst({ where: { orgId }, orderBy: { version: "desc" } }),
    db.merchantVerificationDetails.findFirst({ where: { orgId }, orderBy: { version: "desc" } }),
    db.merchantAgreement.findFirst({ where: { orgId, version: merchantTermsVersion }, orderBy: { acceptedAt: "desc" } }),
    db.merchantPlatformLink.findMany({ where: { orgId, environment }, include: { platformAccount: true } }),
  ]);
  const last = account
    ? await db.merchantAccountTransition.findFirst({ where: { merchantAccountId: account.id }, orderBy: { createdAt: "desc" } })
    : null;
  const terms = account?.terms ? merchantTerms.safeParse(account.terms) : null;
  const ready = links.filter((l) => l.state === "Approved" && l.paymentsEnabled);
  const holdsFunds = ready.some((l) => {
    try {
      return platformModule(l.platformAccount.provider).manifest.holdsFunds;
    } catch {
      return false;
    }
  });
  const [payouts, disputes, refunds] = await Promise.all([
    db.payout.findMany({ where: { orgId, environment }, orderBy: { createdAt: "desc" }, take: 25 }),
    db.platformDispute.findMany({
      where: { orgId, environment },
      orderBy: { createdAt: "desc" },
      take: 25,
      include: { payment: { select: { intentId: true, intent: { select: { reference: true } } } } },
    }),
    db.platformRefund.findMany({
      where: { orgId, environment },
      orderBy: { createdAt: "desc" },
      take: 25,
      include: { payment: { select: { intentId: true, intent: { select: { reference: true } } } } },
    }),
  ]);
  return {
    account: account && {
      state: account.state,
      version: account.version,
      riskTier: account.riskTier,
      note: account.state === "Returned" ? last?.reason ?? null : null,
      profileChanged: !!profile && profile.version !== account.profileVersion,
      detailsChanged: !!details && details.version !== account.detailsVersion,
    },
    steps: {
      profile: profile ? { version: profile.version, owners: ((profile.data as { owners?: unknown[] }).owners ?? []).length } : null,
      details: details ? { version: details.version, summary: details.summary } : null,
      terms: agreement ? { acceptedAt: agreement.acceptedAt.toISOString() } : null,
    },
    paymentsAccount: links.length
      ? {
          state: ready.length ? "Active" : links.some((l) => l.state === "Rejected") ? "Declined" : "In review",
          requirements: [...new Set(links.flatMap((l) => l.requirements as string[]))],
          payoutsByPayRouta: holdsFunds,
        }
      : null,
    terms: terms?.success ? terms.data : null,
    balances: await balancesByAsset(orgId, environment),
    payouts: payouts.map((p) => ({
      id: p.id,
      asset: p.asset,
      amountMinor: p.amountMinor.toFixed(0),
      state: p.state,
      initiatedBy: p.initiatedBy === "schedule" ? "Scheduled" : "On request",
      failureCode: p.failureCode,
      createdAt: p.createdAt.toISOString(),
    })),
    disputes: disputes.map((d) => ({
      id: d.id,
      intentId: d.payment.intentId,
      reference: d.payment.intent.reference,
      asset: d.asset,
      amountMinor: d.amountMinor.toFixed(0),
      feeMinor: d.feeMinor.toFixed(0),
      state: d.state,
      reason: d.reason,
      evidenceDueBy: d.evidenceDueBy?.toISOString() ?? null,
      evidenceSubmittedAt: d.evidenceSubmittedAt?.toISOString() ?? null,
      createdAt: d.createdAt.toISOString(),
    })),
    refunds: refunds.map((r) => ({
      id: r.id,
      intentId: r.payment.intentId,
      reference: r.payment.intent.reference,
      asset: r.asset,
      amountMinor: r.amountMinor.toFixed(0),
      state: r.state,
      reason: r.reason,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}

// What a payment detail page needs to offer refunds.
export async function paymentFunds(intentId: string) {
  const p = await db.platformPayment.findUnique({
    where: { intentId },
    include: { refunds: { orderBy: { createdAt: "desc" } }, disputes: true, platformAccount: true },
  });
  if (!p) return null;
  const refunded = p.refunds.filter((r) => r.state !== "Failed").reduce((n, r) => n + BigInt(r.amountMinor.toFixed(0)), 0n);
  let refundable = false;
  try {
    refundable = !platformModule(p.platformAccount.provider).manifest.needsPayoutAccount;
  } catch {
    refundable = false;
  }
  return {
    asset: p.asset,
    grossMinor: p.grossMinor.toFixed(0),
    // PayRouta's own fee; the partner's standard fee we withheld on the
    // merchant's behalf counts as processing, like one the partner deducts.
    feeMinor: (BigInt(p.feeMinor.toFixed(0)) - BigInt(p.partnerFeeMinor.toFixed(0))).toString(),
    processingFeeMinor: (BigInt(p.providerFeeMinor.toFixed(0)) + BigInt(p.partnerFeeMinor.toFixed(0))).toString(),
    netMinor: (BigInt(p.grossMinor.toFixed(0)) - BigInt(p.feeMinor.toFixed(0)) - BigInt(p.providerFeeMinor.toFixed(0))).toString(),
    fundsState: p.state === "Pending" ? "Incoming" : p.reserveMinor && p.state === "Available" ? "Available (reserve held)" : "Available",
    availableAt: p.availableAt?.toISOString() ?? null,
    refundedMinor: refunded.toString(),
    remainingMinor: (BigInt(p.grossMinor.toFixed(0)) - refunded).toString(),
    refundable,
    refunds: p.refunds.map((r) => ({ id: r.id, amountMinor: r.amountMinor.toFixed(0), state: r.state, reason: r.reason, createdAt: r.createdAt.toISOString() })),
    disputes: p.disputes.map((d) => ({ id: d.id, amountMinor: d.amountMinor.toFixed(0), state: d.state, reason: d.reason })),
  };
}
