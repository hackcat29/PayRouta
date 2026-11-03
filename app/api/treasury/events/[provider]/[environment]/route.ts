import { z } from "zod";
import { respond, rawBody } from "@/lib/payments/http";
import { receivePlatformEvent } from "@/lib/treasury/events";

// Events for PayRouta's platform accounts (Paystack,
// Flutterwave, dLocal, Tink). Verified with the provider's own scheme,
// deduplicated, then processed asynchronously as a prompt to re-read state.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ provider: string; environment: string }> },
) {
  return respond(async () => {
    const p = await params;
    const provider = z.string().regex(/^[a-z][a-z0-9-]{1,40}$/).parse(p.provider);
    const environment = z.enum(["sandbox", "production"]).parse(p.environment);
    const raw = await rawBody(request, 262144);
    return receivePlatformEvent(provider, environment, raw, request.headers);
  });
}
