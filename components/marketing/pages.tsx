import Link from "next/link";
import { pages, type PageSlug } from "@/content/marketing";
import { pricing } from "@/content/claims";
import { defaultPartnerCaps } from "@/lib/payments/pricing";
import { paths } from "@/lib/site-config";
import { PageHeader } from "./ui";
import { FeeBars, JoinSteps, PartnerMap } from "./diagrams";
import { ProviderAccessForm } from "./provider-access-form";

// How each cap is written locally, e.g. KSh 640 or MX$90.
const capSymbol: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  NGN: "₦",
  GHS: "GH₵",
  KES: "KSh ",
  ZAR: "R",
  XOF: "CFA ",
  BRL: "R$",
  MXN: "MX$",
  CAD: "C$",
  AUD: "A$",
  CHF: "CHF ",
  SEK: "SEK ",
  JPY: "¥",
  INR: "₹",
  PHP: "₱",
  SGD: "S$",
  AED: "AED ",
  COP: "COL$",
};
const capLabel = (currency: string, minor: string) => {
  const e =
    new Intl.NumberFormat("en", {
      style: "currency",
      currency,
    }).resolvedOptions().maximumFractionDigits ?? 2;
  const value = Number(minor) / 10 ** e;
  const text = new Intl.NumberFormat("en", {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
  return `${capSymbol[currency] ?? `${currency} `}${text}`;
};

function Pricing() {
  const { partnerProcessed: partner, payroutaOnly: direct } = pricing;
  return (
    <div className="mk-article">
      <PageHeader
        title="Pay only for payments that succeed"
        lead={pages.pricing.intro}
      />

      <div className="pr-plans">
        <section className="pr-plan pr-plan-main" aria-labelledby="plan-partner">
          <h2 id="plan-partner">Cards, wallets, bank, mobile money, USSD, credit</h2>
          <strong>{partner.rate}</strong>
          <p>
            per successful payment, max {partner.cap}, plus the standard fee of the partner or lender that processed
            it, at cost. Taken from each payment.
          </p>
        </section>
        <section className="pr-plan" aria-labelledby="plan-crypto">
          <h2 id="plan-crypto">Stablecoins and crypto</h2>
          <strong>{direct.rate}</strong>
          <p>all in. No partner fee. The coins go straight to your wallet; our fee is billed monthly.</p>
        </section>
        <section className="pr-plan" aria-labelledby="plan-free">
          <h2 id="plan-free">Failed payments, backup retries, test mode</h2>
          <strong>$0</strong>
          <p>You only pay when a payment succeeds.</p>
        </section>
      </div>
      <section className="mk-prose">
        <h2 className="mk-h3">Using your own processor account</h2>
        <p>
          Connect an account you already have with a processor and pay {partner.rate}, max {partner.cap}, billed
          monthly. Your processor bills you its own fees.
        </p>

        <h2 className="mk-h3">The cap in other currencies</h2>
        <p>Our fee stops at a fixed amount close to $5 in each currency.</p>
        <p className="mk-caps">
          {Object.entries(defaultPartnerCaps)
            .map(([currency, cap]) => capLabel(currency, cap))
            .join(" · ")}
        </p>

        <h2 className="mk-h3">Who pays the fees</h2>
        <p>
          You choose. Absorb them, or have them added at checkout so you receive
          your full price. The customer sees the fee as its own line before
          paying. Set a default in your dashboard and override it on any
          payment. Businesses in the EU and UK can&apos;t add card or bank fees
          for customers; the law there forbids it.
        </p>
        <p className="mk-table-caption">A $100 card order, partner rate 2.9% + 30¢</p>
        <FeeBars />

        <h2 className="mk-h3">Everything else</h2>
        <p>
          No setup or monthly fees. Fees on a refunded payment aren&apos;t
          returned. Above {pricing.volumeThreshold},{" "}
          <Link href={`${paths.contact}?intent=pricing`}>
            ask about volume rates
          </Link>
          . The details are in the{" "}
          <Link href="/docs/billing">billing docs</Link>.
        </p>
      </section>
    </div>
  );
}

function Partners() {
  return (
    <div className="mk-article mk-article-wide">
      <PageHeader title="Reach every merchant on PayRouta" lead={pages.partners.intro} />
      <section className="pa-section" aria-labelledby="pa-where">
        <h2 className="mk-h2" id="pa-where">
          Where you fit
        </h2>
        <PartnerMap />
      </section>
      <section className="pa-section" aria-labelledby="pa-live">
        <h2 className="mk-h2" id="pa-live">
          Going live
        </h2>
        <JoinSteps />
      </section>
      <div className="mk-contact">
        <div className="mk-contact-form" id="request">
          <h2 className="mk-box-title">Request provider access</h2>
          <p className="mk-box-note mk-request-lead">
            Access is by invitation. Tell us about your service and our partnerships team will review it.
          </p>
          <ProviderAccessForm />
        </div>
        <aside className="mk-box">
          <h2 className="mk-box-title">Lenders</h2>
          <p className="mk-box-note">
            Price each plan, approve the customer and pay the merchant; the customer repays you. Choose
            &ldquo;Lender / consumer-credit provider&rdquo; in the form. The contract is in the{" "}
            <Link href="/docs/credit">credit docs</Link>.
          </p>
          <h2 className="mk-box-title">Payment providers</h2>
          <p className="mk-box-note">
            Implement the <Link href="/docs/provider-integration">Provider API</Link>, or describe your existing API so
            we can map it. Automated checks cover payments, status, idempotency, webhooks, refunds and settlement
            reports.
          </p>
          <h2 className="mk-box-title">Staying live</h2>
          <p className="mk-box-note">
            Keep compliance documents and credentials current and pass health checks. If they fail, payments go to
            another partner until you&apos;re back.
          </p>
          <p className="mk-box-note">
            Already approved? <Link href="/provider/sign-in">Sign in to the provider workspace</Link>
          </p>
        </aside>
      </div>
    </div>
  );
}

export const pageComponents: Record<PageSlug, () => React.ReactNode> = {
  pricing: Pricing,
  partners: Partners,
};
