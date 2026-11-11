// Token and chain logos for the crypto checkout (lib/intents/token-logos.ts),
// served from PayRouta. Logos don't change, so a browser keeps one for a
// year. A logo that isn't stored yet answers 404 for a short while, and the
// checkout shows the token's generated mark.
import { logo, logoKey } from "@/lib/intents/token-logos";

export async function GET(_request: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  const key = `${kind}:${id}`;
  if (!logoKey.test(key)) return new Response("Not found", { status: 404 });
  const found = await logo(key);
  if (!found) return new Response("Not found", { status: 404, headers: { "Cache-Control": "public, max-age=1800" } });
  return new Response(new Uint8Array(found.bytes), {
    headers: {
      "Content-Type": found.mime,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
