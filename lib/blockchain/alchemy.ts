import { PortalError } from "../portal/domain";
import { JsonRpcHttpProvider, RpcHttp, type BlockchainRpcProvider } from "./rpc";
import { providerRequest } from "../providers/adapters/http";

export interface AlchemyConfig {
  apiKey?: string;
  http?: RpcHttp;
}

export function alchemyNetworkUrl(chainId: string, apiKey: string): string {
  const mapping: Record<string, string> = {
    "eip155:8453": `https://base-mainnet.g.alchemy.com/v2/${apiKey}`,
    "eip155:84532": `https://base-sepolia.g.alchemy.com/v2/${apiKey}`,
    "eip155:1": `https://eth-mainnet.g.alchemy.com/v2/${apiKey}`,
    "eip155:11155111": `https://eth-sepolia.g.alchemy.com/v2/${apiKey}`,
  };

  const url = mapping[chainId];
  if (!url) {
    throw new PortalError(`ALCHEMY_UNSUPPORTED_CHAIN:${chainId}`, 400);
  }
  return url;
}

export class AlchemyRpcProvider extends JsonRpcHttpProvider implements BlockchainRpcProvider {
  constructor(config: AlchemyConfig) {
    if (!config.apiKey) {
      throw new PortalError("ALCHEMY_API_KEY_NOT_CONFIGURED", 503);
    }
    const key = config.apiKey;
    super(
      "alchemy",
      (chainId: string) => alchemyNetworkUrl(chainId, key),
      config.http ?? (providerRequest as unknown as RpcHttp),
    );
  }
}
