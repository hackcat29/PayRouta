import { MerchantContact, MerchantMark } from "@/components/merchant-mark";
import { VerifiedTick } from "@/components/verified-tick";
import { notFound } from "next/navigation";
import { publicPaymentLink } from "@/lib/merchant/payment-links";
import { currencyExponent } from "@/lib/partners/money";
import "../pay.css";

export const dynamic = "force-dynamic";

function formatMoney(amount: string, currency: string) {
  const exp = currencyExponent(currency) ?? 2;
  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency,
      minimumFractionDigits: Number(amount) % 1 ? exp : 0,
      maximumFractionDigits: exp,
    }).format(Number(amount));
  } catch {
    return `${amount} ${currency}`;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const link = await publicPaymentLink((await params).slug);
  return {
    title: link ? `${link.title} · ${link.merchant}` : "Payment link",
    description: link ? `Pay ${link.merchant} ${formatMoney(link.amount, link.currency)}.` : undefined,
    robots: { index: false, follow: false },
    // AI agents: the link's terms as JSON (402 Payment Required).
    ...(link ? { alternates: { types: { "application/json": `/api/agent/v1/links/${link.slug}` } } } : {}),
    // "same-origin": no referrer to other sites, but the Pay form still
    // sends its Origin (with "no-referrer" browsers send Origin: null).
    referrer: "same-origin" as const,
  };
}

export default async function PaymentLinkPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { slug } = await params;
  const link = await publicPaymentLink(slug);
  if (!link) notFound();
  const failed = (await searchParams).error === "1";
  return (
    <main className="pl">
      {link.environment === "sandbox" && <div className="pl-test">Test mode · no real money moves</div>}
      <form className="pl-card" method="post" action={`/api/pay/${link.slug}`}>
        <p className="pl-merchant">
          <MerchantMark className="pl-avatar" name={link.merchant} logo={link.logo} />
          {link.merchant}
          {link.verified && <VerifiedTick />}
        </p>
        <h1 className="pl-title">{link.title}</h1>
        {link.description && <p className="pl-desc">{link.description}</p>}
        <p className="pl-amount">{formatMoney(link.amount, link.currency)}</p>
        {failed && (
          <p className="pl-error" role="alert">
            We couldn&apos;t open the checkout. Please try again.
          </p>
        )}
        <button className="pl-pay" type="submit">
          Pay {formatMoney(link.amount, link.currency)}
        </button>
        <MerchantContact className="pl-contact" name={link.merchant} website={link.website} supportEmail={link.supportEmail} />
        <p className="pl-foot">
          Secured by <strong>PayRouta</strong>
        </p>
      </form>
    </main>
  );
}
