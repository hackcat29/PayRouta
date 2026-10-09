import "dotenv/config";
import { chain, supportedChains } from "../lib/blockchain/chains";
import { tokenAssets } from "../lib/blockchain/assets";
import { alchemyReader } from "../lib/blockchain/alchemy-rpc";
import { providerRequest } from "../lib/providers/adapters/http";
import { secretManager, localMode } from "../lib/portal/adapters";
import { Keypair, xdr } from "@stellar/stellar-sdk";
import {
  stellarClosedLedger,
  canonicalStellarLedger,
} from "../lib/providers/adapters/native/stellar-deposit";
import { db } from "../lib/portal/db";
async function main() {
  if (!localMode())
    throw new Error("Local read-only network verification only");
  const results = [];
  const index = process.argv.indexOf("--network");
  const filter = index >= 0 ? process.argv[index + 1] : null;
  if (index >= 0 && (!filter || !chain(filter)))
    throw new Error("Unsupported network filter");
  for (const c of supportedChains.filter((c) => !filter || c.id === filter)) {
    const rpc = alchemyReader(
      { network: c.id },
      { http: providerRequest, credentials: secretManager },
    );
    try {
      let identity: unknown;
      if (c.family === "evm") {
        const actual = await rpc("eth_chainId", []);
        if (BigInt(String(actual)) !== BigInt(c.id.split(":")[1]))
          throw new Error("CHAIN_MISMATCH");
        const final = (await rpc("eth_getBlockByNumber", [
          "finalized",
          false,
        ])) as { number?: string };
        if (!final?.number) throw new Error("FINALITY_UNAVAILABLE");
        const tokens = [];
        for (const token of tokenAssets.filter((a) => a.network === c.id)) {
          const decimals = await rpc("eth_call", [
            { to: token.contractAddress, data: "0x313ce567" },
            "finalized",
          ]);
          if (BigInt(String(decimals)) !== BigInt(token.decimals))
            throw new Error(`TOKEN_DECIMALS_MISMATCH:${token.symbol}`);
          tokens.push({
            symbol: token.symbol,
            identifier: token.identifier,
            decimals: token.decimals,
          });
        }
        identity = {
          chainId: String(actual),
          finalizedBlock: final.number,
          tokens,
        };
      } else if (c.family === "solana") {
        const genesis = await rpc("getGenesisHash", []);
        if (genesis !== c.genesisHash) throw new Error("CHAIN_MISMATCH");
        const tokens = [];
        for (const token of tokenAssets.filter((a) => a.network === c.id)) {
          const account = (await rpc("getAccountInfo", [
            token.contractAddress,
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
          if (
            account.value?.owner !==
              "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" ||
            account.value?.data?.parsed?.type !== "mint" ||
            account.value.data.parsed.info?.decimals !== token.decimals ||
            !account.value.data.parsed.info.isInitialized
          )
            throw new Error(`TOKEN_MINT_MISMATCH:${token.symbol}`);
          tokens.push({
            symbol: token.symbol,
            identifier: token.identifier,
            decimals: token.decimals,
          });
        }
        identity = { genesis, tokens };
      } else {
        const network = (await rpc("getNetwork", {})) as {
          passphrase?: string;
        };
        if (network.passphrase !== c.passphrase)
          throw new Error("CHAIN_MISMATCH");
        const latest = { sequence: await stellarClosedLedger(rpc) };
        const tokens = [];
        for (const token of tokenAssets.filter((a) => a.network === c.id)) {
          const key = xdr.LedgerKey.account(
            new xdr.LedgerKeyAccount({
              accountId: Keypair.fromPublicKey(
                token.contractAddress,
              ).xdrPublicKey(),
            }),
          ).toXDR("base64");
          const entries = (await rpc("getLedgerEntries", { keys: [key] })) as {
            entries: { key: string; xdr: string }[];
          };
          if (entries.entries.length !== 1 || entries.entries[0].key !== key)
            throw new Error(`TOKEN_ISSUER_UNAVAILABLE:${token.symbol}`);
          const data = xdr.LedgerEntryData.fromXDR(
            entries.entries[0].xdr,
            "base64",
          );
          if (
            data.type !== "account" ||
            !Buffer.from(data.account.accountId.ed25519.toBytes()).equals(
              Buffer.from(
                Keypair.fromPublicKey(token.contractAddress).rawPublicKey(),
              ),
            )
          )
            throw new Error(`TOKEN_ISSUER_MISMATCH:${token.symbol}`);
          tokens.push({
            symbol: token.symbol,
            identifier: token.identifier,
            decimals: token.decimals,
          });
        }
        await canonicalStellarLedger(
          rpc,
          { http: providerRequest, credentials: secretManager },
          c.id,
          latest.sequence - 1,
        );
        identity = {
          sequence: latest.sequence,

          tokens,
          canonicalHeaderVerified: true,
        };
      }
      results.push({
        network: c.id,
        name: chain(c.id)?.name,
        status: "PASS",
        source: rpc.source?.(),
        identity,
      });
    } catch (error) {
      results.push({
        network: c.id,
        name: c.name,
        status: "FAIL",
        reason: (error as Error).message.split("/v2/")[0],
      });
    }
    console.log(JSON.stringify(results.at(-1)));
  }
  const { writeFile } = await import("node:fs/promises");
  await writeFile(
    filter
      ? `.local/portal/multichain-preflight-${filter.replace(":", "-")}.json`
      : ".local/portal/multichain-preflight.json",
    JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2),
    { mode: 0o600 },
  );
  if (results.some((r) => r.status === "FAIL")) process.exitCode = 1;
}
main()
  .catch(() => {
    console.error(
      "Network verification failed; inspect configured RPC permissions.",
    );
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
