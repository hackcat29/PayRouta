import "dotenv/config";
import { sweepPayments } from "../lib/payments/jobs";
import { sweepPartners } from "../lib/partners/service";
import { sweepLinks } from "../lib/treasury/links";
import { sweepPayouts } from "../lib/treasury/payouts";
import { sweepDisputesAndRefunds } from "../lib/treasury/events";
import { sweepReconciliation } from "../lib/treasury/reconciliation";
import { workOnce, retentionSweep } from "../lib/portal/worker";
import { refreshObservations } from "../lib/portal/provider-probes";
import { MarketingService } from "../lib/email/marketing-service";
const once = process.argv.includes("--once");
async function main() {
  let maintenance = 0;
  let probes = 0;
  do {
    if (Date.now() > maintenance) {
      await retentionSweep();
      await sweepPayments();
      await sweepPartners();
      await sweepLinks();
      await sweepPayouts();
      await sweepDisputesAndRefunds();
      await sweepReconciliation();
      await MarketingService.processScheduledDrips().catch(console.error);
      maintenance = Date.now() + 60000;
    }
    if (Date.now() > probes) {
      await refreshObservations();
      probes = Date.now() + 15000;
    }
    const worked = await workOnce();
    if (once && !worked) break;
    if (!worked) await new Promise((r) => setTimeout(r, 2000));
  } while (true);
}
main()
  .then(() => process.exit(0))
  .catch(() => {
    console.error("Worker stopped; check database and adapter configuration.");
    process.exit(1);
  });
