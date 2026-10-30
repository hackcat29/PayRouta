import { ContactForm } from "@/components/contact-form";
import { webhookDestination } from "@/lib/enquiries/delivery";
import { paths, trustedOrigin } from "@/lib/site-config";
import { Suspense } from "react";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Contact",
  description:
    "Talk to PayRouta about taking payments, pricing for your business, or connecting your payment service.",
  alternates: trustedOrigin() ? { canonical: "/contact" } : undefined,
};
export default async function Contact({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Providers have their own reviewed request form.
  if ((await searchParams).intent === "provider") redirect(`${paths.partners}#request`);
  const configured = !!webhookDestination(process.env.CONTACT_WEBHOOK_URL);
  const email = process.env.CONTACT_EMAIL;
  const verifiedEmail =
    email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : undefined;
  return (
    <div className="mk">
      <div className="mk-article mk-article-wide">
        <header className="mk-article-head">
          <h1 className="mk-h1">Contact</h1>
        </header>
        <div className="mk-contact">
          <div className="mk-contact-form">
            <Suspense fallback={<div className="contact-form" />}>
              <ContactForm configured={configured} />
            </Suspense>
          </div>
          <aside className="mk-box">
            <h2 className="mk-box-title">Include</h2>
            <dl className="mk-contact-notes">
              <dt>Businesses</dt>
              <dd>Where you sell, how customers pay, rough monthly volume.</dd>
              <dt>Payment providers</dt>
              <dd>
                Use the <a href={`${paths.partners}#request`}>provider access request</a> instead.
              </dd>
              {verifiedEmail && (
                <>
                  <dt>Email</dt>
                  <dd>
                    <a href={`mailto:${verifiedEmail}`}>{verifiedEmail}</a>
                  </dd>
                </>
              )}
            </dl>
            <p className="mk-box-note">Never send passwords, API keys or card details here.</p>
          </aside>
        </div>
      </div>
    </div>
  );
}
