// Live NEAR Intents prices for the demo checkout (lib/intents/demo.ts).
// Dry quotes only: nothing here can move money.
import { NextRequest } from "next/server";
import { z } from "zod";
import { csrf, rateLimit } from "@/lib/portal/access";
import { respond, rawBody } from "@/lib/payments/http";
import { demoCatalog, demoDexQuote, demoLookup, demoQuote } from "@/lib/intents/demo";

const client = (r: NextRequest) => r.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";

export async function GET(r: NextRequest) {
  return respond(async () => {
    await rateLimit(`intents-demo:${client(r)}`, 60);
    return demoCatalog();
  });
}

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("quote"), input: z.unknown() }).strict(),
  z.object({ action: z.literal("lookup"), address: z.string().max(64) }).strict(),
  z.object({ action: z.literal("dex-quote"), input: z.unknown() }).strict(),
]);

export async function POST(r: NextRequest) {
  return respond(async () => {
    csrf(r);
    await rateLimit(`intents-demo:${client(r)}`, 60);
    // 1Click and the DEX APIs are shared; cap the demo as a whole too.
    await rateLimit("intents-demo:all", 600);
    const b = schema.parse(JSON.parse(await rawBody(r)));
    if (b.action === "lookup") return demoLookup(b.address);
    if (b.action === "dex-quote") return demoDexQuote(b.input);
    return demoQuote(b.input);
  });
}
