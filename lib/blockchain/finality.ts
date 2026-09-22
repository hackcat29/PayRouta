import { chain } from "./chains";
import type { TransactionReceipt } from "./rpc";

// Confirmation / finality / reorg safety. A chain's configured finality depth
// decides when an observed on-chain payment is treated as Confirmed rather than
// Pending.
export function confirmationsForFinality(chainId: string): number {
  return chain(chainId)?.confirmationsForFinality ?? 1;
}

export function isFinal(chainId: string, confirmations: number): boolean {
  return confirmations >= confirmationsForFinality(chainId);
}

// Reorg safety: a receipt is only trusted once the observed block depth is
// stable. We conservatively require at least one extra block beyond finality
// when finality depth is low, to avoid acting on a chain tip that may reorg.
export function reorgSafe(chainId: string, confirmations: number): boolean {
  const required = Math.max(confirmationsForFinality(chainId), 1);
  return confirmations >= required;
}

// Map an observed on-chain receipt into the normalized PayRouta payment
// lifecycle. Reverted transactions are Rejected; mined-but-not-final are
// Pending; final successful transactions are Confirmed.
export type BlockchainPaymentState = "Pending" | "Confirmed" | "Rejected";

export function mapReceiptState(
  chainId: string,
  receipt: TransactionReceipt | null,
): BlockchainPaymentState {
  if (!receipt) return "Pending";
  if (receipt.status === "reverted") return "Rejected";
  return isFinal(chainId, receipt.confirmations) ? "Confirmed" : "Pending";
}
