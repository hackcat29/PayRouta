// Daily reconciliation of each merchant's balance at a fund-holding platform
// account against what the provider reports for its sub-account.
//
// The provider's total (available + pending) must equal what PayRouta's
// ledger says still sits in the sub-account: pending + available + reserve,
// less anything the merchant owes (receivable). Payouts in transit and
// disputed amounts have already left the sub-account. A mismatch is recorded
// and stops that merchant's payouts until operations resolve it.
import { db } from "../portal/db";
import { audit, atomic } from "../portal/service";
import { platformBalance } from "./ledger";
import { platformAdapter, platformModule } from "./platforms/registry";

const inSubAccount = ["merchant-pending", "merchant-available", "merchant-reserve", "merchant-receivable"];

export async function reconcileLink(linkId: string, now = new Date()) {
  const link = await db.merchantPlatformLink.findUniqueOrThrow({ where: { id: linkId }, include: { platformAccount: true } });
  if (!link.providerAccountId || !platformModule(link.platformAccount.provider).manifest.holdsFunds) return [];
  const adapter = platformAdapter(link.platformAccount);
  if (!adapter.accountBalance) return [];
  const provider = await adapter.accountBalance(link.providerAccountId);
  const assets = await db.journalEntry.findMany({
    where: { orgId: link.orgId, environment: link.environment, book: "merchant-funds", platformAccountId: link.platformAccountId },
    distinct: ["asset"],
    select: { asset: true },
  });
  const currencies = new Set([
    ...assets.map((a) => a.asset.match(/^fiat:([A-Z]{3}):$/)?.[1]).filter((c): c is string => !!c),
    ...Object.keys(provider),
  ]);
  const day = now.toISOString().slice(0, 10);
  const results = [];
  for (const currency of currencies) {
    const asset = `fiat:${currency}:`;
    let ledger = 0n;
    for (const account of inSubAccount)
      ledger += await platformBalance(db, { orgId: link.orgId, environment: link.environment, platformAccountId: link.platformAccountId, asset, account });
    const reported = provider[currency] ?? 0n;
    const result = reported === ledger ? "Matched" : "Mismatch";
    const row = await atomic(async (tx) => {
      const saved = await tx.platformReconciliation.upsert({
        where: { linkId_asset_day: { linkId: link.id, asset, day } },
        create: {
          linkId: link.id,
          orgId: link.orgId,
          environment: link.environment,
          platformAccountId: link.platformAccountId,
          asset,
          day,
          providerMinor: reported.toString(),
          ledgerMinor: ledger.toString(),
          result,
        },
        update: { providerMinor: reported.toString(), ledgerMinor: ledger.toString(), result },
      });
      if (result === "Mismatch")
        await audit(tx, link.orgId, "worker", "treasury.reconciliation.mismatch", saved.id, {
          asset,
          providerMinor: reported.toString(),
          ledgerMinor: ledger.toString(),
        }, true);
      return saved;
    });
    results.push(row);
  }
  return results;
}

// Payouts wait while a merchant's latest reconciliation at that platform
// account is a mismatch.
export async function reconciliationBlocksPayout(orgId: string, platformAccountId: string, asset: string) {
  const latest = await db.platformReconciliation.findFirst({
    where: { orgId, platformAccountId, asset },
    orderBy: { createdAt: "desc" },
  });
  return latest?.result === "Mismatch";
}

export async function sweepReconciliation(now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  const links = await db.merchantPlatformLink.findMany({
    where: { state: { in: ["Approved", "Restricted"] }, providerAccountId: { not: null } },
    select: { id: true, reconciliations: { where: { day }, select: { id: true }, take: 1 } },
  });
  let done = 0;
  for (const l of links)
    if (!l.reconciliations.length) {
      try {
        await reconcileLink(l.id, now);
        done++;
      } catch (error) {
        // One provider being unreachable never stops the others; tomorrow's
        // sweep (or the next minute's) tries again.
        console.error(JSON.stringify({ event: "treasury.reconciliation.failed", linkId: l.id, error: String(error) }));
      }
    }
  return done;
}
