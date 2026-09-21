import { Checkout } from "./view";
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
  return <Checkout id={sessionId} />;
}
