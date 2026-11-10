import { notFound } from "next/navigation";
import { publicPaymentLink } from "@/lib/merchant/payment-links";
import { MerchantContact, MerchantMark } from "@/components/merchant-mark";
import { VerifiedTick } from "@/components/verified-tick";
import "../../pay.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Payment submitted", robots: { index: false, follow: false } };

export default async function Done({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const link = await publicPaymentLink(slug);
  if (!link) notFound();
  return (
    <main className="pl">
      <div className="pl-card">
        <div className="pl-check" aria-hidden="true">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="m5 12.5 4.5 4.5L19 7.5" />
          </svg>
        </div>
        <p className="pl-merchant">
          <MerchantMark className="pl-avatar" name={link.merchant} logo={link.logo} />
          {link.merchant}
          {link.verified && <VerifiedTick />}
        </p>
        <h1 className="pl-title">Payment sent to {link.merchant}</h1>
        <MerchantContact className="pl-contact" name={link.merchant} website={link.website} supportEmail={link.supportEmail} />
        <p className="pl-foot">
          Secured by <strong>PayRouta</strong>
        </p>
      </div>
    </main>
  );
}
