// Store one secret in the vault and print its reference, for the *_REF
// variables (ONECLICK_API_KEY_REF, COINGECKO_API_KEY_REF, ...). The value is
// read from standard input so it never lands in shell history:
//   npm run -s secrets:put < key.txt
//   pbpaste | npm run -s secrets:put
// Run it where the app runs: it uses the same store as the app (the local
// file vault in local mode, the encrypted database store otherwise).
import "dotenv/config";
import { db } from "../lib/portal/db";
import { secretManager } from "../lib/portal/adapters";

async function main() {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const value = Buffer.concat(chunks).toString("utf8").trim();
  if (!value) throw new Error("Pipe the secret on standard input, e.g. pbpaste | npm run -s secrets:put");
  console.log(await secretManager.put(value));
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
