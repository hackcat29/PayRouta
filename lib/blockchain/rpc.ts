import { providerRequest } from "../providers/adapters/http";
import { PortalError } from "../portal/domain";

// Blockchain RPC provider abstraction. Multiple providers are planned; the
// initial provider (Alchemy) is one implementation behind this interface.

export interface TransactionReceipt {
  txHash: string;
  blockNumber: number;
  status: "success" | "reverted";
  confirmations: number;
}

export interface BlockchainRpcProvider {
  id: string;
  getBlockNumber(chainId: string): Promise<number>;
  getTransactionReceipt(
    chainId: string,
    txHash: string,
  ): Promise<TransactionReceipt | null>;
}

export type RpcHttp = (
  url: string,
  options: { method: "POST"; path: string; body: string; timeoutMs?: number },
) => Promise<{ status: number; headers: Record<string, string>; body: string }>;

function hexToNumber(hex: string): number {
  if (!/^0x[0-9a-fA-F]+$/.test(hex))
    throw new PortalError("INVALID_RPC_RESPONSE", 502);
  return Number.parseInt(hex, 16);
}

export class JsonRpcHttpProvider implements BlockchainRpcProvider {
  private seq = 0;
  constructor(
    readonly id: string,
    private resolveUrl: (chainId: string) => string,
    private http: RpcHttp = providerRequest as unknown as RpcHttp,
  ) {}
  private async call(chainId: string, method: string, params: unknown[]) {
    const id = ++this.seq;
    const url = this.resolveUrl(chainId);
    const response = await this.http(url, {
      method: "POST",
      path: "",
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      timeoutMs: 8000,
    });
    if (response.status < 200 || response.status >= 300)
      throw new PortalError("RPC_UNAVAILABLE", 502);
    let parsed: { id?: number; result?: unknown; error?: unknown };
    try {
      parsed = JSON.parse(response.body || "{}");
    } catch {
      throw new PortalError("INVALID_RPC_RESPONSE", 502);
    }
    if (parsed.error || parsed.id !== id || parsed.result === undefined)
      throw new PortalError("RPC_ERROR", 502);
    return parsed.result;
  }
  async getBlockNumber(chainId: string) {
    return hexToNumber((await this.call(chainId, "eth_blockNumber", [])) as string);
  }
  async getTransactionReceipt(chainId: string, txHash: string) {
    const receipt = (await this.call(chainId, "eth_getTransactionReceipt", [
      txHash,
    ])) as {
      blockNumber?: string;
      status?: string;
      transactionHash?: string;
    } | null;
    if (!receipt || !receipt.blockNumber) return null;
    const blockNumber = hexToNumber(receipt.blockNumber);
    const latest = await this.getBlockNumber(chainId);
    return {
      txHash: receipt.transactionHash ?? txHash,
      blockNumber,
      status: receipt.status === "0x1" ? ("success" as const) : ("reverted" as const),
      confirmations: Math.max(0, latest - blockNumber + 1),
    };
  }
}

// Failover: try providers in order, returning the first healthy response.
export class RpcFailoverProvider implements BlockchainRpcProvider {
  readonly id: string;
  constructor(private providers: BlockchainRpcProvider[]) {
    this.id = providers.map((p) => p.id).join("|");
  }
  private async first<T>(fn: (p: BlockchainRpcProvider) => Promise<T>): Promise<T> {
    let last: unknown;
    for (const provider of this.providers) {
      try {
        return await fn(provider);
      } catch (error) {
        last = error;
      }
    }
    throw last instanceof Error ? last : new PortalError("RPC_ALL_UNAVAILABLE", 502);
  }
  getBlockNumber(chainId: string) {
    return this.first((p) => p.getBlockNumber(chainId));
  }
  getTransactionReceipt(chainId: string, txHash: string) {
    return this.first((p) => p.getTransactionReceipt(chainId, txHash));
  }
}
