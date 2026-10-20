import { z } from "zod";
import { MarketingService, MARKETING_TOPICS } from "@/lib/email/marketing-service";
import { errorResponse, json, limitByClient } from "@/lib/email/http";

const view = (s: { email: string; name: string | null; status: string; topics: unknown }) => ({
  email: s.email,
  name: s.name,
  status: s.status,
  topics: s.topics,
  availableTopics: MARKETING_TOPICS,
});

export async function GET(req: Request) {
  try {
    await limitByClient(req, "email-preferences", 30);
    const token = new URL(req.url).searchParams.get("token");
    if (!token) return json({ error: "This link is missing its token." }, 400);
    const subscriber = await MarketingService.getSubscriberByToken(token);
    if (!subscriber) return json({ error: "This link isn't valid any more." }, 404);
    return json(view(subscriber));
  } catch (error) {
    return errorResponse(error, "Failed to load preferences");
  }
}

const schema = z.object({
  token: z.string().min(1).max(200),
  topics: z.array(z.string()).max(10).optional(),
  unsubscribeAll: z.boolean().optional(),
  confirm: z.boolean().optional(),
});

export async function POST(req: Request) {
  try {
    await limitByClient(req, "email-preferences", 30);
    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return json({ error: "This link is missing its token." }, 400);
    const { token, topics, unsubscribeAll, confirm } = parsed.data;

    if (confirm) {
      const confirmed = await MarketingService.confirm(token);
      if (!confirmed) return json({ error: "This link isn't valid any more." }, 404);
      return json({
        success: true,
        message:
          confirmed.status === "active"
            ? "You're subscribed. Thanks for confirming."
            : "This address can't receive our emails. Contact us if you think that's wrong.",
        subscriber: view(confirmed),
      });
    }

    const updated = await MarketingService.updateSubscriberPreferences(token, {
      topics,
      unsubscribeAll: Boolean(unsubscribeAll),
    });
    return json({
      success: true,
      message: unsubscribeAll
        ? "You're unsubscribed. You won't get any more marketing emails from us."
        : "Your email preferences are saved.",
      subscriber: view(updated),
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Invalid or expired preference link")
      return json({ error: "This link isn't valid any more." }, 404);
    return errorResponse(error, "Failed to update preferences");
  }
}
