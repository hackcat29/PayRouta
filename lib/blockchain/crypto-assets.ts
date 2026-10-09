import {
  tokenAsset,
  tokenMinor,
  validStablecoinAmount,
  validTokenAmount,
} from "./assets";
import { chain } from "./chains";
import catalog from "./crypto-catalog.json";
export type CryptoAsset = {
  network: string;
  identifier: string;
  symbol: string;
  decimals: number;
  contractAddress: string;
  coinGeckoId: string;
  name?: string;
  platform?: string;
  marketCapRank?: number | null;
  deploymentSource?: string;
  tokenListSource?: string;
  reviewedAt?: string;
  verifiedAt?: string;
  originPlatform?: string;
  originSource?: string;
  originNote?: string;
  listedPrimaryPlatform?: string | null;
};
const native = (
  networks: string[],
  symbol: string,
  coinGeckoId: string,
): CryptoAsset[] =>
  networks.map((network) => ({
    network,
    identifier: `native:${symbol}`,
    symbol,
    decimals: 18,
    contractAddress: "",
    coinGeckoId,
  }));
// Exact deployments only. Test coins use mainnet reference prices for a free sandbox checkout.
export const cryptoAssets: readonly CryptoAsset[] = [
  ...["solana:mainnet", "solana:devnet"].map((network) => ({
    network,
    identifier: "native:SOL",
    symbol: "SOL",
    decimals: 9,
    contractAddress: "",
    coinGeckoId: "solana",
  })),
  ...["stellar:pubnet", "stellar:testnet"].map((network) => ({
    network,
    identifier: "native:XLM",
    symbol: "XLM",
    decimals: 7,
    contractAddress: "",
    coinGeckoId: "stellar",
  })),
  ...native(
    [
      "eip155:1",
      "eip155:11155111",
      "eip155:8453",
      "eip155:84532",
      "eip155:42161",
      "eip155:421614",
    ],
    "ETH",
    "ethereum",
  ),
  ...native(["eip155:43114", "eip155:43113"], "AVAX", "avalanche-2"),
  ...native(["eip155:137", "eip155:80002"], "POL", "polygon-ecosystem-token"),
  ...catalog,
];
export const cryptoAsset = (network: string, identifier: string) =>
  cryptoAssets.find(
    (a) => a.network === network && a.identifier === identifier,
  );
export const paymentAsset = (network: string, identifier: string) =>
  tokenAsset(network, identifier) ?? cryptoAsset(network, identifier);
// Stablecoins retain their own exact deployment registry. USD wallet quotes
// use observed market prices, including EURC, rather than assuming a peg.
export const quoteAsset = (
  network: string,
  identifier: string,
): CryptoAsset | undefined => {
  const stablecoin = tokenAsset(network, identifier);
  if (!stablecoin) return cryptoAsset(network, identifier);
  const ids: Record<string, string> = {
    USDC: "usd-coin",
    USDT: "tether",
    EURC: "euro-coin",
  };
  const coinGeckoId = ids[stablecoin.symbol];
  return coinGeckoId ? { ...stablecoin, coinGeckoId } : undefined;
};
export const onchainMethod = (network: string, identifier: string) =>
  cryptoAsset(network, identifier) ? "crypto-app" : "stablecoin";
export function validPaymentAmount(
  network: string,
  identifier: string,
  amount: string,
) {
  const a = cryptoAsset(network, identifier);
  if (!a) return validStablecoinAmount(network, identifier, amount);
  if (amount.length > 100 || !validTokenAmount(amount, a.decimals))
    return false;
  const units = tokenMinor(amount, a.decimals);
  const family = chain(network)?.family;
  const bits = family === "evm" ? 256n : family === "solana" ? 64n : 63n;
  return units > 0n && units < 2n ** bits;
}
