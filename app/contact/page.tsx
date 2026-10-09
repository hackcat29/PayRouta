import { ContactForm } from "@/components/contact-form";
import { webhookDestination } from "@/lib/enquiries/delivery";
import { trustedOrigin } from "@/lib/site-config";
import { Suspense } from "react";
import { Kicker, Photo } from "@/components/marketing/ui";
import { LineBundle } from "@/components/marketing/route-map";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Contact",
  description:
    "Talk to PayRouta about opening provider accounts and routing payments, pricing, or a provider partnership.",
  alternates: trustedOrigin() ? { canonical: "/contact" } : undefined,
};
export default function Contact() {
  const configured = !!webhookDestination(process.env.CONTACT_WEBHOOK_URL);
  const email = process.env.CONTACT_EMAIL;
  const verifiedEmail =
    email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : undefined;
  return (
    <div className="mk">
      <section className="mk-page-hero">
        <div className="mk-wrap">
          <div className="mk-page-hero-grid solo">
            <div>
              <Kicker line="bank">Contact</Kicker>
              <h1 className="mk-h1">
                Let&apos;s route <em>your payments.</em>
              </h1>
              <p className="mk-lead">
                Tell us where you sell and how your customers want to pay.
                We&apos;ll suggest which providers to open accounts with.
              </p>
            </div>
          </div>
          <LineBundle className="mk-strip" />
        </div>
      </section>
      <section className="mk-section tight">
        <div className="mk-wrap mk-contact">
          <div className="mk-card mk-contact-form">
            <Suspense fallback={<div className="contact-form" />}>
              <ContactForm configured={configured} />
            </Suspense>
          </div>
          <aside className="mk-contact-side">
            <Photo src="city-night" alt="A city at night seen from above" sizes="(max-width: 860px) 100vw, 40vw" />
            <div className="mk-card">
              <dl>
                <div>
                  <dt>Merchants</dt>
                  <dd>Methods, markets, volume and settlement needs.</dd>
                </div>
                <div>
                  <dt>Payment providers</dt>
                  <dd>The capabilities, countries and currencies you operate.</dd>
                </div>
                <div>
                  <dt>Everyone else</dt>
                  <dd>Partnerships, press and careers — we read every message.</dd>
                </div>
                {verifiedEmail && (
                  <div>
                    <dt>Email</dt>
                    <dd>
                      {verifiedEmail}{" "}
                      <a className="mk-link" style={{ marginTop: 0 }} href={`mailto:${verifiedEmail}`}>
                        Write to us
                      </a>
                    </dd>
                  </div>
                )}
              </dl>
            </div>
            <p className="mk-body" style={{ fontSize: 13 }}>
              Never send account credentials or customer financial data through
              this form.
            </p>
          </aside>
        </div>
      </section>
    </div>
  );
}
