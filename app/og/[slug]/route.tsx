import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pages, type PageSlug } from "@/content/marketing";

// Per-page social cards, prerendered at build time.
export const dynamicParams = false;

const titles: Record<"home" | PageSlug, [string, string]> = {
  home: ["Let every customer", "pay the way they can."],
  pricing: ["1%, max $5,", "plus the partner fee."],
  partners: ["Process payments for", "PayRouta merchants."],
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


export async function GET(_: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [a, b] = titles[slug as keyof typeof titles];
  const kicker = slug === "home" ? "PayRouta" : pages[slug as PageSlug].title;
  const [black, medium, logo] = await assets;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "#ffffff",
          color: "#0b1b22",
          fontFamily: "Archivo",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", flex: 1, padding: "64px 72px 0" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`data:image/png;base64,${logo.toString("base64")}`} width={200} height={53} alt="" />
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 56, fontSize: 26, color: "#00756b" }}>
                        {kicker}
          </div>
          <div style={{ fontFamily: "Archivo Black", fontSize: 84, lineHeight: 1, marginTop: 20, display: "flex", flexDirection: "column" }}>
            <span>{a}</span>
            <span>{b}</span>
          </div>
        </div>
        <div style={{ display: "flex", height: 14, background: "#00756b" }} />
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
