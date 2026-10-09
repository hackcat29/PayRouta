import { CheckCircle } from "@phosphor-icons/react/dist/ssr";
import { Btn, Kicker, MkLink, Photo, SectionHead } from "@/components/marketing/ui";
import { Closing, Faq, FlagStrip, MethodBento, Stats, Versus } from "@/components/marketing/sections";
import { RouteWidget } from "@/components/marketing/route-widget";
import { DepartureBoard } from "@/components/marketing/departure-board";
import { RevenueCalculator } from "@/components/marketing/revenue-calculator";
import { CodeTabs } from "@/components/marketing/code-tabs";
import { lines, status } from "@/content/claims";
import { trustedOrigin, paths } from "@/lib/site-config";

export const metadata = {
  title: { absolute: "PayRouta — Every way your customers pay, one application" },
  description:
    "Apply once to PayRouta and accept cards, bank transfers, mobile money and stablecoins through regulated processing partners, with same-method failover and payouts on your schedule. Stablecoins go straight to your wallet.",
  alternates: trustedOrigin() ? { canonical: "/" } : undefined,
  ...(trustedOrigin()
    ? {
        openGraph: { images: ["/og/home"] },
        twitter: { card: "summary_large_image", images: ["/og/home"] },
      }
    : {}),
};

const faqs: [string, string][] = [
  [
    "What does PayRouta actually do?",
    "Two things. First, you apply once to PayRouta: we verify your business and set up processing for you with our regulated payment partners, so you never fill in a provider's forms. Second, one API routes every payment to a partner that can take it, and fails over to another for the same method when the first can't. You can also connect payment accounts you already own.",
  ],
  [
    "Does PayRouta hold my money?",
    "Not in PayRouta's own bank accounts. Your balance is held by our regulated processing partners, or paid by them straight to your bank, and PayRouta pays it out to you on your schedule. Stablecoin payments go directly to your own wallet. PayRouta is not your merchant of record: you remain the seller.",
  ],
  [
    "Who verifies my business?",
    "PayRouta does, once. You give us your business details, identity details and payout bank account in your dashboard; we screen them and share with our processing partners only what each one needs to verify you. Identity and bank details are stored encrypted.",
  ],
  [
    "Can I keep my existing provider accounts?",
    "Yes. Accounts you open in your own name with a supported provider stay yours, and PayRouta routes to them alongside its own processing. If you already have an account with a supported provider, talk to us about connecting it.",
  ],
  [
    "Will PayRouta ever switch my customer to a different payment method?",
    "No. The customer's choice is fixed. Failover only happens between providers of the same method — a card payment is retried as a card payment. If no eligible provider remains, the customer is asked to choose again.",
  ],
  [
    "How is a retry safe? Couldn't the customer be charged twice?",
    "Every request is idempotent, and a timeout is never treated as a failure. PayRouta rechecks the original provider's status before it considers another route, so an uncertain payment is resolved before anything is retried.",
  ],
  [
    "Do you handle sales tax or VAT?",
    "No. PayRouta is not a merchant of record, so tax obligations stay with you. If you need a merchant of record, you can still use one alongside PayRouta.",
  ],
  [
    "Can I go live today?",
    `${status.stage}: ${status.sandbox.toLowerCase()}. ${status.live}.`,
  ],
];

export default function Home() {
  return (
    <div className="mk">
      {/* HERO: the product, working */}
      <section className="mk-hero">
        <div className="mk-wrap mk-hero-grid">
          <div>
            <Kicker line="bank">Payment routing · {status.stage}</Kicker>
            <h1 className="mk-h1">Every way your customers pay. One integration.</h1>
            <p className="mk-lead">
              Apply once to PayRouta and accept cards, bank transfers, mobile
              money and stablecoins. One API routes every payment across our
              regulated processing partners — and when one goes down, PayRouta
              sends the payment through another. You&apos;re paid out on your
              schedule.
            </p>
            <div className="mk-actions">
              <Btn href="/merchant" large>
                Start building
              </Btn>
              <Btn href="/contact?intent=merchant" ghost large>
                Talk to sales
              </Btn>
            </div>
            <div className="mk-hero-meta">
              {["Free sandbox", "One application", "Regulated partners hold funds"].map((t) => (
                <span key={t}>
                  <CheckCircle size={18} weight="fill" color="var(--teal)" /> {t}
                </span>
              ))}
            </div>
          </div>
          <RouteWidget />
        </div>
      </section>

      <FlagStrip />

      {/* FIGURES */}
      <section className="mk-section tight mk-mint">
        <div className="mk-wrap">
          <Stats />
        </div>
      </section>

      {/* ONE APPLICATION */}
      <section className="mk-section">
        <div className="mk-wrap">
          <SectionHead
            n="1"
            line="bank"
            kicker="Register once"
            title="One application. Every way to get paid."
            lead="Tell PayRouta about your business once. We verify you and set up processing with our regulated partners behind the scenes — you never see a provider's forms. Already have provider accounts in your own name? Connect them too."
          >
            <MkLink href="/docs/provider-accounts">How accounts and payouts work</MkLink>
          </SectionHead>
          <div className="mk-principles">
            {(
              [
                ["bank", "Apply once", "One application to PayRouta. We verify your business and share with each processing partner only what it needs."],
                ["card", "Bring your own accounts", "Accounts you already own with a supported provider stay yours, and PayRouta routes to them alongside its own processing."],
                ["mobile", "Paid out on your schedule", "Regulated partners hold your balance — never PayRouta's own bank accounts — and you're paid out daily, weekly or monthly. Stablecoins go straight to your wallet."],
              ] as const
            ).map(([l, h, p]) => (
              <article key={h} data-reveal>
                <span className="mk-bullet" style={{ background: lines[l].color }} aria-hidden="true">
                  {lines[l].bullet}
                </span>
                <h3 className="mk-h3">{h}</h3>
                <p className="mk-body">{p}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* FAILOVER */}
      <section className="mk-section mk-fog">
        <div className="mk-wrap">
          <SectionHead
            n="2"
            line="card"
            kicker="Same-method failover"
            title="Providers go down. Your checkout doesn't."
            lead="Every provider has outages, maintenance windows and bad afternoons. PayRouta keeps a backup route ready for every payment method, so a failure on their side stays invisible on yours."
          />
          <Versus />
        </div>
      </section>

      {/* DEPARTURES */}
      <section className="mk-section mk-dark">
        <div className="mk-wrap">
          <SectionHead
            n="3"
            line="mobile"
            kicker="Routing, simulated"
            title="Every payment leaves on time."
            lead="PayRouta watches the health of each of your providers and reroutes before your customer notices. This sandbox simulation shows what a busy afternoon looks like."
          />
          <DepartureBoard />
        </div>
      </section>

      {/* METHODS */}
      <section className="mk-section">
        <div className="mk-wrap">
          <SectionHead
            n="4"
            line="wallet"
            kicker="Payment methods"
            title="Meet customers in the way they already pay."
            lead="Card-first checkouts lose most of the world. PayRouta puts the methods people trust behind one schema — and shows each customer only the ones your provider accounts can complete for them."
          >
            <MkLink href={paths.paymentMethods}>Explore every method</MkLink>
          </SectionHead>
          <MethodBento />
        </div>
      </section>

      {/* GLOBAL MERCHANTS */}
      <section className="mk-section mk-fog">
        <div className="mk-wrap">
          <SectionHead
            n="5"
            line="crypto"
            kicker="Built for real businesses"
            title="From market stalls to global storefronts."
            lead="Local merchants selling at home and indie software businesses selling worldwide get the same thing: their own provider accounts, a checkout that speaks their customers' language, and a backup when a provider fails."
          />
          <div className="mk-mosaic">
            <Photo src="market-vendor-phone" alt="A market trader holding her phone at her fruit stall" tags={[{ label: "Mobile money", line: "mobile" }]} />
            <Photo src="boutique-seller" alt="An online clothing seller celebrating an order at her laptop" tags={[{ label: "Cards", line: "card" }]} />
            <Photo src="cafe-owner-tablet" alt="A café owner using a tablet point of sale behind the counter" tags={[{ label: "Wallets", line: "wallet" }]} />
            <Photo src="tailor-phone" alt="A tailor smiling at his phone beside a sewing machine" tags={[{ label: "Transfers", line: "bank" }]} />
            <Photo src="tokyo-street" alt="A street of small shops lit up at night" tags={[{ label: "Wallets", line: "wallet" }]} />
            <Photo src="packing-orders" alt="A merchant packing an order into a shipping box" tags={[{ label: "Stablecoins", line: "crypto" }]} />
          </div>
        </div>
      </section>

      {/* CALCULATOR */}
      <section className="mk-section">
        <div className="mk-wrap">
          <SectionHead
            n="6"
            line="bank"
            kicker="The cost of a single route"
            title="How much is one provider costing you?"
            lead="Provider-side failures are revenue you've already won — the customer chose, clicked pay, and the rails let you down. Estimate what a backup route is worth."
          />
          <RevenueCalculator />
        </div>
      </section>

      {/* DEVELOPERS */}
      <section className="mk-section mk-dark">
        <div className="mk-wrap mk-dev">
          <div data-reveal>
            <Kicker n="7">For developers</Kicker>
            <h2 className="mk-h2">One API across your providers. No adapters to babysit.</h2>
            <p className="mk-lead">
              Create an intent, redirect to checkout, listen for signed events.
              Idempotency, retries, status rechecks and provider quirks are
              handled before they reach your code.
            </p>
            <p className="mk-body">{status.sdks}. Or call the HTTP API directly.</p>
            <div className="mk-actions">
              <Btn href="/docs/quickstart">Read the quickstart</Btn>
              <Btn href={paths.apiReference} ghost>
                API reference
              </Btn>
            </div>
          </div>
          <CodeTabs />
        </div>
      </section>

      {/* MANIFESTO */}
      <section className="mk-section">
        <div className="mk-wrap">
          <Kicker n="8" line="card">
            Why PayRouta
          </Kicker>
          <p className="mk-quote" data-reveal>
            The world doesn&apos;t pay one way. A shopper in São Paulo reaches
            for <mark>Pix</mark>, one in Nairobi for <mark>M-Pesa</mark>, one in
            Berlin for a <mark>card</mark>. Every business should be able to say
            yes to all of them — and never lose a sale because one provider had
            a bad day.
          </p>
          <div className="mk-principles">
            {(
              [
                ["card", "The customer chooses", "We never swap a customer's payment method behind their back. Routing happens within the method they picked."],
                ["bank", "Every method has a backup", "No single provider is a single point of failure. Each method can route to more than one of your providers."],
                ["mobile", "States are honest", "A timeout is not a failure. Uncertain payments are rechecked before anything is retried, so nobody pays twice."],
              ] as const
            ).map(([l, h, p]) => (
              <article key={h} data-reveal>
                <span className="mk-bullet" style={{ background: lines[l].color }} aria-hidden="true">
                  {lines[l].bullet}
                </span>
                <h3 className="mk-h3">{h}</h3>
                <p className="mk-body">{p}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* PROVIDER NETWORK */}
      <section className="mk-section tight">
        <div className="mk-wrap">
          <div className="mk-network mk-dark" data-reveal>
            <div>
              <Kicker n="9">For payment providers</Kicker>
              <h2 className="mk-h2">Merchants apply once. You onboard them directly.</h2>
              <p className="mk-lead">
                If your programme opens accounts that merchants own, PayRouta
                sends you pre-screened, pre-filled applications from merchants
                who choose you. You verify them, contract with them and settle
                to them — PayRouta routes their payments to you.
              </p>
              <div className="mk-actions">
                <Btn href="/contact?intent=provider">Talk to partnerships</Btn>
                <Btn href={paths.providers} ghost>
                  How it works
                </Btn>
              </div>
            </div>
            <NetworkGraphic />
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="mk-section mk-fog">
        <div className="mk-wrap">
          <Faq items={faqs} />
        </div>
      </section>

      <Closing />
    </div>
  );
}

// Providers as stations on lines that all run into the PayRouta interchange.
function NetworkGraphic() {
  const keys = Object.keys(lines) as (keyof typeof lines)[];
  return (
    <svg viewBox="0 0 480 400" aria-hidden="true">
      {keys.map((k, i) => {
        const y = 60 + i * 70;
        const c = lines[k].color;
        return (
          <g key={k}>
            <path d={`M20,${y} H150 L${150 + Math.abs(200 - y) * 0.5},${200 + (y - 200) * 0.5} H460`} fill="none" stroke={c} strokeWidth="10" strokeLinejoin="round" />
            <circle cx="70" cy={y} r="11" fill="#fff" stroke={c} strokeWidth="5" />
          </g>
        );
      })}
      <rect x="330" y="72" width="44" height="256" rx="22" fill="#fff" stroke="var(--mint)" strokeWidth="6" />
      <g transform="translate(337 185) scale(0.3)">
        <path fill="#0b1b22" d="M16 88V24Q16 12 28 12H57C78 12 90 23 90 40S78 68 57 68H43V52H57C68 52 74 48 74 40S68 28 57 28H32V88Z" />
        <path fill="#00857a" d="M43 52H62L90 88H70Z" />
      </g>
    </svg>
  );
}
