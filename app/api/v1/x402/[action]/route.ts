// PayRouta as an x402 facilitator on NEAR (docs/x402.md). A merchant's x402
// server (any x402 v2 resource server, e.g. @x402/core's HTTPFacilitatorClient)
// sends payments here to verify and settle; PayRouta's relayer pays the gas.
//
//   GET  /api/v1/x402/supported     what this key can settle
//   POST /api/v1/x402/verify        { x402Version, paymentPayload, paymentRequirements }
//   POST /api/v1/x402/settle        the same; submits the payment on NEAR
//   GET  /api/v1/x402/settlements   this business's recent x402 settlements
//
// A merchant API key authenticates every call (Authorization: Bearer pr_…,
// PayRouta-Environment). Test-mode keys settle on NEAR testnet, live keys on
// mainnet.
import { z } from "zod";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { authenticate } from "@/lib/merchant/access";
import { rawBody, respond } from "@/lib/payments/http";
import { rateLimit } from "@/lib/portal/access";
import { db } from "@/lib/portal/db";
import { PortalError } from "@/lib/portal/domain";
import { nearExplorer, networkFor, settle, supported, verify, type NearNetwork } from "@/lib/x402/near";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requirements = z
  .object({
    scheme: z.string().max(40),
    network: z.string().max(60),
    asset: z.string().min(2).max(64),
    amount: z.string().regex(/^\d{1,39}$/),
    payTo: z.string().min(2).max(64),
    maxTimeoutSeconds: z.number().int().positive().max(3600),
    extra: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();
const request = z.object({
  x402Version: z.literal(2),
  paymentPayload: z
    .object({
      x402Version: z.literal(2),
      accepted: requirements,
      payload: z.record(z.string(), z.unknown()),
      resource: z.object({ url: z.string().max(2048) }).passthrough().optional(),
    })
    .passthrough(),
  paymentRequirements: requirements,
});

async function parse(r: Request, network: NearNetwork) {
  const input = request.parse(JSON.parse((await rawBody(r, 65536)) || "{}"));
  if (input.paymentRequirements.network !== network) throw new PortalError("X402_NETWORK_NOT_FOR_THIS_KEY", 403);
  return {
    payload: input.paymentPayload as unknown as PaymentPayload,
    requirements: { extra: {}, ...input.paymentRequirements } as PaymentRequirements,
  };
}

export async function GET(r: Request, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  return respond(async () => {
    const key = await authenticate(r, "payments:read");
    const network = networkFor(key.environment);
    if (action === "supported") return supported([network]);
    if (action === "settlements") {
      const rows = await db.x402Settlement.findMany({
        where: { orgId: key.orgId, environment: key.environment },
        orderBy: { createdAt: "desc" },
        take: 100,
      });
      return {
        data: rows.map((s) => ({
          id: s.id,
          createdAt: s.createdAt.toISOString(),
          source: s.source,
          network: s.network,
          asset: s.asset,
          amount: s.amount,
          payTo: s.payTo,
          payer: s.payer,
          resource: s.resource,
          success: s.success,
          transaction: s.transaction,
          explorer: s.transaction ? nearExplorer(s.network as NearNetwork, s.transaction) : null,
          errorReason: s.errorReason,
        })),
      };
    }
    throw new PortalError("NOT_FOUND", 404);
  });
}

export async function POST(r: Request, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  return respond(async () => {
    if (action !== "verify" && action !== "settle") throw new PortalError("NOT_FOUND", 404);
    const key = await authenticate(r, "payments:write");
    await rateLimit(`x402:${action}:${key.orgId}`, 60);
    const network = networkFor(key.environment);
    const { payload, requirements } = await parse(r, network);
    if (action === "verify") return verify(payload, requirements);
    const result = await settle(payload, requirements);
    await db.x402Settlement.create({
      data: {
        orgId: key.orgId,
        environment: key.environment,
        source: "facilitator",
        network,
        asset: requirements.asset,
        amount: requirements.amount,
        payTo: requirements.payTo,
        payer: result.payer ?? null,
        resource: payload.resource?.url?.slice(0, 2048) ?? null,
        success: result.success,
        transaction: result.transaction || null,
        errorReason: result.errorReason ?? null,
      },
    });
    return result;
  });
}
