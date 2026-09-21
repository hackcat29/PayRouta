import { db } from "../portal/db";
// Rebuildable projection; grouping by book and asset never invents an FX conversion.
export async function ledger(orgId: string, environment: string) {
  return db.$queryRaw<
    { book: string; asset: string; account: string; balance: string }[]
  >`
 SELECT e.book,e.asset,p.account,SUM(p.debit-p.credit)::text AS balance
 FROM "JournalEntry" e JOIN "JournalPosting" p ON p."entryId"=e.id
 WHERE e."orgId"=${orgId} AND e.environment=${environment}
 GROUP BY e.book,e.asset,p.account ORDER BY e.book,e.asset,p.account`;
}
