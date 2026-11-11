// NEAR Intents 1Click API (https://1click.chaindefuser.com, OpenAPI v0):
// cross-chain payments from any wallet. NEAR Intents is a universal
// liquidity layer for 200+ assets across 35+ blockchain networks. For a crypto checkout, PayRouta asks
// 1Click for an EXACT_OUTPUT quote that delivers the invoice amount of the
// merchant's chosen stablecoin to the merchant's receive address. The
// customer sends the quoted amount of whatever token they hold, on whatever
// chain, to a one-time deposit address. Solvers deliver; neither 1Click nor
// PayRouta takes custody, and an unfillable swap is refunded to the
// customer's own refund address on the origin chain.
//
// Destination asset IDs were read from GET /v0/tokens on 20 October 2026 and
// are re-checked against the live token list (symbol, decimals, contract)
// before every quote.
import { z } from "zod";
import { PortalError } from "../portal/domain";
import { secretManager } from "../portal/adapters";
import { providerRequest, type ProviderHttpOptions, type ProviderHttpResponse } from "../providers/adapters/http";

export const oneClickBase = "https://1click.chaindefuser.com";
type Response = Pick<ProviderHttpResponse, "status" | "headers" | "body" | "buffer">;
export type Http = (base: string, options: ProviderHttpOptions) => Promise<Response>;

// PayRouta mainnet stablecoins that 1Click can deliver: (network, identifier)
// -> 1Click assetId, with the contract it must report.
export const destinations: readonly {
  network: string;
  identifier: string;
  symbol: string;
  decimals: number;
  assetId: string;
  blockchain: string;
  contract: string;
}[] = [
  { network: "eip155:8453", identifier: "erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", symbol: "USDC", decimals: 6, blockchain: "base", contract: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", assetId: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near" },
  { network: "eip155:1", identifier: "erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", symbol: "USDC", decimals: 6, blockchain: "eth", contract: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", assetId: "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near" },
  { network: "eip155:1", identifier: "erc20:0xdac17f958d2ee523a2206206994597c13d831ec7", symbol: "USDT", decimals: 6, blockchain: "eth", contract: "0xdac17f958d2ee523a2206206994597c13d831ec7", assetId: "nep141:eth-0xdac17f958d2ee523a2206206994597c13d831ec7.omft.near" },
  { network: "eip155:42161", identifier: "erc20:0xaf88d065e77c8cc2239327c5edb3a432268e5831", symbol: "USDC", decimals: 6, blockchain: "arb", contract: "0xaf88d065e77c8cc2239327c5edb3a432268e5831", assetId: "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near" },
  { network: "eip155:137", identifier: "erc20:0x3c499c542cef5e3811e1192ce70d8cc03d5c3359", symbol: "USDC", decimals: 6, blockchain: "pol", contract: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359", assetId: "nep245:v2_1.omni.hot.tg:137_qiStmoQJDQPTebaPjgx5VBxZv6L" },
  { network: "eip155:43114", identifier: "erc20:0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e", symbol: "USDC", decimals: 6, blockchain: "avax", contract: "0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e", assetId: "nep245:v2_1.omni.hot.tg:43114_3atVJH3r5c4GqiSYmg9fECvjc47o" },
  { network: "eip155:43114", identifier: "erc20:0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7", symbol: "USDT", decimals: 6, blockchain: "avax", contract: "0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7", assetId: "nep245:v2_1.omni.hot.tg:43114_372BeH7ENZieCaabwkbWkBiTTgXp" },
  { network: "solana:mainnet", identifier: "spl:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", decimals: 6, blockchain: "sol", contract: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", assetId: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near" },
  { network: "solana:mainnet", identifier: "spl:Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", symbol: "USDT", decimals: 6, blockchain: "sol", contract: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", assetId: "nep141:sol-c800a4bd850783ccb82c2b2c7e84175443606352.omft.near" },
  { network: "stellar:pubnet", identifier: "stellar:USDC.GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN", symbol: "USDC", decimals: 7, blockchain: "stellar", contract: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN", assetId: "nep245:v2_1.omni.hot.tg:1100_111bzQBB65GxAPAVoxqmMcgYo5oS3txhqs1Uh1cgahKQUeTUq1TJu" },
];

export const destinationFor = (network: string, identifier: string) =>
  destinations.find((d) => d.network === network && d.identifier.toLowerCase() === identifier.toLowerCase());

// Chain names for the customer, by 1Click blockchain code.
export const chainNames: Record<string, string> = {
  eth: "Ethereum", base: "Base", arb: "Arbitrum", op: "Optimism", pol: "Polygon", avax: "Avalanche", bsc: "BNB Chain",
  sol: "Solana", tron: "Tron", btc: "Bitcoin", ton: "TON", near: "NEAR", sui: "Sui", aptos: "Aptos", stellar: "Stellar",
  xrp: "XRP Ledger", doge: "Dogecoin", ltc: "Litecoin", bch: "Bitcoin Cash", zec: "Zcash", cardano: "Cardano",
  gnosis: "Gnosis", bera: "Berachain", scroll: "Scroll", monad: "Monad", xlayer: "X Layer", starknet: "Starknet",
  dash: "Dash", movement: "Movement", hypercore: "Hyperliquid", hlevm: "HyperEVM", plasma: "Plasma", fogo: "Fogo",
  aleo: "Aleo", abs: "Abstract", adi: "ADI Chain", hood: "Robinhood Chain", miden: "Miden",
};

const token = z
  .object({
    assetId: z.string().min(1).max(300),
    decimals: z.number().int().min(0).max(30),
    blockchain: z.string().min(1).max(40),
    symbol: z.string().min(1).max(40),
    price: z.union([z.number(), z.string()]).optional(),
    contractAddress: z.string().max(300).optional().nullable(),
    // For its logo (token-logos.ts); "custom:…" when CoinGecko has none.
    coingeckoId: z.string().max(120).optional().nullable(),
  })
  .passthrough();
export type OneClickToken = z.infer<typeof token>;

const quoteResponse = z
  .object({
    correlationId: z.string().optional(),
    quote: z
      .object({
        depositAddress: z.string().min(10).max(200),
        depositMemo: z.string().max(200).optional().nullable(),
        amountIn: z.string().regex(/^\d+$/),
        amountInFormatted: z.string().max(80),
        amountInUsd: z.string().max(80).optional(),
        amountOut: z.string().regex(/^\d+$/),
        minAmountOut: z.string().regex(/^\d+$/).optional(),
        deadline: z.string().optional(),
        timeEstimate: z.number().nonnegative().optional(),
      })
      .passthrough(),
  })
  .passthrough();
export type OneClickQuote = z.infer<typeof quoteResponse>;

export const oneClickStatuses = ["KNOWN_DEPOSIT_TX", "PENDING_DEPOSIT", "INCOMPLETE_DEPOSIT", "PROCESSING", "SUCCESS", "REFUNDED", "FAILED"] as const;
const statusResponse = z
  .object({
    status: z.enum(oneClickStatuses),
    swapDetails: z
      .object({
        // The swap's own intents and the NEAR transactions that executed
        // them; NEAR Intents settlement checks both on-chain.
        intentHashes: z.array(z.string().max(100)).max(50).optional(),
        nearTxHashes: z.array(z.string().max(100)).max(50).optional(),
        amountOut: z.string().regex(/^\d+$/).optional(),
        amountOutFormatted: z.string().max(80).optional(),
        destinationChainTxHashes: z.array(z.object({ hash: z.string(), explorerUrl: z.string().optional() }).passthrough()).optional(),
        refundReason: z.string().nullable().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();
export type OneClickStatus = z.infer<typeof statusResponse>;

async function headers() {
  const ref = process.env.ONECLICK_API_KEY_REF;
  const key = ref ? await secretManager.get(ref) : undefined;
  return { "User-Agent": "PayRouta/0.1 (+https://payrouta.com)", ...(key ? { "X-API-Key": key } : {}) };
}

function parse<T>(schema: z.ZodType<T>, response: Response, code: string) {
  if (response.status === 429) throw new PortalError("CROSS_CHAIN_RATE_LIMITED", 503);
  if (response.status === 400) {
    // 1Click explains refusals in `message`. Minimums vary by asset, pair and
    // network and change over time, e.g. "Temporary swap limits: minimum
    // swap amount is $100" (Tron USDT to Base USDC, 20 October 2026) or
    // "Amount below minimum".
    let message = "";
    try {
      message = String((JSON.parse(response.body) as { message?: unknown }).message ?? "");
    } catch {
      message = "";
    }
    if (/minimum/i.test(message)) throw new PortalError("CROSS_CHAIN_AMOUNT_TOO_SMALL", 409);
    throw new PortalError(code, 409);
  }
  if (response.status !== 200) throw new PortalError("CROSS_CHAIN_UNAVAILABLE", 503);
  let body: unknown;
  try {
    body = JSON.parse(response.body);
  } catch {
    throw new PortalError("CROSS_CHAIN_UNAVAILABLE", 503);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new PortalError("CROSS_CHAIN_UNAVAILABLE", 503);
  return parsed.data;
}

let cached: { at: number; tokens: OneClickToken[] } | null = null;
export async function tokens(http: Http = providerRequest, now = Date.now()) {
  if (cached && now - cached.at < 600000) return cached.tokens;
  const response = await http(oneClickBase, { method: "GET", path: "/v0/tokens", headers: await headers(), timeoutMs: 8000, maxResponseBytes: 1048576 });
  const list = parse(z.array(token).max(2000), response, "CROSS_CHAIN_UNAVAILABLE");
  cached = { at: now, tokens: list };
  return list;
}
export const resetTokenCache = () => {
  cached = null;
};

// Where the swap is funded from and delivered to:
//   ORIGIN_CHAIN / DESTINATION_CHAIN  a deposit address / an address on the
//                                     destination asset's own chain
//   INTENTS                           an account inside NEAR Intents (a
//                                     merchant's settlement account)
export type OneClickEnd = "CHAIN" | "INTENTS";

export async function quote(
  input: {
    originAsset: string;
    destinationAsset: string;
    // Base units: the exact output, or with exactInput the exact input.
    amountOut: string;
    recipient: string;
    refundTo: string;
    deadline: Date;
    from?: OneClickEnd;
    to?: OneClickEnd;
    exactInput?: boolean;
    // PayRouta's fee, taken by 1Click from the amount in and credited to
    // PayRouta's intents account.
    appFee?: { recipient: string; bps: number };
  },
  http: Http = providerRequest,
) {
  const from = input.from === "INTENTS" ? "INTENTS" : "ORIGIN_CHAIN";
  const body = {
    dry: false,
    swapType: input.exactInput ? "EXACT_INPUT" : "EXACT_OUTPUT",
    // 1% headroom on the input side; the output is exact.
    slippageTolerance: 100,
    originAsset: input.originAsset,
    depositType: from,
    destinationAsset: input.destinationAsset,
    amount: input.amountOut,
    refundTo: input.refundTo,
    refundType: from,
    recipient: input.recipient,
    recipientType: input.to === "INTENTS" ? "INTENTS" : "DESTINATION_CHAIN",
    deadline: input.deadline.toISOString(),
    referral: "payrouta",
    ...(input.appFee ? { appFees: [{ recipient: input.appFee.recipient, fee: input.appFee.bps }] } : {}),
    quoteWaitingTimeMs: 3000,
  };
  const response = await http(oneClickBase, {
    method: "POST",
    path: "/v0/quote",
    headers: await headers(),
    body: JSON.stringify(body),
    timeoutMs: 12000,
    maxResponseBytes: 262144,
  });
  return parse(quoteResponse, response, "CROSS_CHAIN_QUOTE_REFUSED");
}

export async function status(depositAddress: string, depositMemo: string | null, http: Http = providerRequest) {
  const query = new URLSearchParams({ depositAddress, ...(depositMemo ? { depositMemo } : {}) });
  const response = await http(oneClickBase, {
    method: "GET",
    path: `/v0/status?${query}`,
    headers: await headers(),
    timeoutMs: 8000,
    maxResponseBytes: 262144,
  });
  if (response.status === 404) return null;
  return parse(statusResponse, response, "CROSS_CHAIN_UNAVAILABLE");
}

// Funding a quote from an intents balance (depositType INTENTS): 1Click
// returns the transfer intent for the account's own wallet to sign, then
// submits the signed intent; the account pays no gas. PayRouta checks the
// intent before anyone signs it (payouts.ts).
const generated = z
  .object({
    intent: z.discriminatedUnion("standard", [
      z.object({ standard: z.literal("erc191"), payload: z.string().min(2).max(8000) }).strict(),
      z.object({ standard: z.literal("raw_ed25519"), payload: z.string().min(2).max(8000) }).strict(),
      z
        .object({
          standard: z.literal("nep413"),
          payload: z
            .object({
              message: z.string().min(2).max(8000),
              nonce: z.string().regex(/^[A-Za-z0-9+/]{43}=$/),
              recipient: z.string().min(1).max(64),
              callbackUrl: z.string().max(2048).nullable().optional(),
            })
            .strict(),
        })
        .strict(),
    ]),
  })
  .passthrough();
export type GeneratedIntent = z.infer<typeof generated>["intent"];

export async function generateIntent(input: { depositAddress: string; signerId: string; standard: "erc191" | "nep413" | "raw_ed25519" }, http: Http = providerRequest) {
  const response = await http(oneClickBase, {
    method: "POST",
    path: "/v0/generate-intent",
    headers: await headers(),
    body: JSON.stringify({ type: "swap_transfer", ...input }),
    timeoutMs: 12000,
    maxResponseBytes: 65536,
  });
  return parse(generated, response, "INTENTS_INTENT_REFUSED").intent;
}

export async function submitIntent(signedData: unknown, http: Http = providerRequest) {
  const response = await http(oneClickBase, {
    method: "POST",
    path: "/v0/submit-intent",
    headers: await headers(),
    body: JSON.stringify({ type: "swap_transfer", signedData }),
    timeoutMs: 15000,
    maxResponseBytes: 65536,
  });
  return parse(z.object({ intentHash: z.string().min(1).max(100) }).passthrough(), response, "INTENTS_SIGNATURE_REJECTED");
}
