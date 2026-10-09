// Payouts PayRouta initiates from a merchant's balance at a fund-holding
// platform account (docs/AGGREGATOR.md §4).
//
//   requested   merchant-available → payout-in-transit
//   paid        payout-in-transit  → funds-clearing (money left the provider)
//   failed      payout-in-transit  → merchant-available
//   returned    funds-clearing     → merchant-available (failed after paid)
//
// Merchants never choose a provider: payouts go from wherever their funds sit
// to the bank account they gave PayRouta, in that account's currency.
import { Prisma } from "../generated/prisma/client";
import { db } from "../portal/db";
import { PortalError } from "../portal/domain";
import { atomic, audit } from "../portal/service";
import { queue, type Tx } from "../payments/service";
import { postFunds, recoverReceivable } from "./ledger";
import { reconciliationBlocksPayout } from "./reconciliation";
import { requireFundsAccess, type MerchantAccountState } from "./merchant-account";
import { merchantTerms } from "./terms";
import { platformAdapter, platformModule } from "./platforms/registry";
import type { PayoutState } from "./platforms/contract";

const currencyOf = (asset: string) => asset.match(/^fiat:([A-Z]{3}):$/)?.[1] ?? null;

// What the merchant may be paid out at one platform account: its available
// balance there, less anything that became available within the payout
// delay from its terms.
export async function payoutEligible(
  tx: Tx | typeof db,
  input: { orgId: string; environment: string; platformAccountId: string; asset: string; delayDays: number; now: Date },
) {
  const cutoff = new Date(input.now.getTime() - input.delayDays * 86400000);
  const [row] = await tx.$queryRaw<{ available: string; recent: string }[]>`
    SELECT COALESCE(SUM(p.credit - p.debit), 0)::text AS available,
           COALESCE(SUM(CASE WHEN e."effectiveAt" > ${cutoff} THEN p.credit ELSE 0 END), 0)::text AS recent
    FROM "JournalEntry" e JOIN "JournalPosting" p ON p."entryId" = e.id
    WHERE e."orgId" = ${input.orgId} AND e.environment = ${input.environment} AND e.book = 'merchant-funds'
      AND e."platformAccountId" = ${input.platformAccountId} AND e.asset = ${input.asset}
      AND p.account = 'merchant-available'`;
  const eligible = BigInt(row.available) - BigInt(row.recent);
  return eligible > 0n ? eligible : 0n;
}

async function payoutCurrency(tx: Tx | typeof db, link: { orgId: string; detailsVersion: number | null }) {
  if (!link.detailsVersion) return null;
  const details = await tx.merchantVerificationDetails.findUnique({
    where: { orgId_version: { orgId: link.orgId, version: link.detailsVersion } },
  });
  return (details?.summary as { payoutAccount?: { currency?: string } } | undefined)?.payoutAccount?.currency ?? null;
}

export async function requestPayout(
  tx: Tx,
  input: {
    orgId: string;
    environment: string;
    platformAccountId: string;
    asset: string;
    amountMinor?: bigint;
    initiatedBy: string;
    period?: string;
    now: Date;
  },
) {
  if (input.period) {
    const existing = await tx.payout.findFirst({
      where: {
        orgId: input.orgId,
        environment: input.environment,
        platformAccountId: input.platformAccountId,
        asset: input.asset,
        period: input.period,
      },
    });
    if (existing) return existing;
  }
  const { account, platform } = await requireFundsAccess(tx, { ...input, operation: "payout" });
  const manifest = platformModule(platform.provider).manifest;
  if (!manifest.holdsFunds || !platformAdapter(platform).createPayout)
    throw new PortalError("PAYOUT_RAIL_NOT_AVAILABLE", 409);
  const link = await tx.merchantPlatformLink.findUnique({
    where: { orgId_platformAccountId: { orgId: input.orgId, platformAccountId: platform.id } },
  });
  if (!link || link.state !== "Approved" || !link.payoutsEnabled || !link.providerAccountId)
    throw new PortalError("PAYOUTS_NOT_ENABLED", 409);
  const currency = currencyOf(input.asset);
  if (!currency || currency !== (await payoutCurrency(tx, link)))
    throw new PortalError("PAYOUT_CURRENCY_NOT_SUPPORTED", 409);
  if (await reconciliationBlocksPayout(input.orgId, platform.id, input.asset))
    throw new PortalError("PAYOUTS_PAUSED_RECONCILIATION", 409);
  const terms = merchantTerms.parse(account.terms);
  // What the merchant owes PayRouta is repaid before anything is paid out.
  await recoverReceivable(tx, { ...input, platformAccountId: platform.id });
  // Offboarding pays out everything at once, without the usual delay.
  const delayDays = account.state === "Offboarding" ? 0 : terms.payout.delayDays;
  const eligible = await payoutEligible(tx, { ...input, delayDays });
  const amount = input.amountMinor ?? eligible;
  if (amount <= 0n) {
    if (input.period) return null;
    throw new PortalError("NOTHING_TO_PAY_OUT", 409);
  }
  if (amount > eligible) throw new PortalError("INSUFFICIENT_AVAILABLE_BALANCE", 409);
  const payout = await tx.payout.create({
    data: {
      orgId: input.orgId,
      environment: input.environment,
      platformAccountId: platform.id,
      linkId: link.id,
      asset: input.asset,
      amountMinor: amount.toString(),
      initiatedBy: input.initiatedBy,
      period: input.period ?? null,
    },
  });
  await postFunds(
    tx,
    {
      orgId: input.orgId,
      environment: input.environment,
      platformAccountId: platform.id,
      source: `payout:${payout.id}`,
      asset: input.asset,
      purpose: "Payout to the merchant's bank account requested",
      effectiveAt: input.now,
    },
    [
      { account: "merchant-available", debit: amount.toString(), credit: "0" },
      { account: "payout-in-transit", debit: "0", credit: amount.toString() },
    ],
  );
  await queue(tx, input.orgId, "treasury-payout-dispatch", `treasury-payout-dispatch:${payout.id}`, {
    payoutId: payout.id,
  });
  await audit(tx, input.orgId, input.initiatedBy, "treasury.payout.requested", payout.id, {
    asset: input.asset,
    amountMinor: amount.toString(),
    period: input.period ?? null,
  }, true);
  return payout;
}

const transitions: Record<string, readonly PayoutState[]> = {
  Queued: ["In transit", "Paid", "Failed"],
  "In transit": ["Paid", "Failed"],
  // A bank can return a payout after it was reported paid.
  Paid: ["Failed"],
  Failed: [],
};

async function applyOutcome(
  payoutId: string,
  outcome: { state: PayoutState; reference?: string; failureCode?: string },
  now = new Date(),
) {
  await atomic(async (tx) => {
    const p = await tx.payout.findUniqueOrThrow({ where: { id: payoutId } });
    if (outcome.reference && p.providerPayoutRef && outcome.reference !== p.providerPayoutRef)
      throw new PortalError("PAYOUT_REFERENCE_MISMATCH", 409);
    const reference = outcome.reference ?? p.providerPayoutRef;
    if (p.state === outcome.state || !transitions[p.state].includes(outcome.state)) {
      if (reference !== p.providerPayoutRef)
        await tx.payout.update({ where: { id: p.id }, data: { providerPayoutRef: reference } });
      return;
    }
    const base = {
      orgId: p.orgId,
      environment: p.environment,
      platformAccountId: p.platformAccountId,
      asset: p.asset,
      effectiveAt: now,
    };
    const amount = p.amountMinor.toFixed(0);
    if (outcome.state === "Paid")
      await postFunds(tx, { ...base, source: `payout-paid:${p.id}`, purpose: "Payout paid to the merchant's bank" }, [
        { account: "payout-in-transit", debit: amount, credit: "0" },
        { account: "funds-clearing", debit: "0", credit: amount },
      ]);
    if (outcome.state === "Failed")
      await postFunds(
        tx,
        p.state === "Paid"
          ? { ...base, source: `payout-returned:${p.id}`, purpose: "Payout returned by the bank; funds back to available" }
          : { ...base, source: `payout-failed:${p.id}`, purpose: "Payout failed; funds back to available" },
        p.state === "Paid"
          ? [
              { account: "funds-clearing", debit: amount, credit: "0" },
              { account: "merchant-available", debit: "0", credit: amount },
            ]
          : [
              { account: "payout-in-transit", debit: amount, credit: "0" },
              { account: "merchant-available", debit: "0", credit: amount },
            ],
      );
    await tx.payout.update({
      where: { id: p.id },
      data: {
        state: outcome.state,
        providerPayoutRef: reference,
        failureCode: outcome.failureCode?.slice(0, 100) ?? p.failureCode,
      },
    });
    await audit(tx, p.orgId, "worker", "treasury.payout.state", p.id, { from: p.state, to: outcome.state }, true);
    if (outcome.state !== "In transit")
      await tx.notification.create({
        data: {
          orgId: p.orgId,
          message: outcome.state === "Paid" ? "Payout sent to your bank account" : "A payout could not be completed; the funds are back in your balance",
          href: "/merchant/payouts",
        },
      });
  });
}

async function context(payoutId: string) {
  const p = await db.payout.findUniqueOrThrow({
    where: { id: payoutId },
    include: { platformAccount: true, link: true },
  });
  return { p, adapter: platformAdapter(p.platformAccount) };
}

export async function dispatchPayout(payoutId: string, now = new Date()) {
  const { p, adapter } = await context(payoutId);
  if (p.state !== "Queued") return;
  if (!adapter.createPayout || !p.link.providerAccountId) throw new PortalError("PAYOUT_RAIL_NOT_AVAILABLE", 409);
  let result;
  try {
    // The payout id is the provider idempotency key: a retried job after a
    // crash returns the original payout rather than paying twice.
    result = await adapter.createPayout({
      providerAccountId: p.link.providerAccountId,
      payoutId: p.id,
      amountMinor: BigInt(p.amountMinor.toFixed(0)),
      currency: currencyOf(p.asset)!,
    });
  } catch (error) {
    // A provider refusing the request (insufficient funds, closed account)
    // returns the money to the merchant's balance; anything else retries.
    if (error instanceof PortalError && error.status === 422)
      return applyOutcome(p.id, { state: "Failed", failureCode: error.message }, now);
    throw error;
  }
  await applyOutcome(p.id, result, now);
}

export async function refreshPayout(payoutId: string, now = new Date()) {
  const { p, adapter } = await context(payoutId);
  if (!p.providerPayoutRef || !["In transit", "Paid"].includes(p.state) || !adapter.payoutStatus) return;
  const status = await adapter.payoutStatus({ providerAccountId: p.link.providerAccountId!, reference: p.providerPayoutRef });
  if (status) await applyOutcome(p.id, status, now);
}

function due(schedule: string, now: Date) {
  if (schedule === "daily") return `daily:${now.toISOString().slice(0, 10)}`;
  if (schedule === "weekly" && now.getUTCDay() === 1) return `weekly:${now.toISOString().slice(0, 10)}`;
  if (schedule === "monthly" && now.getUTCDate() === 1) return `monthly:${now.toISOString().slice(0, 7)}`;
  return null;
}

// Scheduled payouts for every merchant whose schedule is due, plus status
// re-reads for payouts still in transit (webhooks may be missed).
export async function sweepPayouts(now = new Date()) {
  let created = 0;
  const accounts = await db.merchantAccount.findMany({ where: { state: { in: ["Live", "Offboarding"] } } });
  for (const account of accounts) {
    const terms = merchantTerms.safeParse(account.terms);
    if (!terms.success) continue;
    const period =
      (account.state as MerchantAccountState) === "Offboarding"
        ? `offboarding:${now.toISOString().slice(0, 10)}`
        : due(terms.data.payout.schedule, now);
    if (!period) continue;
    const links = await db.merchantPlatformLink.findMany({
      where: { orgId: account.orgId, environment: account.environment, state: "Approved", payoutsEnabled: true },
      include: { platformAccount: true },
    });
    const assets = await db.merchantBalance.findMany({
      where: { orgId: account.orgId, environment: account.environment, account: "merchant-available", balance: { gt: 0 } },
    });
    for (const link of links)
      for (const { asset } of assets) {
        try {
          if (!platformModule(link.platformAccount.provider).manifest.holdsFunds) continue;
          const payout = await atomic((tx) =>
            requestPayout(tx, {
              orgId: account.orgId,
              environment: account.environment,
              platformAccountId: link.platformAccountId,
              asset,
              initiatedBy: "schedule",
              period,
              now,
            }),
          );
          if (payout && payout.createdAt.getTime() >= now.getTime() - 1000) created++;
        } catch (error) {
          // One merchant's problem (currency, rail, restriction) never stops
          // the sweep; it is retried at the next due period.
          if (!(error instanceof PortalError) && !(error instanceof Prisma.PrismaClientKnownRequestError)) throw error;
        }
      }
  }
  const stale = await db.payout.findMany({
    where: { state: "In transit", updatedAt: { lt: new Date(now.getTime() - 30 * 60000) } },
    take: 100,
  });
  const bucket = Math.floor(now.getTime() / 1800000);
  for (const p of stale)
    await queue(db, p.orgId, "treasury-payout-status", `treasury-payout-status:${p.id}:${bucket}`, { payoutId: p.id });
  return created;
}
