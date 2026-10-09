import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import { alchemyReader } from "../lib/blockchain/alchemy-rpc";
import { chain } from "../lib/blockchain/chains";
import { providerRequest } from "../lib/providers/adapters/http";
import { secretManager } from "../lib/portal/adapters";
import { TOKEN_PROGRAM_ID } from "../lib/blockchain/solana-token";
import type { CryptoAsset } from "../lib/blockchain/crypto-assets";
type Candidate = CryptoAsset & {
  platform: string;
  name: string;
  deploymentSource: string;
  tokenListSource: string;
  reviewedAt: string;
};
async function main() {
  const candidates: Candidate[] = JSON.parse(
    await readFile(
      process.argv[2] ?? "lib/blockchain/crypto-catalog.json",
      "utf8",
    ),
  );
  const results: { asset: Candidate; ok: boolean; error?: string }[] = [];
  for (const network of [...new Set(candidates.map((a) => a.network))]) {
    const rpc = alchemyReader(
      { network, publicRpc: true },
      { http: providerRequest, credentials: secretManager },
    );
    const selected = candidates.filter((a) => a.network === network);
    for (let offset = 0; offset < selected.length; offset += 3) {
      await Promise.all(
        selected.slice(offset, offset + 3).map(async (asset) => {
          try {
            if (chain(network)?.family === "evm") {
              const code = await rpc("eth_getCode", [
                asset.contractAddress,
                "latest",
              ]);
              const decimals = await rpc("eth_call", [
                { to: asset.contractAddress, data: "0x313ce567" },
                "latest",
              ]);
              if (
                typeof code !== "string" ||
                code.length <= 2 ||
                BigInt(String(decimals)) !== BigInt(asset.decimals)
              )
                throw new Error("CONTRACT_OR_DECIMALS_MISMATCH");
            } else if (chain(network)?.family === "solana") {
              const response = (await rpc("getAccountInfo", [
                asset.contractAddress,
                { encoding: "jsonParsed", commitment: "finalized" },
              ])) as {
                value?: {
                  owner?: string;
                  data?: {
                    parsed?: {
                      type?: string;
                      info?: { decimals?: number; isInitialized?: boolean };
                    };
                  };
                };
              };
              const value = response.value;
              if (
                value?.owner !== TOKEN_PROGRAM_ID.toBase58() ||
                value.data?.parsed?.type !== "mint" ||
                value.data.parsed.info?.decimals !== asset.decimals ||
                !value.data.parsed.info.isInitialized
              )
                throw new Error("UNSUPPORTED_MINT_OR_DECIMALS");
            } else {
              await rpc("getNetwork", {});
              const response = await providerRequest(
                "https://horizon.stellar.org",
                {
                  method: "GET",
                  path: `/assets?asset_code=${encodeURIComponent(asset.symbol)}&asset_issuer=${asset.contractAddress}`,
                  timeoutMs: 8000,
                  maxResponseBytes: 65536,
                },
              );
              const body = JSON.parse(response.body) as {
                _embedded?: {
                  records?: { asset_code: string; asset_issuer: string }[];
                };
              };
              if (
                response.status !== 200 ||
                !body._embedded?.records?.some(
                  (a) =>
                    a.asset_code === asset.symbol &&
                    a.asset_issuer === asset.contractAddress,
                )
              )
                throw new Error("ISSUED_ASSET_NOT_FOUND");
            }
            results.push({ asset, ok: true });
          } catch (error) {
            results.push({ asset, ok: false, error: (error as Error).message });
          }
        }),
      );
    }
    const checked = results.filter((r) => r.asset.network === network);
    console.log(
      JSON.stringify({
        network,
        verified: checked.filter((r) => r.ok).length,
        total: checked.length,
        failed: checked
          .filter((r) => !r.ok)
          .map((r) => ({ coin: r.asset.symbol, error: r.error })),
      }),
    );
  }
  await writeFile(
    process.argv[3] ?? "/private/tmp/payrouta-crypto-catalog-verification.json",
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        source: "live-read-only",
        results,
      },
      null,
      2,
    ) + "\n",
  );
}
main().catch((error) => {
  console.error((error as Error).message);
  process.exitCode = 1;
});
