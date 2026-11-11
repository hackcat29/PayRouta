// Fetches every token and chain logo the crypto checkout lists that isn't
// stored yet (lib/intents/token-logos.ts). The worker does this slowly on
// its own; this does it now: `npm run logos:warm`.
import "dotenv/config";
import { warmLogos } from "../lib/intents/token-logos";

async function main() {
  let total = 0;
  for (;;) {
    const r = await warmLogos(20);
    total += r.found;
    console.log(`checked ${r.checked}, found ${r.found}, ${r.remaining} left`);
    if (!r.remaining) break;
    // Rate limited: wait a minute and go on.
    if (!r.checked) await new Promise((done) => setTimeout(done, 60000));
  }
  console.log(`${total} logos stored`);
}
main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
