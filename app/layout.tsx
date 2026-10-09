import type { Metadata } from "next";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "./globals.css";
import "./marketing.css";
import { Archivo, JetBrains_Mono } from "next/font/google";
import { SiteChrome } from "@/components/site-chrome";
import { trustedOrigin } from "@/lib/site-config";
const origin = trustedOrigin();
const archivo = Archivo({
  subsets: ["latin"],
  axes: ["wdth"],
  variable: "--font-archivo",
});
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jb-mono" });
export const metadata: Metadata = {
  metadataBase: origin ? new URL(origin) : undefined,
  title: {
    default: "PayRouta — Every way your customers pay, one application",
    template: "%s · PayRouta",
  },
  description:
    "Apply once to PayRouta and accept cards, bank transfers, mobile money and stablecoins through regulated processing partners, with same-method failover and payouts on your schedule. Stablecoins go straight to your wallet.",
  robots: { index: !!origin, follow: !!origin },
  icons: { icon: "/brand/favicon.svg" },
  ...(origin
    ? {
        openGraph: {
          siteName: "PayRouta",
          type: "website",
          images: ["/social.png"],
        },
        twitter: { card: "summary_large_image", images: ["/social.png"] },
      }
    : {}),
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${archivo.variable} ${mono.variable}`}
    >
      <body>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <SiteChrome>{children}</SiteChrome>
      </body>
    </html>
  );
}
