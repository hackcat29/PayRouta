import {
  prepareWalletTransaction,
  submitWalletTransaction,
} from "@/lib/blockchain/wallet-submissions";
import { z } from "zod";
import { csrf, rateLimit } from "@/lib/portal/access";
import {
  authorizeSession,
  handoffSession,
  choosePaymentOption,
  progress,
  methods,
  selectMethod,
  creditOffers,
  switchTo,
  confirm,
  customerAction,
  refreshAttempt,
} from "@/lib/payments/service";
import { respond, rawBody } from "@/lib/payments/http";
import {
  crossChainOptions,
  crossChainQuote,
  crossChainStatus,
  payOptions,
} from "@/lib/intents/checkout";
import { swapSolanaTransaction } from "@/lib/intents/swap-wallet";
import { dexEvmQuote, dexSolanaTransaction, lookupToken } from "@/lib/intents/dex";
import { NextRequest, NextResponse } from "next/server";
import { demoAction, demoCookie, demoId, demoProgress, readDemoState, writeDemoState } from "@/lib/payments/demo-checkout";

// The demo checkout (/checkout/demo): its own actions, each visitor's state
// in a cookie, rate limited per visitor rather than per checkout.
const demoBody = z
  .object({
    action: z.string().min(1).max(40),
    to: z.enum(["fiat", "crypto"]).optional(),
    address: z.string().min(32).max(64).optional(),
    method: z.string().max(40).optional(),
    creditOffer: z.string().max(120).optional(),
    originAsset: z.string().min(1).max(300).optional(),
  })
  .passthrough();
const visitor = (r: NextRequest) => r.headers.get("x-real-ip") || r.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
function withDemoState(response: Response, state: string) {
  const result = new NextResponse(response.body, { status: response.status, headers: response.headers });
  result.cookies.set(demoCookie, state, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: `/api/checkout/${demoId}`,
    maxAge: 3600,
  });
  return result;
}
// The demo's state is written back only when a request changed it: a status
// poll that started before "Continue" answered would otherwise overwrite the
// quote it set, and "Simulate the payment" would find no transfer awaited.
// Whether the browser's cookie already holds this demo (not a fresh one
// started because there was none, or it expired).
function sameDemo(raw: string | undefined, state: { startedAt: number }) {
  try {
    return !!raw && (JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as { startedAt?: unknown }).startedAt === state.startedAt;
  } catch {
    return false;
  }
}
async function demoGet(r: NextRequest) {
  const raw = r.cookies.get(demoCookie)?.value;
  const state = readDemoState(raw);
  const response = await respond(async () => {
    await rateLimit(`checkout-demo:${visitor(r)}`, 240);
    return demoProgress(state);
  });
  return sameDemo(raw, state) ? response : withDemoState(response, writeDemoState(state));
}
async function demoPost(r: NextRequest) {
  let next: string | undefined;
  const response = await respond(async () => {
    csrf(r);
    await rateLimit(`checkout-demo:${visitor(r)}`, 240);
    const b = demoBody.parse(JSON.parse(await rawBody(r)));
    const raw = r.cookies.get(demoCookie)?.value;
    const before = readDemoState(raw);
    const result = await demoAction(before, b);
    next = writeDemoState(result.state);
    if (sameDemo(raw, before) && next === writeDemoState(before)) next = undefined;
    return result.body;
  });
  return next ? withDemoState(response, next) : response;
}
const schema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("prepare-wallet"),
      payer: z.string().min(32).max(100),
    })
    .strict(),
  z
    .object({
      action: z.literal("submit-wallet"),
      submissionId: z.string().max(100),
      signed: z.string().max(30000),
    })
    .strict(),
  z
    .object({
      action: z.literal("choose-network"),
      optionId: z.string().max(100),
    })
    .strict(),
  z
    .object({
      action: z.literal("exchange"),
      token: z.string().min(40).max(60),
    })
    .strict(),
  z.object({ action: z.literal("methods") }).strict(),
  z.object({ action: z.literal("wallet-link") }).strict(),
  z
    .object({
      action: z.literal("select"),
      method: z.string().max(40),
      creditOffer: z.string().max(120).optional(),
    })
    .strict(),
  z.object({ action: z.literal("credit-offers") }).strict(),
  z
    .object({ action: z.literal("switch"), to: z.enum(["fiat", "crypto"]) })
    .strict(),
  z.object({ action: z.literal("cross-chain-options") }).strict(),
  z.object({ action: z.literal("pay-options") }).strict(),
  z
    .object({
      action: z.literal("cross-chain-quote"),
      originAsset: z.string().min(1).max(300),
      refundTo: z.string().min(1).max(140),
    })
    .strict(),
  z.object({ action: z.literal("cross-chain-status") }).strict(),
  z
    .object({
      action: z.literal("token-lookup"),
      address: z.string().min(32).max(64),
    })
    .strict(),
  z
    .object({
      action: z.literal("dex-solana"),
      payer: z.string().min(32).max(50),
      mint: z.string().min(32).max(50),
    })
    .strict(),
  z
    .object({
      action: z.literal("dex-evm"),
      payer: z.string().length(42),
      chain: z.string().max(10),
      address: z.string().length(42),
    })
    .strict(),
  z
    .object({
      action: z.literal("swap-wallet-transaction"),
      payer: z.string().min(32).max(50),
    })
    .strict(),
  z
    .object({ action: z.literal("confirm"), routeId: z.string().max(100) })
    .strict(),
  z.object({ action: z.literal("complete") }).strict(),
  z.object({ action: z.literal("refresh") }).strict(),
]);
export async function GET(
  r: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (id === demoId) return demoGet(r);
  const response = await respond(async () => {
    await rateLimit(`checkout:${id}`, 120);
    return progress(id, r.cookies.get(`checkout_${id}`)?.value || "");
  });
  // Preserve access to a pending outcome after the payment window closes.
  // Creation/selection/confirmation still use the original expiry boundary.
  const credential = r.cookies.get(`checkout_${id}`)?.value;
  if (response.status === 200 && credential) {
    const result = new NextResponse(response.body, {
      status: response.status,
      headers: response.headers,
    });
    result.cookies.set(`checkout_${id}`, credential, {
      httpOnly: true,
      sameSite: "strict",
      secure: new URL(r.url).protocol === "https:",
      path: `/api/checkout/${id}`,
      maxAge: 86400,
    });
    return result;
  }
  return response;
}
export async function POST(
  r: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (id === demoId) return demoPost(r);
  let credential: string | undefined;
  const response = await respond(async () => {
    csrf(r);
    await rateLimit(`checkout:${id}`, 120);
    const b = schema.parse(JSON.parse(await rawBody(r)));
    if (b.action === "exchange") {
      await authorizeSession(id, b.token, new Date(), true);
      credential = b.token;
      return { ok: true };
    }
    const token = r.cookies.get(`checkout_${id}`)?.value || "";
    if (b.action === "wallet-link") return handoffSession(id, token);
    if (b.action === "prepare-wallet")
      return prepareWalletTransaction(id, token, b.payer);
    if (b.action === "submit-wallet")
      return submitWalletTransaction(id, token, b.submissionId, b.signed);
    if (b.action === "choose-network")
      return choosePaymentOption(id, token, b.optionId);
    if (b.action === "methods") return methods(id, token);
    if (b.action === "select")
      return selectMethod(id, token, b.method, new Date(), b.creditOffer);
    if (b.action === "credit-offers") return creditOffers(id, token);
    if (b.action === "switch") return switchTo(id, token, b.to);
    if (b.action === "cross-chain-options") return crossChainOptions(id, token);
    if (b.action === "pay-options") return payOptions(id, token);
    if (b.action === "cross-chain-quote")
      return crossChainQuote(id, token, { originAsset: b.originAsset, refundTo: b.refundTo });
    if (b.action === "cross-chain-status") return crossChainStatus(id, token);
    if (b.action === "token-lookup") return lookupToken(id, token, b.address);
    if (b.action === "dex-solana")
      return dexSolanaTransaction(id, token, { payer: b.payer, mint: b.mint });
    if (b.action === "dex-evm")
      return dexEvmQuote(id, token, { payer: b.payer, chain: b.chain, address: b.address });
    if (b.action === "swap-wallet-transaction")
      return swapSolanaTransaction(id, token, b.payer);
    if (b.action === "confirm") return confirm(id, token, b.routeId);
    if (b.action === "refresh") return refreshAttempt(id, token);
    await customerAction(id, token);
    return { ok: true };
  });
  if (credential) {
    const result = new NextResponse(response.body, {
      status: response.status,
      headers: response.headers,
    });
    result.cookies.set(`checkout_${id}`, credential, {
      httpOnly: true,
      sameSite: "strict",
      secure: new URL(r.url).protocol === "https:",
      path: `/api/checkout/${id}`,
      maxAge: 86400,
    });
    return result;
  }
  return response;
}
