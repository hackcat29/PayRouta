# Crypto wallet payments

Customers pay directly from their Web3 wallets. Merchants receive the selected coin in their own wallet on the selected network. Exchange-app payments remain Coming soon. There is no custody, automatic swap, sweeping or conversion to USDC.

## Supported original deployments

The reviewed catalog has **152 mainnet coin/network pairs**: 20 each on Ethereum, Base, Arbitrum, Polygon, Avalanche, Solana and Arc, and 12 on Stellar. Stablecoins are a separate catalog. These are curated native projects and canonical deployments, not an automatically changing top-20 market index. Wrapped, bridged, lending-receipt, staked-coin and tokenized-security representations are excluded.

ETH is native on Ethereum, Base and Arbitrum. SOL is native on Solana; ETH is not offered there. PEPE is offered only on its original Ethereum contract. A symbol never authorizes a different deployment. Stellar has fewer verified qualifying coins; we do not fill its shortfall with wrapped assets.

| Network | Crypto coins |
| --- | --- |
| Ethereum | ETH, LINK, UNI, QNT, SHIB, ENA, AAVE, ONDO, SKY, PEPE, CRV, LDO, GRT, ENS, JASMY, COMP, SAND, EIGEN, MANA, CVX |
| Base | ETH, VVV, AERO, KAITO, BRETT, TOSHI, AVNT, DEGEN, B3, EDGE, ZORA, AIXBT, DRB, FAI, SAPIEN, REI, CLANKER, RECALL, TRUST, KEYCAT |
| Arbitrum | ETH, RAIN, ARB, GMX, MAGIC, XAI, PEAR, HDN, AARK, AIDOGE, GRAIL, TANGO, FCTR, JONES, RDNT, RAM, BOUNTY, AUTONOMI, FXNW, ARW |
| Polygon | POL, APEPE, RNT, AIPF, FELY, NAKA, GNS, HAVA, QUICK, SWCH, TPT, PAPARAZZI, UBU, UDAO, VOXEL, ADDY, FYN, DINO, IBS, DVO |
| Avalanche | AVAX, QI, JOE, XAVA, COQ, PNG, PHAR, BLACK, KET, HEFE, ORNG, GLADIUS, FLD, NOCHILL, YAK, JUC, SUZ, KIMBO, WOLF, HUSKY |
| Solana | SOL, JUP, RAY, PYTH, PENGU, TRUMP, GRASS, BONK, JTO, MET, WIF, KMNO, ORCA, FARTCOIN, HNT, BOME, PNUT, POPCAT, MEW, DRIFT |
| Arc | ARGUS, FAZE, ARCLIGHT, KAIRO, OBRAIN, ARCANUS, DUKE, UBI, ARCT, AKARII, CRA, CORTEX, ARCUS, ARCASH, SOLON, WAVE, FOCI, ARCLOAK, MEMESPAD, ARCBAT |
| Stellar | XLM, SHX, VELO, AQUA, AFR, SSLX, BLND, FRED, LSP, PYBC, SCOP, SIX |

Contract addresses, case-sensitive Solana mints, Stellar asset codes/issuers, exact decimals, CoinGecko IDs and source references are pinned in the reviewed deployment registry. Stale-priced tokens are excluded from the reviewed catalog. Every listed token passed a read-only deployed-contract/decimal check, classic SPL mint-program check or Stellar issued-asset lookup on 7 October 2026. Original-platform metadata was checked for multichain entries. Polygon QUICK uses the issuer’s [native token redenomination](https://blog.quickswap.exchange/posts/convert-old-quick-to-new-quick); CoinGecko’s primary-platform label differs. Registration is not production merchant approval.

Solana Token-2022 assets are not enabled. PUMP was excluded because its mint does not use the supported classic SPL program. Mainnet tokens are not copied to invented testnet contracts. Sandbox offers official chain-native test ETH, AVAX, POL, SOL and XLM and the registered issuer stablecoin test deployments. A wallet checkout can offer both categories together.

## Prices, amounts and fees

Invoices are denominated in USD. Rates come from [CoinGecko Simple Price](https://docs.coingecko.com/reference/simple-price) using reviewed coin IDs, never ticker searches. Each checkout batches its selected assets in one request. Server-side decimal arithmetic rounds payment amounts upward to the smallest native unit and retains the full token precision; it does not calculate money with floating-point numbers.

The rate source must include its update timestamp. Public/demo prices must be at most five minutes old; Pro prices must be at most two minutes old. Quotes last two minutes after the price response. Missing, stale, future, malformed and rate-limited prices fail closed. No estimated substitute rate is used. For production traffic, configure an appropriate CoinGecko API plan and an encrypted `COINGECKO_API_KEY_REF`; use `COINGECKO_API_PLAN=pro` for Pro. The key remains server-side.

Live platform fees are 0.10%, capped at $1 per successful crypto payment, billed separately using the immutable USD valuation. Sandbox platform fees are zero and non-billable. Customers also pay their wallet’s network fee. Merchants receive the invoice coin amount directly.

The chosen network and coin are locked once an attempt starts. A successful transfer must match the original deployment, recipient and exact amount. Finality and canonical block or closed-ledger evidence are required. For crypto, the transfer must be included before the immutable quote deadline; later finality and settlement can complete after expiry. A late, mismatched or uncertain payment requires inspection and is never silently repriced. Refunds remain the merchant’s responsibility.

EVM checkout discovers installed wallets through [EIP-6963](https://eips.ethereum.org/EIPS/eip-6963), with a legacy provider fallback. When multiple wallets are present, the customer selects one before any account connection or transaction request. Native EVM scans paginate across unfinalized blocks using canonical hash anchors and linked parent hashes; a changed anchor resets the scan. Detection does not claim or settle funds until the exact canonical receipt is finalized. A detected on-time payment retains its pending status after the quote deadline and never invites another transfer.

## Creating a checkout

Configure fresh merchant-owned receive addresses from Crypto wallet payments in the merchant dashboard. Stellar receivers must be funded and have receivable trustlines for issued assets; native XLM needs a funded account only. Each receive address is consumed permanently for the network, preventing reuse across assets or invoices. Production still requires approved merchant/country/asset scope and evidence.

Create a USD checkout through `POST /api/v1/crypto-checkouts`, with a `payments:write` API key, `PayRouta-Environment` and an `Idempotency-Key` of 8–90 letters, digits, underscores or hyphens:

```json
{
  "reference": "order_1042",
  "payerCountry": "US",
  "usdAmount": "10.00",
  "options": [
    { "network": "eip155:84532", "identifier": "native:ETH" }
  ]
}
```

Select 1–20 coin/network options per invoice from the supported catalog and configured receive pools. Options may mix original crypto assets with registered USDC, USDT and EURC deployments. Stablecoin quotes use the observed CoinGecko prices (`usd-coin`, `tether`, `euro-coin`), never an assumed dollar peg. The merchant checkout form includes ready stablecoin pools alongside ready crypto pools. Customers can select either payment category before instructions are prepared; every option has its own immutable amount and fee valuation. Both categories remain visible, with unquoted categories labelled “Not offered for this checkout”. Paid invoices are not expanded or reopened. The server creates immutable price terms, payment amounts, fee valuations and expiry, then returns `id`, `intentId`, `expiresAt` and `checkoutPath`. Redirect the customer to that path immediately. The Node SDK exposes `createCryptoCheckout`; Python exposes `create_crypto_checkout`.

Retries use the same key and body and return the same quote. They do not refresh its price or extend expiry. A changed body with the same key returns an idempotency conflict. Once expired, create a new checkout with a new key and preserve inspection of any old attempt. Direct manually priced crypto payment intents are rejected without the server-created quote.

To switch to an external wallet browser, use **Open in an external wallet browser → Copy link for wallet browser** in the authenticated checkout. A copied address-bar URL does not include the access token after it has been exchanged for a browser-specific cookie. The handoff creates a separate limited session for the same invoice and active attempt, with the same immutable quote deadline. It never creates another payment or refreshes the rate. Keep this bearer link private. An expired checkout requires a new merchant quote; previously submitted payments remain available for status inspection. Local `127.0.0.1` previews work only on the computer running the preview; a phone requires a reachable hosted checkout.

## Verification and launch

Unit checks cover all registered coins’ exact quotes and precision, EVM wallet instructions, signed SOL/SPL and XLM operations, original mint/issuer receipts, wrong assets, replay protection and canonical deadlines. Controlled local-database checks cover five EVM native paths plus SOL and XLM through durable receipt claims, settlement, reconciliation and zero sandbox fees. Browser checks exercise checkout choice and wallet instructions. These are controlled tests; they do not mean a customer has made a real payment in every coin.

The real Base Sepolia ETH customer transfer [0x334f38b59a7af0b049a922610c68654b0a115de597cde35b12b31e1f8a226a91](https://sepolia.basescan.org/tx/0x334f38b59a7af0b049a922610c68654b0a115de597cde35b12b31e1f8a226a91) succeeded with the exact amount and recipient at 21:46:20 UTC on 7 October 2026, before its 21:46:24.157 quote deadline. The finalized canonical receipt, one durable claim, full-amount completed settlement, exact reconciliation, three balanced journal entries, zero non-billable sandbox fee and two signed loopback webhook deliveries passed verification. The temporary aged-pending warning was resolved with an audit timeline after finalized settlement; unrelated exceptions remain open. No additional payment was requested. Before production, complete genuine wallet payments for each enabled family and token behavior, an end-to-end signed webhook check, production scope review, RPC and price-feed capacity, fee billing and all applicable items in [the launch checklist](LAUNCH-CHECKLIST.md). Read-only preflights and mock receipts do not qualify a live-money route.
