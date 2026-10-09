import "dotenv/config";
import {
  closeStatement,
  feeTotals,
  billingWindow,
} from "../lib/payments/billing";
import { db } from "../lib/portal/db";
// Local operator command; creates pretax usage records only, never sends invoices or collects money.
async function main() {
  const [orgId, month] = process.argv.slice(2);
  if (!orgId || !month)
    throw new Error("Usage: npm run billing:close -- <merchant-id> <YYYY-MM>");
  const { to } = billingWindow(month);
  if (to > new Date()) throw new Error("Billing month has not closed");
  for (const t of await feeTotals(orgId, "production", month)) {
    const s = await closeStatement(orgId, month, t.currency, t.precision);
    console.log(
      JSON.stringify({
        id: s.id,
        month,
        currency: s.currency,
        amountMinor: s.amountMinor.toFixed(0),
        precision: s.precision,
        kind: "pretax-usage-statement",
      }),
    );
  }
}
main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : "Billing close failed");
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
