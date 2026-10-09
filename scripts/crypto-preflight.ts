import "dotenv/config";
import { cryptoAssets } from "../lib/blockchain/crypto-assets";
import { coinGeckoPrices } from "../lib/payments/crypto-prices";
import { alchemyReader } from "../lib/blockchain/alchemy-rpc";
import { providerRequest } from "../lib/providers/adapters/http";
import { secretManager } from "../lib/portal/adapters";
import { chain } from "../lib/blockchain/chains";
import { canonicalStellarLedger } from "../lib/providers/adapters/native/stellar-deposit";
async function main() {
  const selected = cryptoAssets.filter(
    (a) =>
      (!a.contractAddress &&
        ["eip155:8453", "eip155:43114", "eip155:137"].includes(a.network)) ||
      a.symbol === "PEPE",
  );
  const prices = await coinGeckoPrices(selected);
  console.log(
    JSON.stringify({ check: "CoinGecko", source: "live-read-only", prices }),
  );
  const networks = [...new Set(cryptoAssets.map((a) => a.network))];
  let failed = false;
  for (const network of networks) {
    try {
      const rpc = alchemyReader(
        { network, publicRpc: true },
        { http: providerRequest, credentials: secretManager },
      );
      const family = chain(network)!.family;
      if (family === "solana") {
        if ((await rpc("getGenesisHash", [])) !== chain(network)!.genesisHash)
          throw new Error("CHAIN_MISMATCH");
        const slot = await rpc("getSlot", [{ commitment: "finalized" }]);
        const block = (await rpc("getBlock", [
          slot,
          {
            commitment: "finalized",
            transactionDetails: "signatures",
            rewards: false,
            maxSupportedTransactionVersion: 0,
          },
        ])) as { blockhash?: string };
        if (!block?.blockhash) throw new Error("BLOCK_EVIDENCE_UNAVAILABLE");
        console.log(
          JSON.stringify({ check: "RPC canonical blocks", network, ok: true }),
        );
        continue;
      }
      if (family === "stellar") {
        const health = (await rpc("getHealth", {})) as {
          status: string;
          latestLedger: number;
        };
        if (health.status !== "healthy") throw new Error("RPC_NOT_HEALTHY");
        await canonicalStellarLedger(
          rpc,
          { http: providerRequest, credentials: secretManager },
          network,
          health.latestLedger,
        );
        console.log(
          JSON.stringify({ check: "RPC canonical blocks", network, ok: true }),
        );
        continue;
      }
      const id = await rpc("eth_chainId", []);
      if (BigInt(String(id)) !== BigInt(network.split(":")[1]))
        throw new Error("CHAIN_MISMATCH");
      const latest = await rpc("eth_getBlockByNumber", ["latest", true]);
      const finalized = await rpc("eth_getBlockByNumber", ["finalized", false]);
      if (
        !(latest as { transactions?: unknown[] }).transactions ||
        !(finalized as { hash?: string }).hash
      )
        throw new Error("BLOCK_EVIDENCE_UNAVAILABLE");
      if (network === "eip155:1") {
        const pepe = cryptoAssets.find((a) => a.symbol === "PEPE")!;
        const decimals = await rpc("eth_call", [
          { to: pepe.contractAddress, data: "0x313ce567" },
          "latest",
        ]);
        if (BigInt(String(decimals)) !== 18n)
          throw new Error("PEPE_DECIMALS_MISMATCH");
        const code = await rpc("eth_getCode", [pepe.contractAddress, "latest"]);
        if (typeof code !== "string" || code.length <= 2)
          throw new Error("PEPE_CONTRACT_MISSING");
      }
      console.log(
        JSON.stringify({ check: "RPC canonical blocks", network, ok: true }),
      );
    } catch (error) {
      failed = true;
      console.log(
        JSON.stringify({
          check: "RPC canonical blocks",
          network,
          ok: false,
          error: (error as Error).message,
        }),
      );
    }
  }
  if (failed) process.exitCode = 1;
}
main().catch((error) => {
  console.error((error as Error).message);
  process.exitCode = 1;
});
