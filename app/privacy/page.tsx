import { LegalPage, contactLine, legal } from "@/components/marketing/legal";
import { paths, trustedOrigin } from "@/lib/site-config";

export const metadata = {
  title: "Privacy Policy",
  description: `How ${legal.entity} collects, uses and protects personal data on PayRouta.`,
  alternates: trustedOrigin() ? { canonical: paths.privacy } : undefined,
};

export default function Privacy() {
  return (
    <LegalPage
      title="Privacy Policy"
      intro={
        <>
          This policy explains what personal data {legal.entity} collects when
          you use PayRouta, why, who we share it with, and the choices you have.{" "}
          {legal.entity} is responsible for this data.
        </>
      }
      sections={[
        [
          "collect",
          "What we collect",
          <>
            <ul>
              <li>
                <strong>Your account:</strong> name, email, a protected form of
                your password, and your two-step verification settings. If you
                sign in with Google or your company&apos;s identity provider, we
                receive your name and email from it. Passkeys stay on your
                device; we store only a public key.
              </li>
              <li>
                <strong>Your business:</strong> registration details, the people
                who own or control it, their identity details, and your payout
                bank account or wallet addresses.
              </li>
              <li>
                <strong>Payments:</strong> amounts, methods, dates and outcomes,
                plus the details a customer gives at checkout, such as an email
                or a mobile money number. Card numbers are entered on our
                partner&apos;s secure page; we never store full card numbers.
              </li>
              <li>
                <strong>Crypto payments:</strong> wallet addresses and
                transaction hashes, which are public on the blockchain.
              </li>
              <li>
                <strong>Technical data:</strong> IP address and browser details,
                used to keep accounts secure and stop abuse.
              </li>
              <li>
                <strong>Messages:</strong> what you send us through the contact
                form or by email, and whether our emails were delivered, opened
                or clicked.
              </li>
            </ul>
          </>,
        ],
        [
          "use",
          "Why we use it",
          <>
            <ul>
              <li>
                To run your account and process, settle and reconcile payments.
              </li>
              <li>
                To verify businesses and meet anti-money-laundering, sanctions
                and other legal duties.
              </li>
              <li>To prevent fraud and keep PayRouta secure.</li>
              <li>
                To answer you and send service messages, such as receipts and
                security notices.
              </li>
              <li>
                To send product updates, only if you agreed. Every one has an
                unsubscribe link.
              </li>
            </ul>
            <p>
              We use data because we need it to provide the service you asked
              for, because the law requires it, because we have a legitimate
              interest in keeping PayRouta safe, or because you consented.
            </p>
          </>,
        ],
        [
          "share",
          "Who we share it with",
          <>
            <p>We don&apos;t sell personal data. We share it only with:</p>
            <ul>
              <li>
                <strong>Processing partners</strong> that handle your payments,
                each receiving only what it needs.
              </li>
              <li>
                <strong>Verification and screening providers</strong> that check
                identities, businesses and sanctions lists.
              </li>
              <li>
                <strong>Service providers</strong> that host our systems, store
                files, send our email (Resend) and monitor errors, under
                contracts that protect the data.
              </li>
              <li>
                <strong>Authorities,</strong> when the law requires it.
              </li>
            </ul>
            <p>Ask us for the current list of the companies we use.</p>
          </>,
        ],
        [
          "customers",
          "If you're paying a business",
          <>
            <p>
              When you pay a business that uses PayRouta, that business decides
              why your data is collected, and its privacy policy applies. We
              process your data for it to complete the payment, and keep the
              records the law requires of us.
            </p>
          </>,
        ],
        [
          "cookies",
          "Cookies",
          <>
            <p>
              We use only the cookies needed to keep you signed in and protect
              your account. We don&apos;t use advertising or tracking cookies.
              The checkout may save a small note in your browser so you can
              resume a crypto payment.
            </p>
          </>,
        ],
        [
          "keep",
          "How long we keep it",
          <>
            <p>
              We keep account data while your account is open. Verification and
              payment records are kept for as long as financial regulations
              require, usually at least five years after the account closes. We
              delete or anonymise data when we no longer need it.
            </p>
          </>,
        ],
        [
          "security",
          "Security and transfers",
          <>
            <p>
              Identity and bank details are encrypted, accounts can use two-step
              verification, and staff access is limited to what each person
              needs.
            </p>
            <p>
              We and our partners work in several countries, so your data may be
              processed outside the country where you live. When it is, we use
              safeguards the law requires.
            </p>
          </>,
        ],
        [
          "rights",
          "Your rights",
          <>
            <p>
              Depending on where you live, you can ask to see, correct, delete
              or move your data, object to how we use it, or withdraw consent.
              Some data we must keep by law. We&apos;ll reply within 30 days.
              You can also complain to your data protection authority.
            </p>
            <p>
              Change your email preferences at any time from the link in any of
              our emails.
            </p>
          </>,
        ],
        [
          "changes",
          "Changes and contact",
          <>
            <p>
              PayRouta isn&apos;t meant for anyone under 18. If we change this
              policy in an important way, we&apos;ll tell you by email or in
              your dashboard.
            </p>
            <p>Privacy questions or requests? {contactLine}</p>
          </>,
        ],
      ]}
    />
  );
}
