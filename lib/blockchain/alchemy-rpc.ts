import { alchemyNetworkUrl } from "./alchemy";
import { chain } from "./chains";
import { PortalError } from "../portal/domain";
import {
  object,
  secret,
  type NativeDeps,
} from "../providers/adapters/native/common";
export type Rpc = ((
  method: string,
  params?: unknown[] | Record<string, unknown>,
) => Promise<unknown>) & { source?: () => "alchemy" | "public" };
// Only fixed, reviewed URLs from the chain registry are permitted. Never use a customer URL.
export function alchemyReader(
  config: {
    network: string;
    rpcKeyRef?: string;
    timeoutMs?: number;
    publicRpc?: boolean;
    allowPublicFallback?: boolean;
    rpcMode?: "auto" | "public" | "alchemy";
  },
  deps: NativeDeps,
): Rpc {
  const network = chain(config.network);
  if (!network) throw new PortalError("RPC_CHAIN_NOT_SUPPORTED", 409);
  let id = 0,
    publicMode =
      config.publicRpc === true ||
      (config.rpcMode ?? process.env.PAYMENT_RPC_MODE) === "public" ||
      (!config.rpcKeyRef && !process.env.ALCHEMY_RPC_KEY_REF),
    publicVerified = false;
  const fallback =
    config.allowPublicFallback ??
    (config.rpcMode ?? process.env.PAYMENT_RPC_MODE) !== "alchemy";
  async function request(
    publicEndpoint: boolean,
    method: string,
    params: unknown[] | Record<string, unknown>,
  ) {
    let endpoint = network!.publicRpc;
    if (!publicEndpoint) {
      const ref = config.rpcKeyRef ?? process.env.ALCHEMY_RPC_KEY_REF;
      if (!ref) throw new PortalError("RPC_CREDENTIAL_REQUIRED", 409);
      const key = await secret(deps, ref);
      if (!/^[A-Za-z0-9_-]{1,200}$/.test(key))
        throw new PortalError("RPC_CREDENTIAL_INVALID", 409);
      endpoint = alchemyNetworkUrl(config.network, key);
    }
    const url = new URL(endpoint),
      n = ++id;
    let response;
    try {
      response = await deps.http(url.origin, {
        method: "POST",
        path: url.pathname,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: n, method, params }),
        maxResponseBytes: 2097152,
        timeoutMs: config.timeoutMs ?? 8000,
      });
    } catch {
      throw new PortalError("RPC_TRANSPORT_UNAVAILABLE", 503);
    }
    if (response.status !== 200)
      throw new PortalError(`RPC_UNAVAILABLE_HTTP_${response.status}`, 503);
    let body: Record<string, unknown>;
    try {
      body = object(JSON.parse(response.body));
    } catch {
      throw new PortalError("INVALID_RPC_RESPONSE", 502);
    }
    if (
      body.id !== n ||
      body.jsonrpc !== "2.0" ||
      !("result" in body) ||
      body.error
    )
      throw new PortalError("INVALID_RPC_RESPONSE", 502);
    return body.result;
  }
  async function verifyPublic() {
    if (publicVerified) return;
    let valid = false;
    if (network!.family === "evm") {
      const id = await request(true, "eth_chainId", []);
      valid =
        typeof id === "string" &&
        /^0x[0-9a-f]+$/i.test(id) &&
        BigInt(id) === BigInt(config.network.split(":")[1]);
    } else if (network!.family === "solana")
      valid =
        (await request(true, "getGenesisHash", [])) === network!.genesisHash;
    else
      valid =
        object(await request(true, "getNetwork", {})).passphrase ===
        network!.passphrase;
    if (!valid) throw new PortalError("RPC_CHAIN_MISMATCH", 502);
    publicVerified = true;
  }
  const rpc: Rpc = async (method, params = []) => {
    if (publicMode) {
      await verifyPublic();
      return request(true, method, params);
    }
    try {
      return await request(false, method, params);
    } catch (error) {
      // Broadcast failures are ambiguous. A later durable relay may retry ONLY the same signed bytes.
      if (
        !fallback ||
        method === "sendTransaction" ||
        method === "eth_sendRawTransaction" ||
        !(error instanceof PortalError) ||
        !error.message.startsWith("RPC_") ||
        error.message.includes("CHAIN_MISMATCH") ||
        error.message.includes("CREDENTIAL_INVALID")
      )
        throw error;
      await verifyPublic();
      publicMode = true;
      return request(true, method, params);
    }
  };
  rpc.source = () => (publicMode ? "public" : "alchemy");
  return rpc;
}
