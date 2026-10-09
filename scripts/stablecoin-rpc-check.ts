import "dotenv/config";
import { readFile } from "node:fs/promises";
import { providerRequest } from "../lib/providers/adapters/http";
import { localMode } from "../lib/portal/adapters";
import { db } from "../lib/portal/db";
async function rpc(method: string, params: unknown[]) {
  const r = await providerRequest("https://sepolia.base.org", {
    method: "POST",
    path: "/",
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const b = JSON.parse(r.body);
  if (r.status !== 200 || b.error)
    throw new Error(
      `Base Sepolia RPC unavailable (HTTP ${r.status}${b.error?.message ? `: ${String(b.error.message).slice(0, 200)}` : ""})`,
    );
  return b.result;
}
async function main() {
  if (!localMode()) throw new Error("Local testnet diagnostics only");
  const fixture = JSON.parse(
    await readFile(".local/portal/stablecoin-testnet.json", "utf8"),
  );
  const binding = await db.depositBinding.findUniqueOrThrow({
    where: { attemptId: fixture.attemptId },
  });
  const latest = await rpc("eth_blockNumber", []),
    finalized = await rpc("eth_getBlockByNumber", ["finalized", false]);
  const logs: { transactionHash: string; blockNumber: string; data: string }[] =
    [];
  for (let from = binding.startBlock; from <= BigInt(latest); from += 500n) {
    const to = from + 499n < BigInt(latest) ? from + 499n : BigInt(latest);
    logs.push(
      ...(await rpc("eth_getLogs", [
        {
          address: binding.identifier.slice(6),
          fromBlock: `0x${from.toString(16)}`,
          toBlock: `0x${to.toString(16)}`,
          topics: [
            "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
            null,
            `0x${binding.address.slice(2).padStart(64, "0")}`,
          ],
        },
      ])),
    );
  }
  console.log(
    JSON.stringify(
      {
        chainId: await rpc("eth_chainId", []),
        finalizedBlock: finalized.number,
        latestBlock: latest,
        transfers: logs.map((l) => ({
          transaction: l.transactionHash,
          block: l.blockNumber,
          amountMinor: BigInt(l.data).toString(),
          finalized: BigInt(l.blockNumber) <= BigInt(finalized.number),
        })),
      },
      null,
      2,
    ),
  );
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
