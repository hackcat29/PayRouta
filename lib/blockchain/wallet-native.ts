import { chain } from "./chains";
import { validateStablecoinPayment } from "./stablecoin-payment";
import type { DepositPayment } from "./wallet-payment";
export type CheckoutApi = (
  action: object,
) => Promise<{ [key: string]: unknown }>;
export interface SolanaWallet {
  publicKey?: { toBase58(): string };
  connect(): Promise<{ publicKey: { toBase58(): string } }>;
  signTransaction(
    transaction: unknown,
  ): Promise<{ serialize(): { toString(encoding: "base64"): string } }>;
}
export interface StellarWallet {
  requestAccess(): Promise<{ address: string; error?: unknown }>;
  getNetworkDetails(): Promise<{ networkPassphrase: string; error?: unknown }>;
  signTransaction(
    unsigned: string,
    options: { networkPassphrase: string; address: string },
  ): Promise<{ signedTxXdr: string; signerAddress: string; error?: unknown }>;
}
function alive(expiresAt?: string) {
  if (
    expiresAt &&
    (!Number.isFinite(Date.parse(expiresAt)) ||
      Date.parse(expiresAt) <= Date.now())
  )
    throw new Error("Payment window expired. Refresh checkout before paying.");
}
export async function submitNativeDeposit(
  payment: DepositPayment,
  api: CheckoutApi,
  wallet: SolanaWallet | StellarWallet,
  expiresAt?: string,
) {
  const { network } = validateStablecoinPayment(payment);
  alive(expiresAt);
  let payer: string;
  if (network.family === "solana")
    payer = (await (wallet as SolanaWallet).connect()).publicKey.toBase58();
  else if (network.family === "stellar") {
    const w = wallet as StellarWallet,
      access = await w.requestAccess();
    if (access.error || !access.address)
      throw new Error("Wallet connection was cancelled.");
    payer = access.address;
    const details = await w.getNetworkDetails();
    if (details.error || details.networkPassphrase !== network.passphrase)
      throw new Error(`Switch Freighter to ${network.name} before paying.`);
  } else throw new Error("Unsupported wallet type");
  alive(expiresAt);
  const p = await api({ action: "prepare-wallet", payer });
  if (
    p.network !== network.id ||
    p.payer !== payer ||
    typeof p.unsigned !== "string" ||
    typeof p.submissionId !== "string" ||
    typeof p.expiresAt !== "string"
  )
    throw new Error("Invalid wallet payment instructions");
  alive(p.expiresAt);
  let signed: string;
  if (network.family === "solana") {
    const { Transaction } = await import("@solana/web3.js");
    const transaction = Transaction.from(
      Uint8Array.from(atob(p.unsigned), (c) => c.charCodeAt(0)),
    );
    const w = wallet as SolanaWallet;
    const result = await w.signTransaction(transaction);
    if (w.publicKey?.toBase58() !== payer)
      throw new Error("Wallet account changed. Reconnect before paying.");
    signed = result.serialize().toString("base64");
  } else {
    const w = wallet as StellarWallet,
      result = await w.signTransaction(p.unsigned, {
        networkPassphrase: network.passphrase!,
        address: payer,
      });
    if (result.error || !result.signedTxXdr)
      throw new Error("Payment was cancelled in your wallet.");
    if (result.signerAddress !== payer)
      throw new Error("Wallet account changed. Reconnect before paying.");
    const details = await w.getNetworkDetails();
    if (details.error || details.networkPassphrase !== network.passphrase)
      throw new Error(`Switch Freighter to ${network.name} before paying.`);
    signed = result.signedTxXdr;
  }
  alive(expiresAt);
  alive(p.expiresAt);
  // From this point a response can be lost after broadcast. Never invite a second payment.
  try {
    const sent = await api({
      action: "submit-wallet",
      submissionId: p.submissionId,
      signed,
    });
    if (typeof sent.transactionHash !== "string")
      throw new Error("Missing transfer receipt");
    return sent.transactionHash;
  } catch {
    throw Object.assign(
      new Error(
        "Transfer may have been sent. Check wallet activity and wait for confirmation before paying again.",
      ),
      { mayHaveSent: true },
    );
  }
}
export async function browserNativeWallet(
  network: string,
): Promise<SolanaWallet | StellarWallet> {
  if (chain(network)?.family === "solana") {
    const w = window as Window & {
      phantom?: { solana?: SolanaWallet };
      solana?: SolanaWallet;
    };
    const wallet = w.phantom?.solana ?? w.solana;
    if (!wallet)
      throw new Error(
        "Open this checkout in a Solana wallet browser, or send using the address below.",
      );
    return wallet;
  }
  return await import("@stellar/freighter-api");
}
