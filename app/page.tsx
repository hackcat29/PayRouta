import Link from "next/link";
import { HeroDemo } from "@/components/marketing/hero-demo";
import { AddAnywhere } from "@/components/marketing/add-anywhere";
import { CoverageGrid, CreditTimeline, CryptoRoute, PaymentFlow } from "@/components/marketing/diagrams";
import { pillars, platforms, pricing } from "@/content/claims";
import { createLinkHref, trustedOrigin, paths } from "@/lib/site-config";

const description =
  "Share a payment link or add one checkout button. Customers pay by card, digital wallet, bank transfer, mobile money or crypto from any chain, or spread the cost with a licensed lender while you're paid in full.";

export const metadata = {
  title: { absolute: "PayRouta: let every customer pay the way they can" },
  description,
  alternates: trustedOrigin() ? { canonical: "/" } : undefined,
  ...(trustedOrigin()
    ? {
        openGraph: { images: ["/og/home"] },
        twitter: { card: "summary_large_image", images: ["/og/home"] },
      }
    : {}),
};

const platform = (name: string) => platforms.find((p) => p.name === name)!.availability;

export default function Home() {
  const creditLive = pillars.find((p) => p.id === "credit")!.availability === "available";
  return (
    <div className="mk hp">
      <section className="hp-hero">
        <div className="mk-wrap hp-hero-grid">
          <div className="hp-hero-copy">
            <h1 className="hp-h1">Let every customer pay the way they can.</h1>
            <p className="hp-sub">
              Share a payment link or add one checkout button. Customers pay by card, digital wallet, bank transfer,
              mobile money or crypto, or spread the cost with a licensed lender while you get paid in full.
            </p>
            <div className="hp-cta">
              <Link className="mk-btn primary" href={createLinkHref}>
                Create a payment link
              </Link>
              <Link className="mk-btn secondary" href="/docs/checkout-button">
                Add the button to your site
              </Link>
            </div>
          </div>
          <HeroDemo />
        </div>
      </section>

      <section id="how" className="hp-sec" aria-labelledby="how-h">
        <div className="mk-wrap">
          <h2 className="hp-h2" id="how-h">
            How a payment moves
          </h2>
          <PaymentFlow />
        </div>
      </section>

      <section id="credit" className="hp-sec hp-sand" aria-labelledby="credit-h">
        <div className="mk-wrap hp-split">
          <div className="hp-text">
            <h2 className="hp-h2" id="credit-h">
              Customers who can&apos;t pay all at once can still buy.
            </h2>
            <p>
              Most people in the world don&apos;t have a credit card. PayRouta puts a licensed lender&apos;s instalment
              plan inside your checkout. You&apos;re paid in full today; the lender collects the instalments and carries
              the risk.
            </p>
            <p>
              Selling subscriptions? Sell the year upfront; your customer repays monthly.
              {!creditLive && " Lenders are joining country by country."}
            </p>
            <Link className="hp-link" href="/docs/credit">
              How credit works <span aria-hidden="true">→</span>
            </Link>
          </div>
          <CreditTimeline />
        </div>
      </section>

      <section id="crypto" className="hp-sec hp-night" aria-labelledby="crypto-h">
        <div className="mk-wrap">
          <div className="hp-text hp-text-wide">
            <h2 className="hp-h2" id="crypto-h">
              Crypto from any wallet, on any chain.
            </h2>
            <p>Customers pay with what they hold. You receive exactly the coin you chose, in your own wallet.</p>
          </div>
          <CryptoRoute />
        </div>
      </section>

      <section id="links" className="hp-sec" aria-labelledby="add-h">
        <div className="mk-wrap hp-split hp-split-top">
          <div className="hp-text">
            <h2 className="hp-h2" id="add-h">
              No website? Share a link.
            </h2>
            <p>
              Create a payment link in your dashboard and send it on WhatsApp, Instagram or by SMS. Selling online? Add
              the button, or install PayRouta in your store.
            </p>
          </div>
          <AddAnywhere
            origin={trustedOrigin() ?? "https://YOUR-PAYROUTA-URL"}
            statuses={{
              link: platform("No website"),
              html: platform("Any website or app"),
              shopify: platform("Shopify"),
              woocommerce: platform("WooCommerce"),
            }}
          />
        </div>
      </section>

      <section id="coverage" className="hp-sec hp-sand" aria-labelledby="cov-h">
        <div className="mk-wrap">
          <h2 className="hp-h2" id="cov-h">
            Where customers can pay
          </h2>
          <CoverageGrid />
        </div>
      </section>

      <section className="hp-sec" aria-labelledby="price-h">
        <div className="mk-wrap">
          <h2 className="hp-h2" id="price-h">
            Pay only when a payment succeeds
          </h2>
          <dl className="hp-figures">
            <div>
              <dt>{pricing.partnerProcessed.rate}</dt>
              <dd>
                per payment, max {pricing.partnerProcessed.cap}, plus the partner&apos;s fee. Cards, wallets, bank,
                mobile money, credit.
              </dd>
            </div>
            <div>
              <dt>{pricing.payroutaOnly.rate}</dt>
              <dd>stablecoins and crypto, all in. Coins go straight to your wallet.</dd>
            </div>
            <div>
              <dt>$0</dt>
              <dd>for failed payments, retries on a backup partner, and test mode.</dd>
            </div>
          </dl>
          <Link className="hp-link" href={paths.pricing}>
            Pricing details <span aria-hidden="true">→</span>
          </Link>
        </div>
      </section>

      <section className="hp-sec hp-doors" aria-label="For lenders and payment providers">
        <div className="mk-wrap hp-doors-grid">
          <Link className="hp-door hp-door-credit" href={`${paths.partners}#request`}>
            <span className="hp-door-kicker">Lenders</span>
            <span className="hp-door-title">Offer instalments at every PayRouta checkout in the countries you lend in.</span>
            <span className="hp-link">Become a credit partner →</span>
          </Link>
          <Link className="hp-door" href={`${paths.partners}#request`}>
            <span className="hp-door-kicker">Payment providers</span>
            <span className="hp-door-title">Process payments for PayRouta merchants where you&apos;re licensed.</span>
            <span className="hp-link">Request provider access →</span>
          </Link>
        </div>
      </section>

      <section className="hp-final" aria-labelledby="final-h">
        <div className="mk-wrap">
          <h2 className="hp-h2" id="final-h">
            Get paid with one link today.
          </h2>
          <div className="hp-cta">
            <Link className="mk-btn primary on-dark" href={createLinkHref}>
              Create a payment link
            </Link>
            <Link className="mk-btn ghost-dark" href="/docs/checkout-button">
              Add the button to your site
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
