// Merchant-funds ledger (docs/AGGREGATOR.md §4). Postings go through the
// shared journal; the database keeps MerchantBalance in step with every
// posting and refuses any entry that would overdraw a merchant.
//
// Normal balances (credit minus debit, as stored in MerchantBalance):
//   funds-clearing         what the platform account holds for merchants (≤ 0)
//   merchant-pending       captured, not yet settled by the provider
//   merchant-available     can be paid out
//   merchant-reserve       rolling reserve
//   merchant-dispute-hold  frozen against an open chargeback
//   merchant-receivable    negative balance the merchant owes PayRouta (≤ 0)
//   payout-in-transit      instructed, not yet confirmed paid
//   fee-collected          PayRouta fees withheld at source
import { randomUUID } from "node:crypto";
import { db } from "../portal/db";
import type { Tx } from "../payments/service";
import { post, type Posting } from "../payments/journal";

export function postFunds(
  tx: Tx,
  input: {
    orgId: string;
    environment: string;
    platformAccountId: string;
    source: string;
    asset: string;
    purpose: string;
    effectiveAt: Date;
  },
  lines: Posting[],
) {
  return post(tx, { ...input, book: "merchant-funds" }, lines);
}

export async function merchantBalances(orgId: string, environment: string) {
  const rows = await db.merchantBalance.findMany({
    where: { orgId, environment },
    orderBy: [{ asset: "asc" }, { account: "asc" }],
  });
  return rows.map((r) => ({
    asset: r.asset,
    account: r.account,
    balance: r.balance.toFixed(0),
  }));
}

// One merchant-funds account's balance (credit minus debit) at one platform
// account. MerchantBalance holds the merchant-wide total; payouts, refunds
// and disputes need what sits at the specific provider.
export async function platformBalance(
  tx: Tx | typeof db,
  input: { orgId: string; environment: string; platformAccountId: string; asset: string; account: string },
) {
  const [row] = await tx.$queryRaw<{ balance: string }[]>`
    SELECT COALESCE(SUM(p.credit - p.debit), 0)::text AS balance
    FROM "JournalEntry" e JOIN "JournalPosting" p ON p."entryId" = e.id
    WHERE e."orgId" = ${input.orgId} AND e.environment = ${input.environment} AND e.book = 'merchant-funds'
      AND e."platformAccountId" = ${input.platformAccountId} AND e.asset = ${input.asset}
      AND p.account = ${input.account}`;
  return BigInt(row.balance);
}

// Set-off: money a merchant owes PayRouta (refunds or disputes beyond its
// balance) is recovered from its available balance at the same platform
// account before anything else is paid out. Returns the amount recovered.
export async function recoverReceivable(
  tx: Tx,
  input: { orgId: string; environment: string; platformAccountId: string; asset: string; now: Date },
) {
  const owed = -(await platformBalance(tx, { ...input, account: "merchant-receivable" }));
  const available = await platformBalance(tx, { ...input, account: "merchant-available" });
  const amount = owed < available ? owed : available;
  if (amount <= 0n) return 0n;
  await postFunds(
    tx,
    {
      orgId: input.orgId,
      environment: input.environment,
      platformAccountId: input.platformAccountId,
      source: `setoff:${input.platformAccountId}:${input.asset}:${randomUUID()}`,
      asset: input.asset,
      purpose: "Set-off: available balance recovers what the merchant owes",
      effectiveAt: input.now,
    },
    [
      { account: "merchant-available", debit: amount.toString(), credit: "0" },
      { account: "merchant-receivable", debit: "0", credit: amount.toString() },
    ],
  );
  return amount;
}
