import { MarketingService } from "@/lib/email/marketing-service";

// RFC 8058 one-click unsubscribe. Mail clients POST
// "List-Unsubscribe=One-Click" to the URL in the List-Unsubscribe header.
export async function POST(req: Request) {
  const token = new URL(req.url).searchParams.get("token");
  if (!token) return new Response("Missing token", { status: 400 });
  try {
    await MarketingService.updateSubscriberPreferences(token, { unsubscribeAll: true });
  } catch {
    // Unknown tokens get the same answer, so the endpoint reveals nothing.
  }
  return new Response("Unsubscribed", { status: 200, headers: { "Cache-Control": "no-store" } });
}

// A GET (someone opening the header URL, or a link scanner) must not
// unsubscribe anyone. Send people to the preference page to confirm instead.
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  return new Response(null, {
    status: 303,
    headers: { Location: `/email/preferences?token=${encodeURIComponent(token)}&action=unsub` },
  });
}
