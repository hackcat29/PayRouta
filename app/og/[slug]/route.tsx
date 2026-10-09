import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pages, type PageSlug } from "@/content/marketing";

// Per-page social cards, prerendered at build time.
export const dynamicParams = false;

const titles: Record<"home" | PageSlug, [string, string]> = {
  home: ["Every way your customers pay.", "One application."],
  "payment-flow": ["From checkout to settlement,", "without a dead end."],
  "payment-methods": ["Every way the world pays,", "behind one schema."],
  "provider-routing": ["When a provider fails,", "the payment doesn't."],
  settlement: ["Many methods in.", "One clean ledger out."],
  merchants: ["Apply once.", "Own every account."],
  providers: ["Merchants apply once.", "You onboard them directly."],
  "use-cases": ["One payment layer.", "Every kind of business."],
  developers: ["Payments that", "behave."],
  pricing: ["Pay for payments", "that succeed."],
  about: ["The world doesn't pay one way.", "Neither should you."],
};

export function generateStaticParams() {
  return Object.keys(titles).map((slug) => ({ slug }));
}

const font = (file: string) => readFile(join(process.cwd(), "assets/fonts", file));
const assets = Promise.all([
  font("archivo-condensed-black.woff"),
  font("archivo-medium.woff"),
  readFile(join(process.cwd(), "public/brand/payrouta-horizontal-color.png")),
]);

const lineColors = ["#2f5bff", "#00857a", "#e8920c", "#f0502d", "#6a4cd9"];

export async function GET(_: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [a, b] = titles[slug as keyof typeof titles];
  const kicker = slug === "home" ? "Global payment routing" : pages[slug as PageSlug].title;
  const [black, medium, logo] = await assets;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "#f4f2ec",
          color: "#0b1b22",
          fontFamily: "Archivo",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", flex: 1, padding: "64px 72px 0" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`data:image/png;base64,${logo.toString("base64")}`} width={200} height={53} alt="" />
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 56, fontSize: 24, letterSpacing: 2, textTransform: "uppercase" }}>
            <div style={{ width: 34, height: 34, borderRadius: 34, background: "#00857a" }} />
            {kicker}
          </div>
          <div style={{ fontFamily: "Archivo Black", fontSize: 92, lineHeight: 0.9, textTransform: "uppercase", marginTop: 20, display: "flex", flexDirection: "column" }}>
            <span>{a}</span>
            <span>{b}</span>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingBottom: 36 }}>
          {lineColors.map((c) => (
            <div key={c} style={{ height: 10, background: c }} />
          ))}
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      fonts: [
        { name: "Archivo Black", data: black, weight: 900, style: "normal" },
        { name: "Archivo", data: medium, weight: 500, style: "normal" },
      ],
    },
  );
}
