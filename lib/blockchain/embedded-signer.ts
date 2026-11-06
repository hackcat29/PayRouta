import type { WalletProvider } from "./wallet-payment";

export type EmbeddedWallet = {
  address: string;
  walletClientType: string;
  getEthereumProvider(): Promise<WalletProvider>;
};

// Resolve anew for each signature. Never reuse a provider after wallet logout
// or pick a different wallet merely because it is first in the SDK's list.
export async function embeddedEvmSigner(
  authenticated: boolean,
  ready: boolean,
  wallets: readonly EmbeddedWallet[],
  address: string,
) {
  if (!authenticated || !ready || !/^0x[0-9a-f]{40}$/i.test(address))
    return null;
  const wallet = wallets.find(
    (w) =>
      ["privy", "privy-v2"].includes(w.walletClientType) &&
      w.address.toLowerCase() === address.toLowerCase(),
  );
  if (!wallet) return null;
  const provider = await wallet.getEthereumProvider();
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  if (
    !Array.isArray(accounts) ||
    typeof accounts[0] !== "string" ||
    accounts[0].toLowerCase() !== address.toLowerCase()
  )
    throw new Error(
      "Your wallet changed. Sign in with the wallet that controls this receive account.",
    );
  return {
    kind: "evm" as const,
    source: "privy" as const,
    accountId: address.toLowerCase(),
    provider,
  };
}
