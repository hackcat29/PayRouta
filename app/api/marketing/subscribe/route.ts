import { z } from "zod";
import { MarketingService } from "@/lib/email/marketing-service";
import { errorResponse, json, limitByClient, sameOrigin } from "@/lib/email/http";
import { verifyTurnstile } from "@/lib/turnstile";

const schema = z.object({
  email: z.email().max(254),
  name: z.string().trim().max(120).optional(),
  role: z.enum(["merchant", "developer", "provider"]).optional(),
  topics: z.array(z.string()).max(10).optional(),
  source: z.string().trim().max(60).optional(),
  website_url_hp: z.string().optional(),
});

// The response is identical for new, pending and existing addresses, so the
// endpoint can't be used to find out who is subscribed.
const accepted = { success: true, message: "Check your inbox and click the link to confirm." };

export async function POST(req: Request) {
  try {
    if (!sameOrigin(req)) return json({ error: "Request origin is not allowed." }, 403);
    if (!(await verifyTurnstile(req)))
      return json({ error: "We couldn't confirm you're not a bot. Reload the page and try again." }, 403);
    await limitByClient(req, "subscribe", 5);
    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return json({ error: "Enter a valid email address." }, 400);
    const { website_url_hp, ...input } = parsed.data;
    // Honeypot: bots fill the hidden field; pretend it worked.
    if (website_url_hp) return json(accepted);
    await MarketingService.subscribe({
      ...input,
      role: input.role ?? "subscriber",
      source: input.source ?? "website",
    });
    return json(accepted);
  } catch (error) {
    return errorResponse(error, "We couldn't sign you up just now. Please try again.");
  }
}
