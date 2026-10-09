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
  confirm,
  customerAction,
  refreshAttempt,
} from "@/lib/payments/service";
import { respond, rawBody } from "@/lib/payments/http";
import { NextRequest, NextResponse } from "next/server";
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
    .object({ action: z.literal("select"), method: z.string().max(40) })
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
    if (b.action === "select") return selectMethod(id, token, b.method);
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
