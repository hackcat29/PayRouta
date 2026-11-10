// A merchant's logo (lib/merchant/branding.ts), public: checkouts, payment
// links and invoices show it. The key changes with every upload, so the
// response can be cached for good.
import { logoByKey } from "@/lib/merchant/branding";

export async function GET(_request: Request, { params }: { params: Promise<{ key: string }> }) {
  const logo = await logoByKey((await params).key);
  if (!logo) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(logo.bytes), {
    headers: {
      "Content-Type": logo.mime,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Content-Disposition": "inline",
    },
  });
}
