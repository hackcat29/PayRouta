import "dotenv/config";
import { writeFile } from "node:fs/promises";
import { cryptoAssets } from "../lib/blockchain/crypto-assets";
import { chain } from "../lib/blockchain/chains";
import {
  parseCoinGeckoPrice,
  cryptoPaymentTerms,
} from "../lib/payments/crypto-prices";
import { providerRequest } from "../lib/providers/adapters/http";
async function main() {
  const assets = cryptoAssets.filter((a) => !chain(a.network)?.testnet),
    ids = [...new Set(assets.map((a) => a.coinGeckoId))],
    now = new Date();
  const response = await providerRequest("https://api.coingecko.com", {
    method: "GET",
    path: `/api/v3/simple/price?ids=${ids.join(",")}&vs_currencies=usd&include_last_updated_at=true&precision=full`,
    headers: { "User-Agent": "PayRouta/0.1 (+https://payrouta.com)" },
    timeoutMs: 8000,
    maxResponseBytes: 65536,
  });
  if (response.status !== 200)
    throw new Error("CoinGecko HTTP " + response.status);
  const results = assets.map((a) => {
    try {
      const price = parseCoinGeckoPrice(response.body, a.coinGeckoId, now);
      const quote = cryptoPaymentTerms(
        a,
        "1.00",
        price,
        "production",
        new Date(now.getTime() + 120000),
      );
      return {
        network: a.network,
        coin: a.symbol,
        id: a.coinGeckoId,
        ok: true,
        price,
        amount: quote.amount,
      };
    } catch (error) {
      return {
        network: a.network,
        coin: a.symbol,
        id: a.coinGeckoId,
        ok: false,
        error: (error as Error).message,
      };
    }
  });
  await writeFile(
    process.argv[2] ?? "/private/tmp/payrouta-crypto-live-prices.json",
    JSON.stringify(
      { checkedAt: now.toISOString(), source: "live-read-only", results },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({
      total: results.length,
      priced: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok),
    }),
  );
  if (results.some((r) => !r.ok)) process.exitCode = 1;
}
main().catch((error) => {
  console.error((error as Error).message);
  process.exitCode = 1;
});
