import { CheckoutRouter } from "./router";
export const metadata = {
  title: "Secure checkout | PayRouta",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default async function Page({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  return <CheckoutRouter id={sessionId} />;
}
