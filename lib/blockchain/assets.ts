// Asset registry. Stablecoins are addressed by (network, namespaced identifier)
// exactly as the existing PayRouta asset schema represents them. The token
// contract address is validated before any amount is trusted.
export interface TokenAsset {
  network: string;
  identifier: string;
  symbol: string;
  decimals: number;
  // Lowercase token contract address for the chain.
  contractAddress: string;
}

const usdcBase = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const usdcEthereum = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";

export const tokenAssets: readonly TokenAsset[] = [
  {
    network: "eip155:8453",
    identifier: `erc20:${usdcBase}`,
    symbol: "USDC",
    decimals: 6,
    contractAddress: usdcBase,
  },
  {
    network: "eip155:1",
    identifier: `erc20:${usdcEthereum}`,
    symbol: "USDC",
    decimals: 6,
    contractAddress: usdcEthereum,
  },
];

export function tokenAsset(network: string, identifier: string): TokenAsset | undefined {
  return tokenAssets.find(
    (a) => a.network === network && a.identifier === identifier,
  );
}

export function isSupportedToken(network: string, identifier: string): boolean {
  return tokenAssets.some(
    (a) => a.network === network && a.identifier === identifier,
  );
}

// Token amount validation: an exact decimal string within the token's decimals.
export function validTokenAmount(value: string, decimals: number): boolean {
  if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(value)) return false;
  return (value.split(".")[1]?.length || 0) <= decimals;
}

export function tokenMinor(value: string, decimals: number): bigint {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0"));
}
