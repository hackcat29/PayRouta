import { chain } from "./chains";
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

// Sources: Tether supported protocols and Circle stablecoin contract registries. No wrapped or bridged tokens.
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
  {
    network: "eip155:1",
    identifier: "erc20:0xdac17f958d2ee523a2206206994597c13d831ec7",
    symbol: "USDT",
    decimals: 6,
    contractAddress: "0xdac17f958d2ee523a2206206994597c13d831ec7",
  },
  {
    network: "eip155:1",
    identifier: "erc20:0x1abaea1f7c830bd89acc67ec4af516284b1bc33c",
    symbol: "EURC",
    decimals: 6,
    contractAddress: "0x1abaea1f7c830bd89acc67ec4af516284b1bc33c",
  },
  {
    network: "eip155:8453",
    identifier: "erc20:0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42",
    symbol: "EURC",
    decimals: 6,
    contractAddress: "0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42",
  },
  {
    network: "eip155:5042",
    identifier: "erc20:0x3600000000000000000000000000000000000000",
    symbol: "USDC",
    decimals: 6,
    contractAddress: "0x3600000000000000000000000000000000000000",
  },
  {
    network: "eip155:5042002",
    identifier: "erc20:0x3600000000000000000000000000000000000000",
    symbol: "USDC",
    decimals: 6,
    contractAddress: "0x3600000000000000000000000000000000000000",
  },
  {
    network: "eip155:43114",
    identifier: "erc20:0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e",
    symbol: "USDC",
    decimals: 6,
    contractAddress: "0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e",
  },
  {
    network: "eip155:43113",
    identifier: "erc20:0x5425890298aed601595a70ab815c96711a31bc65",
    symbol: "USDC",
    decimals: 6,
    contractAddress: "0x5425890298aed601595a70ab815c96711a31bc65",
  },
  {
    network: "eip155:42161",
    identifier: "erc20:0xaf88d065e77c8cc2239327c5edb3a432268e5831",
    symbol: "USDC",
    decimals: 6,
    contractAddress: "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
  },
  {
    network: "eip155:421614",
    identifier: "erc20:0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d",
    symbol: "USDC",
    decimals: 6,
    contractAddress: "0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d",
  },
  {
    network: "eip155:137",
    identifier: "erc20:0x3c499c542cef5e3811e1192ce70d8cc03d5c3359",
    symbol: "USDC",
    decimals: 6,
    contractAddress: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359",
  },
  {
    network: "eip155:80002",
    identifier: "erc20:0x41e94eb019c0762f9bfcf9fb1e58725bfb0e7582",
    symbol: "USDC",
    decimals: 6,
    contractAddress: "0x41e94eb019c0762f9bfcf9fb1e58725bfb0e7582",
  },
  {
    network: "solana:mainnet",
    identifier: "spl:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    symbol: "USDC",
    decimals: 6,
    contractAddress: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  },
  {
    network: "solana:devnet",
    identifier: "spl:4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    symbol: "USDC",
    decimals: 6,
    contractAddress: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  },
  {
    network: "stellar:pubnet",
    identifier:
      "stellar:USDC.GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    symbol: "USDC",
    decimals: 7,
    contractAddress: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
  },
  {
    network: "stellar:testnet",
    identifier:
      "stellar:USDC.GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    symbol: "USDC",
    decimals: 7,
    contractAddress: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  },
  {
    network: "eip155:11155111",
    identifier: "erc20:0x1c7d4b196cb0c7b01d743fbc6116a902379c7238",
    symbol: "USDC",
    decimals: 6,
    contractAddress: "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238",
  },
  {
    network: "eip155:84532",
    identifier: "erc20:0x036cbd53842c5426634e7929541ec2318f3dcf7e",
    symbol: "USDC",
    decimals: 6,
    contractAddress: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
  },
  {
    network: "eip155:11155111",
    identifier: "erc20:0x08210f9170f89ab7658f0b5e3ff39b0e03c594d4",
    symbol: "EURC",
    decimals: 6,
    contractAddress: "0x08210f9170f89ab7658f0b5e3ff39b0e03c594d4",
  },
  {
    network: "eip155:84532",
    identifier: "erc20:0x808456652fdb597867f38412077a9182bf77359f",
    symbol: "EURC",
    decimals: 6,
    contractAddress: "0x808456652fdb597867f38412077a9182bf77359f",
  },
  {
    network: "eip155:43114",
    identifier: "erc20:0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7",
    symbol: "USDT",
    decimals: 6,
    contractAddress: "0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7",
  },

  {
    network: "eip155:5042",
    identifier: "erc20:0xbef5f6d51cb62b58e6a8f77868681825c6fe21c1",
    symbol: "EURC",
    decimals: 6,
    contractAddress: "0xbef5f6d51cb62b58e6a8f77868681825c6fe21c1",
  },
  {
    network: "eip155:5042002",
    identifier: "erc20:0x89b50855aa3be2f677cd6303cec089b5f319d72a",
    symbol: "EURC",
    decimals: 6,
    contractAddress: "0x89b50855aa3be2f677cd6303cec089b5f319d72a",
  },
  {
    network: "eip155:43114",
    identifier: "erc20:0xc891eb4cbdeff6e073e859e987815ed1505c2acd",
    symbol: "EURC",
    decimals: 6,
    contractAddress: "0xc891eb4cbdeff6e073e859e987815ed1505c2acd",
  },
  {
    network: "eip155:43113",
    identifier: "erc20:0x5e44db7996c682e92a960b65ac713a54ad815c6b",
    symbol: "EURC",
    decimals: 6,
    contractAddress: "0x5e44db7996c682e92a960b65ac713a54ad815c6b",
  },
  {
    network: "solana:mainnet",
    identifier: "spl:Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
    symbol: "USDT",
    decimals: 6,
    contractAddress: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  },
  {
    network: "solana:mainnet",
    identifier: "spl:HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr",
    symbol: "EURC",
    decimals: 6,
    contractAddress: "HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr",
  },
  {
    network: "solana:devnet",
    identifier: "spl:HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr",
    symbol: "EURC",
    decimals: 6,
    contractAddress: "HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr",
  },
  {
    network: "stellar:pubnet",
    identifier:
      "stellar:EURC.GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBSDP6SJY4ITNPP2",
    symbol: "EURC",
    decimals: 7,
    contractAddress: "GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBSDP6SJY4ITNPP2",
  },
  {
    network: "stellar:testnet",
    identifier:
      "stellar:EURC.GB3Q6QDZYTHWT7E5PVS3W7FUT5GVAFC5KSZFFLPU25GO7VTC3NM2ZTVO",
    symbol: "EURC",
    decimals: 7,
    contractAddress: "GB3Q6QDZYTHWT7E5PVS3W7FUT5GVAFC5KSZFFLPU25GO7VTC3NM2ZTVO",
  },
];

export function tokenAsset(
  network: string,
  identifier: string,
): TokenAsset | undefined {
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
  return (
    BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt(fraction.padEnd(decimals, "0"))
  );
}

// Protocol integer widths apply before an invoice or wallet request is offered.
export function validStablecoinAmount(
  network: string,
  identifier: string,
  amount: string,
) {
  const token = tokenAsset(network, identifier),
    family = chain(network)?.family;
  if (
    !token ||
    !family ||
    amount.length > 100 ||
    !validTokenAmount(amount, token.decimals)
  )
    return false;
  const units = tokenMinor(amount, token.decimals);
  const bits = family === "evm" ? 256n : family === "solana" ? 64n : 63n;
  return units > 0n && units < 2n ** bits;
}
