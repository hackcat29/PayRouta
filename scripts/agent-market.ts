// NEAR AI Agent Market from the terminal (lib/agents/agent-market.ts,
// docs/agent-market.md).
//
//   npm run -s agent-market -- search "market research"
//   npm run -s agent-market -- quote <handle> "<task>"        what it costs; pays nothing
//   npm run -s agent-market -- hire <handle> "<task>" --max 2.5
//   npm run -s agent-market -- work [--once]                    run PayRouta's listed agent
//
// hire pays from your own NEAR account (AGENT_MARKET_PAYER, key at
// ~/.near-credentials/mainnet/<account>.json) in USDC on NEAR, and refuses a
// price over --max. work needs the agent's API token (AGENT_MARKET_TOKEN_REF
// in the secret store, or AGENT_MARKET_TOKEN), from the agent's Edit page on
// market.near.ai.
import "dotenv/config";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { createClientNearSigner } from "@x402/near";
import { acceptable, hire, quote, searchAgents, work } from "../lib/agents/agent-market";
import { secretManager } from "../lib/portal/adapters";

const [command, ...args] = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

async function token() {
  if (process.env.AGENT_MARKET_TOKEN_REF) return (await secretManager.get(process.env.AGENT_MARKET_TOKEN_REF)).trim();
  if (process.env.AGENT_MARKET_TOKEN) return process.env.AGENT_MARKET_TOKEN.trim();
  throw new Error("Set AGENT_MARKET_TOKEN_REF (secret store) or AGENT_MARKET_TOKEN to the agent's aat_ token");
}

async function main() {
  if (command === "search") {
    for (const a of await searchAgents(args.join(" ")))
      console.log(`${a.handle.padEnd(28)} ${a.name}\n${" ".repeat(29)}${a.description.slice(0, 110)}`);
    return;
  }
  if (command === "quote") {
    const [handle, task] = args;
    const row = (await quote(handle, task)).find((a) => a.network.startsWith("near:"));
    console.log(row ? `${handle}: ${Number(row.amount) / 1e6} USDC on ${row.network} (asset ${row.asset}, to ${row.payTo})` : `${handle} doesn't take x402 on NEAR`);
    return;
  }
  if (command === "hire") {
    const [handle, task] = args;
    const max = flag("max");
    if (!handle || !task || !max) throw new Error('Usage: hire <handle> "<task>" --max <USDC>');
    const maxAmount = BigInt(Math.round(Number(max) * 1e6));
    const payer = process.env.AGENT_MARKET_PAYER;
    if (!payer) throw new Error("Set AGENT_MARKET_PAYER to your NEAR mainnet account");
    const key = (JSON.parse(readFileSync(`${homedir()}/.near-credentials/mainnet/${payer}.json`, "utf8")) as { private_key: `ed25519:${string}` }).private_key;
    // Checked before signing; hire() checks again on the quote it pays.
    acceptable(await quote(handle, task), maxAmount);
    const result = await hire({ handle, task, maxAmount, signer: createClientNearSigner({ accountId: payer, secretKey: key }) });
    console.log(`Task ${result.taskId}: ${result.state}, paid ${result.paid}\n\n${result.result}`);
    return;
  }
  if (command === "work") {
    const t = await token();
    for (;;) {
      const done = await work(t);
      if (done.length) console.log(`${new Date().toISOString()} delivered ${done.join(", ")}`);
      if (args.includes("--once")) return;
      await new Promise((r) => setTimeout(r, 45_000));
    }
  }
  console.log('Commands: search <query> | quote <handle> "<task>" | hire <handle> "<task>" --max <USDC> | work [--once]');
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
