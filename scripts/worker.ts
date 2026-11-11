import "dotenv/config";
import { sweepPayments } from "../lib/payments/jobs";
import { sweepPartners } from "../lib/partners/service";
import { sweepLinks } from "../lib/treasury/links";
import { sweepPayouts } from "../lib/treasury/payouts";
import { sweepDisputesAndRefunds } from "../lib/treasury/events";
import { sweepReconciliation } from "../lib/treasury/reconciliation";
import { sweepCashOuts } from "../lib/treasury/offramp/cashout";
import { workOnce, retentionSweep } from "../lib/portal/worker";
import { refreshObservations } from "../lib/portal/provider-probes";
import { MarketingService } from "../lib/email/marketing-service";
import { warmLogos } from "../lib/intents/token-logos";
import { crossChainEnabled } from "../lib/intents/checkout";
const once = process.argv.includes("--once");
async function main() {
  let maintenance = 0;
  let probes = 0;
  // Token and chain logos for the crypto checkout, fetched a few at a time
  // beside the other work (about two a minute, leaving CoinGecko's keyless
  // allowance to checkout prices), then checked daily.
  let logos = 0;
  let warming = false;
  do {
    if (!once && !warming && Date.now() > logos && crossChainEnabled()) {
      warming = true;
      void warmLogos()
        .then((r) => (logos = Date.now() + (r.remaining ? 120000 : 86400000)))
        .catch(() => (logos = Date.now() + 600000))
        .finally(() => (warming = false));
    }
    if (Date.now() > maintenance) {
      await retentionSweep();
      await sweepPayments();
      await sweepPartners();
      await sweepLinks();
      await sweepPayouts();
      await sweepDisputesAndRefunds();
      await sweepReconciliation();
      await sweepCashOuts().catch(console.error);
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
