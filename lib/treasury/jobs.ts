import { provisionLink, refreshLink } from "./links";
import { recordAvailability, releaseReserve } from "./funds";
import { dispatchPayout, refreshPayout } from "./payouts";
import { processPlatformEvent } from "./events";
import { dispatchRefund, refreshRefund } from "./refunds";
import { refreshDispute } from "./disputes";

export async function treasuryJob(kind: string, p: Record<string, string>) {
  if (kind === "treasury-link-provision") await provisionLink(p.linkId);
  else if (kind === "treasury-link-status") await refreshLink(p.linkId);
  else if (kind === "treasury-availability") await recordAvailability(p.attemptId);
  else if (kind === "treasury-reserve-release") await releaseReserve(p.attemptId);
  else if (kind === "treasury-payout-dispatch") await dispatchPayout(p.payoutId);
  else if (kind === "treasury-payout-status") await refreshPayout(p.payoutId);
  else if (kind === "treasury-event") await processPlatformEvent(p.eventId);
  else if (kind === "treasury-refund-dispatch") await dispatchRefund(p.refundId);
  else if (kind === "treasury-refund-status") await refreshRefund(p.refundId);
  else if (kind === "treasury-dispute") await refreshDispute(p.platformAccountId, p.reference);
  else throw new Error("UNKNOWN_TREASURY_JOB");
}
