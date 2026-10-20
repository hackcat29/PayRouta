// refund_session_url. Shopify requires 201 with an empty body once the
// refund session is accepted; its outcome is reported later by GraphQL.
import { NextRequest } from "next/server";
import { startRefundSession } from "@/lib/integrations/shopify";
import { rawBody, respond } from "@/lib/payments/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(r: NextRequest) {
  const result = await respond(async () => {
    await startRefundSession(r.headers, JSON.parse(await rawBody(r, 65536)));
    return {};
  });
  return result.status === 200 ? new Response(null, { status: 201 }) : result;
}
