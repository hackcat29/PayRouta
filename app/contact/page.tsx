import { ContactForm } from "@/components/contact-form";
import { webhookDestination } from "@/lib/enquiries/delivery";
import { trustedOrigin } from "@/lib/site-config";
import { Suspense } from "react";

export const metadata = {
  title: "Contact",
  description:
    "Discuss merchant access, provider participation, pricing, or general PayRouta requirements.",
  alternates: trustedOrigin() ? { canonical: "/contact" } : undefined,
};
export default function Contact() {
  const configured = !!webhookDestination(process.env.CONTACT_WEBHOOK_URL);
  const email = process.env.CONTACT_EMAIL;
  const verifiedEmail =
    email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : undefined;
  return (
    <>
      <section className="page-hero">
        <div className="container">
          <p className="early-access">Early access · In development</p>
          <h1>Let’s talk about your payment requirements.</h1>
          <p className="lead">
            Tell us what you’re building, which methods matter, and where your
            customers need to pay.
          </p>
        </div>
      </section>
      <section className="section">
        <div className="container contact-layout">
          <aside className="contact-aside">
            <h2>A useful starting point.</h2>
            <p>
              For merchant access, share your checkout needs and settlement
              preferences. For provider participation, outline the capabilities
              you operate.
            </p>
            <p>
              Scope, coverage, technical readiness, and pilot participation need
              to be confirmed together.
            </p>
            <div className="callout">
              <h3>
                {configured
                  ? "About your enquiry"
                  : "Enquiry delivery is not configured yet."}
              </h3>
              <p>
                {configured
                  ? "Your enquiry is sent to the operator-configured lead service. Include only the business context needed for a response."
                  : "You can explore the form and check the required fields. Online submission will be enabled when the contact channel is ready."}
              </p>
              {verifiedEmail && (
                <a className="text-link" href={`mailto:${verifiedEmail}`}>
                  Contact by email →
                </a>
              )}
            </div>
            <p className="note" style={{ marginTop: 24 }}>
              Privacy and retention information for production lead processing
              must be supplied by the operator before this channel launches.
            </p>
          </aside>
          <Suspense fallback={<div className="contact-form" />}>
            <ContactForm configured={configured} />
          </Suspense>
        </div>
      </section>
    </>
  );
}
