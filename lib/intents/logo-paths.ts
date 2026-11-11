// Where checkout loads a token's or chain's logo from (served by
// app/api/logos, stored by token-logos.ts). No server imports, so dex.ts
// and checkout.ts can use it without a cycle.
//   coin:<id>             a token NEAR Intents lists, by its CoinGecko id
//   chain:<code>          a chain, by its 1Click code
//   token:<chain>-<addr>  a token found by its contract address (dex.ts)
const evm = /^0x[0-9a-fA-F]{40}$/;
const base58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export const logoKey = /^(coin:[a-z0-9-]{1,100}|chain:[a-z0-9]{2,20}|token:[a-z0-9]{2,20}-(0x[0-9a-f]{40}|[1-9A-HJ-NP-Za-km-z]{32,44}))$/;
export const coinLogo = (id: string | null | undefined) => (id && /^[a-z0-9-]{1,100}$/.test(id) ? `/api/logos/coin/${id}` : undefined);
export const chainLogo = (code: string) => (/^[a-z0-9]{2,20}$/.test(code) ? `/api/logos/chain/${code}` : undefined);
// EVM addresses are case-insensitive, so they're keyed in lower case;
// Solana mints are case-sensitive and kept as they are.
export function tokenLogo(chain: string, address: string) {
  if (!/^[a-z0-9]{2,20}$/.test(chain)) return undefined;
  if (evm.test(address)) return `/api/logos/token/${chain}-${address.toLowerCase()}`;
  return base58.test(address) ? `/api/logos/token/${chain}-${address}` : undefined;
}
