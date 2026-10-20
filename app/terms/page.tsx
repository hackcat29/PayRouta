import Link from "next/link";
import { LegalPage, contactLine, legal } from "@/components/marketing/legal";
import { pricing } from "@/content/claims";
import { paths, trustedOrigin } from "@/lib/site-config";

export const metadata = {
  title: "Terms of Service",
  description: `The terms for using PayRouta, a service of ${legal.entity}.`,
  alternates: trustedOrigin() ? { canonical: paths.terms } : undefined,
};

export default function Terms() {
  return (
    <LegalPage
      title="Terms of Service"
      intro={
        <>
          These terms are an agreement between you and {legal.entity}{" "}
          (&ldquo;PayRouta&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;). They
          cover the PayRouta website, dashboard, API and test mode. Please read
          them before you create an account.
        </>
      }
      sections={[
        [
          "scope",
          "What these terms cover",
          <>
            <p>
              By creating an account or using PayRouta you agree to these terms
              on behalf of yourself and the business you represent.
            </p>
            <p>
              Before you take live payments, you also accept a merchant
              agreement in your dashboard. It sets your fees, any reserve, your
              payout schedule and your limits. If it conflicts with these terms,
              the merchant agreement applies.
            </p>
          </>,
        ],
        [
          "account",
          "Your account",
          <>
            <p>
              You must be at least 18 and allowed to act for your business. The
              information you give us must be true and kept up to date.
            </p>
            <p>
              Keep your password, authenticator and API keys secure. You are
              responsible for everything done with your account and keys. Tell
              us straight away if you think they have been misused.
            </p>
          </>,
        ],
        [
          "verification",
          "Checking your business",
          <>
            <p>
              Before you can take live payments we verify your business, the
              people who own or control it and your bank account, and screen
              them against sanctions lists. Our processing partners may ask for
              more information. We can refuse an application, or pause an
              account while we review it, where the law, our partners or our
              risk assessment requires it.
            </p>
          </>,
        ],
        [
          "payments",
          "How payments and payouts work",
          <>
            <p>
              You appoint us as your agent to receive payments from your
              customers. When a customer&apos;s payment to us or our partner is
              confirmed, the customer has paid you, even before the money
              reaches your bank.
            </p>
            <p>
              Card, bank and mobile money payments are processed by licensed
              partners and held by them for your business, not in our own bank
              accounts. We pay your available balance to your bank account on
              your payout schedule. In some markets the partner pays your bank
              directly.
            </p>
            <p>
              Stablecoin and crypto payments go directly from your customer to a
              wallet you control. We never hold them. You are responsible for
              your wallet, its keys and the addresses you give us. Blockchain
              payments can&apos;t be reversed, so we can&apos;t recover funds
              sent to a wrong address.
            </p>
          </>,
        ],
        [
          "fees",
          "Fees",
          <>
            <p>
              Our fees are on the <Link href={paths.pricing}>pricing page</Link>{" "}
              or in your merchant agreement: {pricing.partnerProcessed.rate} of
              each successful payment (at most {pricing.partnerProcessed.cap} or
              the local equivalent) plus the processing partner&apos;s
              standard fee, and {pricing.payroutaOnly.rate} for stablecoin and
              crypto payments. We deduct fees from payments before they reach
              your balance, or invoice you monthly where we can&apos;t. Fees
              aren&apos;t returned when you refund a payment.
            </p>
            <p>
              You can choose to add fees to what your customers pay. If you
              do, you are responsible for following any rules on surcharges
              where you and your customers are, including telling customers
              about the fee.
            </p>
            <p>
              We&apos;ll give you at least 30 days&apos; notice of a fee
              increase.
            </p>
          </>,
        ],
        [
          "risk",
          "Refunds, disputes, reserves and amounts you owe",
          <>
            <p>
              You are responsible for refunds, chargebacks, disputes and any
              fines or fees that result from your sales. Refunds come out of
              your balance.
            </p>
            <p>
              We may hold a reserve: part of your payments kept for a set period
              to cover refunds and chargebacks. Your merchant agreement sets it,
              and we may change it if your risk changes.
            </p>
            <p>
              If you owe us money, we may take it from any balance we hold for
              you, including future payments. If your balance isn&apos;t enough,
              you must pay us the rest when we ask.
            </p>
          </>,
        ],
        [
          "tax",
          "Taxes",
          <>
            <p>
              You are the seller of your products. You are responsible for
              charging, reporting and paying the taxes on your sales. We are not
              your merchant of record.
            </p>
          </>,
        ],
        [
          "use",
          "What you can't use PayRouta for",
          <>
            <ul>
              <li>
                Anything illegal where you or your customers are, or goods and
                services our partners prohibit.
              </li>
              <li>
                Taking payments for another business, or hiding what you really
                sell.
              </li>
              <li>
                Fraud, money laundering, terrorist financing or getting around
                sanctions.
              </li>
              <li>Using real card or bank details in test mode.</li>
              <li>
                Interfering with the service, getting around its limits, or
                accessing data that isn&apos;t yours.
              </li>
            </ul>
          </>,
        ],
        [
          "ending",
          "Suspending or closing an account",
          <>
            <p>
              You can close your account at any time. We may suspend or close it
              if you break these terms, if the law or a partner requires it, or
              if we reasonably believe your account carries unacceptable risk.
              Where we can, we&apos;ll tell you why.
            </p>
            <p>
              When an account closes, we pay out your remaining balance after
              any reserve period ends and after deducting what you owe us,
              unless the law requires us to hold it.
            </p>
          </>,
        ],
        [
          "service",
          "Our service",
          <>
            <p>
              We work to keep PayRouta available and accurate, but we provide it
              as it is. We depend on processing partners, banks and blockchains
              we don&apos;t control, and we aren&apos;t responsible for their
              outages or errors. Features marked as in testing may change or be
              withdrawn.
            </p>
          </>,
        ],
        [
          "liability",
          "Liability",
          <>
            <p>
              We aren&apos;t liable for indirect losses, such as lost profits,
              revenue or data. Our total liability for any claim is limited to
              the fees you paid us in the 12 months before it arose.
            </p>
            <p>
              You will cover our losses that result from your products, your
              breach of these terms, or your breaking the law.
            </p>
            <p>
              Nothing in these terms limits liability that the law doesn&apos;t
              allow us to limit.
            </p>
          </>,
        ],
        [
          "changes",
          "Changes to these terms",
          <>
            <p>
              We may update these terms. For important changes we&apos;ll email
              you or tell you in your dashboard at least 30 days before they
              take effect. If you keep using PayRouta after that, you accept the
              new terms.
            </p>
          </>,
        ],
        [
          "law",
          "Law and contact",
          <>
            <p>
              These terms are governed by the laws of the State of Delaware,
              United States. If we can&apos;t resolve a disagreement together,
              it will be settled by the courts there.
            </p>
            <p>Questions about these terms? {contactLine}</p>
          </>,
        ],
      ]}
    />
  );
}
