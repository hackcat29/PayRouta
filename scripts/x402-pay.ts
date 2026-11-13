// Pay an x402 URL from a NEAR account, e.g. a live PayRouta payment link
// over x402 (docs/x402.md):
//
//   X402_PAYER=you.near npm run -s x402:pay -- https://payrouta.com/api/agent/v1/x402/links/<slug> --max 5
//
// The key is read from ~/.near-credentials/<mainnet|testnet>/<account>.json.
// Pays only USDC on NEAR (or, with --asset, that NEP-141 token) and nothing
// over --max (in the token's units); the payer needs no NEAR for gas.
import "dotenv/config";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { x402Client } from "@x402/core/client";
import { decodePaymentResponseHeader } from "@x402/core/http";
import { createClientNearSigner } from "@x402/near";
import { ExactNearScheme } from "@x402/near/exact/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { usdcOnNear } from "../lib/x402/near";

const [url, ...args] = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

async function main() {
  const payer = process.env.X402_PAYER;
  const max = flag("max");
  if (!url || !payer || !max) throw new Error("Usage: X402_PAYER=<account> npm run -s x402:pay -- <url> --max <amount> [--asset <token>] [--testnet]");
  const network = args.includes("--testnet") ? "near:testnet" : "near:mainnet";
  const asset = flag("asset") ?? (network === "near:mainnet" ? usdcOnNear["near:mainnet"] : "payrouta-test-usd.testnet");
  const decimals = Number(flag("decimals") ?? 6);
  const key = (JSON.parse(readFileSync(`${homedir()}/.near-credentials/${network.slice(5)}/${payer}.json`, "utf8")) as { private_key: `ed25519:${string}` }).private_key;
  const client = x402Client.fromConfig({
    schemes: [{ network, client: new ExactNearScheme(createClientNearSigner({ accountId: payer, secretKey: key })) }],
    spendControls: { allowedAssets: [{ network, asset, maxAmountPerPayment: String(Math.round(Number(max) * 10 ** decimals)) }] },
  });
  const r = await wrapFetchWithPayment(fetch, client)(url);
  const header = r.headers.get("payment-response");
  if (header) {
    const s = decodePaymentResponseHeader(header);
    console.log(`Settlement: ${s.success ? "success" : s.errorReason}, transaction ${s.transaction}`);
  }
  console.log(`${r.status}: ${JSON.stringify(await r.json(), null, 2)}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
