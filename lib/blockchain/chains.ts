export interface Chain {
  id: string;
  name: string;
  family: "evm" | "solana" | "stellar";
  testnet: boolean;
  alchemyName: string;
  nativeAssetSymbol: string;
  nativeDecimals: number;
  publicRpc: string;
  explorer: string;
  blockTimeSeconds: number;
  confirmationsForFinality: number;
  genesisHash?: string;
  passphrase?: string;
}
const evm = (
  id: number,
  name: string,
  alchemyName: string,
  nativeAssetSymbol: string,
  publicRpc: string,
  explorer: string,
  testnet = false,
): Chain => ({
  id: `eip155:${id}`,
  name,
  alchemyName,
  nativeAssetSymbol,
  nativeDecimals: 18,
  publicRpc,
  explorer,
  family: "evm",
  testnet,
  blockTimeSeconds: id === 1 ? 12 : 2,
  confirmationsForFinality: id === 1 ? 12 : 1,
});
export const supportedChains: readonly Chain[] = [
  evm(
    8453,
    "Base",
    "base-mainnet",
    "ETH",
    "https://base-rpc.publicnode.com",
    "https://basescan.org",
  ),
  evm(
    1,
    "Ethereum",
    "eth-mainnet",
    "ETH",
    "https://ethereum-rpc.publicnode.com",
    "https://etherscan.io",
  ),
  evm(
    5042,
    "Arc",
    "arc-mainnet",
    "USDC",
    "https://rpc.mainnet.arc.io",
    "https://explorer.arc.io",
  ),
  evm(
    43114,
    "Avalanche",
    "avax-mainnet",
    "AVAX",
    "https://api.avax.network/ext/bc/C/rpc",
    "https://snowtrace.io",
  ),
  evm(
    42161,
    "Arbitrum",
    "arb-mainnet",
    "ETH",
    "https://arb1.arbitrum.io/rpc",
    "https://arbiscan.io",
  ),
  evm(
    137,
    "Polygon",
    "polygon-mainnet",
    "POL",
    "https://polygon-bor-rpc.publicnode.com",
    "https://polygonscan.com",
  ),
  evm(
    84532,
    "Base Sepolia",
    "base-sepolia",
    "ETH",
    "https://sepolia.base.org",
    "https://sepolia.basescan.org",
    true,
  ),
  evm(
    11155111,
    "Ethereum Sepolia",
    "eth-sepolia",
    "ETH",
    "https://ethereum-sepolia-rpc.publicnode.com",
    "https://sepolia.etherscan.io",
    true,
  ),
  evm(
    5042002,
    "Arc Testnet",
    "arc-testnet",
    "USDC",
    "https://rpc.testnet.arc.io",
    "https://explorer.testnet.arc.io",
    true,
  ),
  evm(
    43113,
    "Avalanche Fuji",
    "avax-fuji",
    "AVAX",
    "https://api.avax-test.network/ext/bc/C/rpc",
    "https://testnet.snowtrace.io",
    true,
  ),
  evm(
    421614,
    "Arbitrum Sepolia",
    "arb-sepolia",
    "ETH",
    "https://sepolia-rollup.arbitrum.io/rpc",
    "https://sepolia.arbiscan.io",
    true,
  ),
  evm(
    80002,
    "Polygon Amoy",
    "polygon-amoy",
    "POL",
    "https://polygon-amoy-bor-rpc.publicnode.com",
    "https://amoy.polygonscan.com",
    true,
  ),
  {
    id: "solana:mainnet",
    name: "Solana",
    family: "solana",
    testnet: false,
    alchemyName: "solana-mainnet",
    nativeAssetSymbol: "SOL",
    nativeDecimals: 9,
    publicRpc: "https://api.mainnet-beta.solana.com",
    explorer: "https://explorer.solana.com",
    blockTimeSeconds: 0.4,
    confirmationsForFinality: 32,
    genesisHash: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
  },
  {
    id: "solana:devnet",
    name: "Solana Devnet",
    family: "solana",
    testnet: true,
    alchemyName: "solana-devnet",
    nativeAssetSymbol: "SOL",
    nativeDecimals: 9,
    publicRpc: "https://api.devnet.solana.com",
    explorer: "https://explorer.solana.com",
    blockTimeSeconds: 0.4,
    confirmationsForFinality: 32,
    genesisHash: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
  },
  {
    id: "stellar:pubnet",
    name: "Stellar",
    family: "stellar",
    testnet: false,
    alchemyName: "stellar-mainnet",
    nativeAssetSymbol: "XLM",
    nativeDecimals: 7,
    publicRpc: "https://rpc.mainnet.stellar.gateway.fm",
    explorer: "https://stellar.expert/explorer/public",
    blockTimeSeconds: 5,
    confirmationsForFinality: 1,
    passphrase: "Public Global Stellar Network ; September 2015",
  },
  {
    id: "stellar:testnet",
    name: "Stellar Testnet",
    family: "stellar",
    testnet: true,
    alchemyName: "stellar-testnet",
    nativeAssetSymbol: "XLM",
    nativeDecimals: 7,
    publicRpc: "https://soroban-testnet.stellar.org",
    explorer: "https://stellar.expert/explorer/testnet",
    blockTimeSeconds: 5,
    confirmationsForFinality: 1,
    passphrase: "Test SDF Network ; September 2015",
  },
];
export const chain = (id: string) => supportedChains.find((c) => c.id === id);
export const networkName = (id?: string) => (id ? (chain(id)?.name ?? id) : "");
export const isTestnet = (id: string) => chain(id)?.testnet === true;
export function transactionExplorer(network: string, hash: string) {
  const c = chain(network);
  if (!c) return undefined;
  if (c.family === "evm" && !/^0x[0-9a-fA-F]{64}$/.test(hash)) return undefined;
  if (c.family === "solana" && !/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(hash))
    return undefined;
  if (c.family === "stellar" && !/^[0-9a-f]{64}$/.test(hash)) return undefined;
  return `${c.explorer}/tx/${hash}${c.family === "solana" && c.testnet ? "?cluster=devnet" : ""}`;
}
