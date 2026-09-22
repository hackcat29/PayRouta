import { tokenAsset, validTokenAmount, tokenMinor } from "./assets";
import { mapReceiptState, BlockchainPaymentState } from "./finality";
import type { BlockchainRpcProvider } from "./rpc";
import { PortalError } from "../portal/domain";

// Direct stablecoin payment handling: address validation, amount validation,
// transaction observation, and mapping into the normalized payment lifecycle.

export function validatePaymentAddress(network: string, address: string): void {
  if (!/^0x[a-fA-F0-9]{40}$/.test(address))
    throw new PortalError("INVALID_PAYMENT_ADDRESS");
}

// Amount is validated against the token's on-chain decimals before any value is
// trusted; never float.
export function validateTokenAmount(
  network: string,
  identifier: string,
  amount: string,
): bigint {
  const asset = tokenAsset(network, identifier);
  if (!asset) throw new PortalError("UNSUPPORTED_TOKEN");
  if (!validTokenAmount(amount, asset.decimals))
    throw new PortalError("INVALID_TOKEN_AMOUNT");
  return tokenMinor(amount, asset.decimals);
}

export interface PaymentObservation {
  state: BlockchainPaymentState;
  confirmations: number;
  final: boolean;
}

export async function observePayment(
  rpc: BlockchainRpcProvider,
  chainId: string,
  txHash: string,
): Promise<PaymentObservation> {
  const receipt = await rpc.getTransactionReceipt(chainId, txHash);
  const state = mapReceiptState(chainId, receipt);
  return {
    state,
    confirmations: receipt?.confirmations ?? 0,
    final: !!receipt && receipt.status === "success" && receipt.confirmations >= 1,
  };
}
