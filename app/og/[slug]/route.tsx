import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pages, type PageSlug } from "@/content/marketing";

// Per-page social cards, prerendered at build time.
export const dynamicParams = false;

const titles: Record<"home" | PageSlug, [string, string]> = {
  home: ["One checkout for every", "way the world pays."],
  "payment-links": ["No website?", "Share a payment link."],
  checkout: ["One button.", "Every way to pay."],
  integrations: ["Take payments", "wherever you sell."],
  "payment-methods": ["The ways the world pays,", "in one checkout."],
  credit: ["Customers pay over time.", "You're paid today."],
  crypto: ["Any wallet, any chain.", "Paid in your stablecoin."],
  agents: ["AI agents pay you.", "Your assistant runs payments."],
  subscriptions: ["Bill every month.", "Paid from any wallet."],
  "social-sellers": ["Sell in the chat.", "Get paid in the chat."],
  "online-stores": ["Every way to pay at", "your store's checkout."],
  saas: ["Sell worldwide.", "Let customers pay their way."],
  pricing: ["1%, max $5,", "plus the partner fee."],
  partners: ["Process payments for", "PayRouta merchants."],
};

export function generateStaticParams() {
  return Object.keys(titles).map((slug) => ({ slug }));
}

const font = (file: string) => readFile(join(process.cwd(), "assets/fonts", file));
const assets = Promise.all([
  font("space-grotesk-bold.woff"),
  font("space-grotesk-medium.woff"),
  readFile(join(process.cwd(), "public/brand/payrouta-horizontal-reverse.png")),
]);

export async function GET(_: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [a, b] = titles[slug as keyof typeof titles];
  const kicker = slug === "home" ? "Payment links · Checkout · Credit · Crypto" : pages[slug as PageSlug].title;
  const [bold, medium, logo] = await assets;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "#1E2466",
          color: "#ffffff",
          fontFamily: "Space Grotesk",
          padding: "64px 72px",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`data:image/png;base64,${logo.toString("base64")}`} width={230} height={59} alt="" />
        <div style={{ display: "flex", marginTop: "auto", fontSize: 28, color: "#F26B1D", fontWeight: 500 }}>{kicker}</div>
        <div style={{ fontSize: 80, fontWeight: 700, lineHeight: 1.02, letterSpacing: -2, marginTop: 18, display: "flex", flexDirection: "column" }}>
          <span>{a}</span>
          <span>{b}</span>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      fonts: [
        { name: "Space Grotesk", data: bold, weight: 700, style: "normal" },
        { name: "Space Grotesk", data: medium, weight: 500, style: "normal" },
      ],
    },
  );
}
