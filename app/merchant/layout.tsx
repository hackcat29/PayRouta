import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "Merchant workspace | PayRouta",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default function MerchantLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
