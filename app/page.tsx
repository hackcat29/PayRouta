import Link from "next/link";
import { HeroDemo } from "@/components/marketing/hero-demo";
import { LinkPicture } from "@/components/marketing/add-anywhere";
import { CoverageGrid, CreditTimeline, PaymentFlow } from "@/components/marketing/diagrams";
import { pillars } from "@/content/claims";
import { createLinkHref, trustedOrigin, paths } from "@/lib/site-config";

const description =
  "Share a payment link or add one checkout button. Customers pay by card, digital wallet, bank transfer, mobile money or crypto from any chain, or spread the cost with a licensed lender while you're paid in full.";

export const metadata = {
  title: { absolute: "PayRouta: one checkout for every way the world pays" },
  description,
  alternates: trustedOrigin() ? { canonical: "/" } : undefined,
  ...(trustedOrigin()
    ? {
        openGraph: { images: ["/og/home"] },
        twitter: { card: "summary_large_image", images: ["/og/home"] },
      }
    : {}),
};

function More({ children }: { children: React.ReactNode }) {
  return (
    <span className="hp-more">
      {children} <span aria-hidden="true">→</span>
    </span>
  );
}

export default function Home() {
  const creditLive = pillars.find((p) => p.id === "credit")!.availability === "available";
  const origin = trustedOrigin() ?? "https://payrouta.com";
  return (
    <div className="mk hp">
      <section className="hp-hero">
        <div className="mk-wrap hp-hero-grid">
          <div className="hp-hero-copy">
            <h1 className="hp-h1">One checkout for every way the world pays.</h1>
            <p className="hp-sub">
              One link or one button. Customers pay by card, bank, mobile money, crypto or credit. You get paid in full.
            </p>
            <div className="hp-cta">
              <Link className="mk-btn primary" href={createLinkHref}>
                Create a payment link
              </Link>
              <Link className="mk-btn ghost-dark" href={paths.checkout}>
                Add checkout to your site
              </Link>
            </div>
          </div>
          <HeroDemo />
        </div>
      </section>

      <section className="hp-sec" aria-labelledby="products-h">
        <div className="mk-wrap">
          <h2 className="hp-h2" id="products-h">
            Sell in a chat, on a site or in a store.
          </h2>
          <div className="hp-bento">
            <Link className="hp-tile hp-tile-links" href={paths.paymentLinks}>
              <span className="hp-tile-text">
                <span className="hp-tile-title">Payment links</span>
                <span>No website? Create a link and share it on WhatsApp, Instagram or by SMS.</span>
                <More>Payment links</More>
              </span>
              <LinkPicture origin={origin} />
            </Link>
            <Link className="hp-tile hp-tile-button" href={paths.checkout}>
              <span className="hp-tile-text">
                <span className="hp-tile-title">Checkout button</span>
                <span>One button on your site or app, or install PayRouta in Shopify and WooCommerce.</span>
                <More>Checkout button</More>
              </span>
              <span className="hp-mini-code" aria-hidden="true">
                <code>{'<button data-payrouta-checkout>'}</code>
                <span className="hp-mini-btn">Checkout</span>
              </span>
            </Link>
            <Link className="hp-tile hp-tile-credit" href={paths.credit}>
              <span className="hp-tile-text">
                <span className="hp-tile-title">Pay with credit</span>
                <span>
                  Customers spread the cost with a licensed lender. You&apos;re paid in full today.
                  {!creditLive && " Opening country by country."}
                </span>
                <More>Pay with credit</More>
              </span>
              <span className="hp-mini-plan" aria-hidden="true">
                <i />
                <i />
                <i />
                <i />
              </span>
            </Link>
            <Link className="hp-tile hp-tile-crypto" href={paths.crypto}>
              <span className="hp-tile-text">
                <span className="hp-tile-title">Crypto payments</span>
                <span>Customers pay from any wallet on any chain. You receive the stablecoin you chose.</span>
                <More>Crypto payments</More>
              </span>
              <span className="hp-mini-route" aria-hidden="true">
                <b>125+ assets</b>
                <i />
                <b>USDC</b>
              </span>
            </Link>
          </div>
        </div>
      </section>

      <section className="hp-sec hp-paper" aria-labelledby="credit-h">
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
            <Link className="hp-link" href={paths.credit}>
              How credit works <span aria-hidden="true">→</span>
            </Link>
          </div>
          <CreditTimeline />
        </div>
      </section>

      <section className="hp-sec" aria-labelledby="how-h">
        <div className="mk-wrap">
          <h2 className="hp-h2" id="how-h">
            How a payment moves
          </h2>
          <PaymentFlow />
        </div>
      </section>

      <section className="hp-sec hp-paper" aria-labelledby="cov-h">
        <div className="mk-wrap">
          <h2 className="hp-h2" id="cov-h">
            Where customers can pay
          </h2>
          <CoverageGrid />
        </div>
      </section>

      <section className="hp-sec hp-doors" aria-label="For lenders and payment providers">
        <div className="mk-wrap hp-doors-grid">
          <Link className="hp-door" href={`${paths.partners}#request`}>
            <span className="hp-door-kicker">Lenders</span>
            <span className="hp-door-title">Offer instalments at every PayRouta checkout in the countries you lend in.</span>
            <More>Become a credit partner</More>
          </Link>
          <Link className="hp-door" href={`${paths.partners}#request`}>
            <span className="hp-door-kicker">Payment providers</span>
            <span className="hp-door-title">Process payments for PayRouta merchants where you&apos;re licensed.</span>
            <More>Request provider access</More>
          </Link>
        </div>
      </section>
    </div>
  );
}
