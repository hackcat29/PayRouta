import { chain } from "./chains";
import { PortalError } from "../portal/domain";
import {
  JsonRpcHttpProvider,
  RpcHttp,
  type BlockchainRpcProvider,
} from "./rpc";
import { providerRequest } from "../providers/adapters/http";

export interface AlchemyConfig {
  apiKey?: string;
  http?: RpcHttp;
}

export function alchemyNetworkUrl(chainId: string, apiKey: string): string {
  const network = chain(chainId);
  if (!network)
    throw new PortalError(`ALCHEMY_UNSUPPORTED_CHAIN:${chainId}`, 400);
  const url = `https://${network.alchemyName}.g.alchemy.com/v2/${apiKey}`;
  return url;
}

export class AlchemyRpcProvider
  extends JsonRpcHttpProvider
  implements BlockchainRpcProvider
{
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
