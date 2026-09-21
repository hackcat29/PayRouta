import type { Metadata } from "next";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "./globals.css";
import { SiteChrome } from "@/components/site-chrome";
import { trustedOrigin } from "@/lib/site-config";
const origin = trustedOrigin();
export const metadata: Metadata = {
  metadataBase: origin ? new URL(origin) : undefined,
  title: {
    default: "PayRouta — Universal Payment Routing",
    template: "%s | PayRouta",
  },
  description:
    "One integration. Every way your customers pay. Explore the payment availability and routing network in development.",
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
    <html lang="en">
      <body>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <SiteChrome>{children}</SiteChrome>
      </body>
    </html>
  );
}
