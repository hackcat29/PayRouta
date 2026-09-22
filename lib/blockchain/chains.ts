// Chain registry. Chains are named by CAIP-2 style identifiers. RPC URLs are
// supplied by the configured RPC provider(s), never hardcoded as the sole path;
// an empty list means direct stablecoin support is fail-closed for that chain.
export interface Chain {
  id: string;
  name: string;
  blockTimeSeconds: number;
  confirmationsForFinality: number;
  nativeAssetSymbol: string;
}

export const supportedChains: readonly Chain[] = [
  {
    id: "eip155:8453",
    name: "Base",
    blockTimeSeconds: 2,
    confirmationsForFinality: 1,
    nativeAssetSymbol: "ETH",
  },
  {
    id: "eip155:1",
    name: "Ethereum",
    blockTimeSeconds: 12,
    confirmationsForFinality: 12,
    nativeAssetSymbol: "ETH",
  },
];

export function chain(id: string): Chain | undefined {
  return supportedChains.find((c) => c.id === id);
}
