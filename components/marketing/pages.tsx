import Link from "next/link";
import { type PageSlug } from "@/content/marketing";
import { availabilityLabel, markets, payouts, pillars, platforms, pricing } from "@/content/claims";
import { defaultPartnerCaps } from "@/lib/payments/pricing";
import { createLinkHref, docsUrl, paths, trustedOrigin } from "@/lib/site-config";
import { Btn, Feature, PageHero, Steps, TextLink } from "./ui";
import {
  ContinentalCreditMap,
  CoverageGrid,
  CreditTimeline,
  CryptoRoute,
  FeeBars,
  JoinSteps,
  PartnerMap,
  PaymentFlow,
} from "./diagrams";
import { AddAnywhere, LinkPicture } from "./add-anywhere";
import { HeroDemo } from "./hero-demo";
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

const origin = () => trustedOrigin() ?? "https://payrouta.com";
const status = (name: string) => platforms.find((p) => p.name === name)!.availability;
const creditLive = () => pillars.find((p) => p.id === "credit")!.availability === "available";

function PaymentLinks() {
  return (
    <>
      <PageHero
        title="Get paid with a link."
        actions={
          <>
            <Btn href={createLinkHref}>Create a payment link</Btn>
            <Btn href={docsUrl("payment-links")} variant="secondary">
              Payment links guide
            </Btn>
          </>
        }
        visual={<LinkPicture origin={origin()} />}
      />
      <Feature title="Ready in a minute" tone="paper">
        <Steps
          steps={[
            "Create a link",
            "Share it on WhatsApp, Instagram or SMS",
            "Get paid",
          ]}
        />
      </Feature>
      <Feature title="Every customer gets their own checkout" visual={<HeroDemo />}>
        <p>
          One link takes any number of payments. When a customer presses Pay, PayRouta opens a checkout for them alone,
          with the ways to pay that work where they are.
        </p>
        <p>Opening the link creates nothing, so chat apps can preview it safely. Turn a link off when you stop selling the item, and back on later.</p>
      </Feature>
      <Feature title="Priced like everything else" tone="paper">
        <p>
          {pricing.partnerProcessed.rate} per successful payment, max {pricing.partnerProcessed.cap}, plus the partner&apos;s
          fee. {pricing.payroutaOnly.rate} for stablecoins, all in. No setup or monthly fees.
        </p>
        <TextLink href={paths.pricing}>See pricing</TextLink>
      </Feature>
    </>
  );
}

function ButtonPreview() {
  return (
    <div className="pp-code-card">
      <pre className="aa-code" tabIndex={0}>
        <code>{`<script src="${origin()}/js/v1/payrouta.js" async></script>

<button data-payrouta-checkout="/create-checkout">
  Checkout
</button>`}</code>
      </pre>
      <div className="pp-code-result" aria-hidden="true">
        <span className="pp-shop-line" />
        <span className="pp-shop-line short" />
        <span className="pp-shop-btn">Checkout</span>
      </div>
    </div>
  );
}

function Checkout() {
  return (
    <>
      <PageHero
        title="One button. Every way to pay."
        actions={
          <>
            <Btn href={paths.signUp}>Get started</Btn>
            <Btn href={docsUrl("checkout-button")} variant="secondary">
              Checkout button guide
            </Btn>
          </>
        }
        visual={<ButtonPreview />}
      />
      <Feature
        title="Add it where you sell"
        tone="paper"
        visual={
          <AddAnywhere
            initial="html"
            origin={origin()}
            statuses={{
              link: status("No website"),
              html: status("Any website or app"),
              server: status("Your own server"),
              agents: status("AI agents"),
              shopify: status("Shopify"),
              woocommerce: status("WooCommerce"),
            }}
          />
        }
      >
        <p>A script tag and a button on any site, an SDK call from your server, or the PayRouta app in your store.</p>
        <PlatformList />
      </Feature>
      <Feature title="If a partner is down, the payment still goes through">
        <p>
          PayRouta sends each payment through a licensed partner for that method and country. When one fails, the same
          payment is retried on a backup, and you&apos;re only charged once it succeeds.
        </p>
        <PaymentFlow />
      </Feature>
      <Feature title="Built for developers too" tone="paper">
        <p>Node and Python SDKs, signed webhooks, idempotent requests and a test mode that costs nothing.</p>
        <div className="mk-actions">
          <TextLink href={docsUrl("quickstart")}>Quickstart</TextLink>
          <TextLink href={docsUrl("api-reference")}>API reference</TextLink>
        </div>
      </Feature>
    </>
  );
}

function Credit() {
  const live = creditLive();
  return (
    <>
      <PageHero
        title="Customers pay over time. You're paid today."
        actions={
          <>
            <Btn href={paths.signUp}>Get started</Btn>
            <Btn href={docsUrl("credit")} variant="secondary">
              How credit works
            </Btn>
          </>
        }
        visual={<CreditTimeline />}
      />
      {!live && (
        <div className="mk-wrap">
          <p className="pp-notice">
            Credit opens country by country as licensed lenders join PayRouta. You can try it in test mode today with a
            test lender.
          </p>
        </div>
      )}
      <Feature title="How it works" tone="paper">
        <Steps
          steps={[
            "Customer picks a plan",
            "Lender approves",
            "You get the full price",
            "Customer repays the lender",
          ]}
        />
      </Feature>
      <Feature title="Continental credit & asynchronous settlement">
        <ContinentalCreditMap />
      </Feature>
      <Feature title="The lender carries the risk" tone="paper">
        <p>
          Affordability checks, consumer-credit disclosures and collecting repayments are the lender&apos;s, under its
          licence. If a customer stops paying, you keep your money.
        </p>
      </Feature>
      <section className="pp-band pp-night">
        <div className="mk-wrap pp-cta-row">
          <div>
            <h2 className="mk-h2">Are you a lender?</h2>
            <p>Offer your plans at every PayRouta checkout in the countries you lend in.</p>
          </div>
          <Link className="mk-btn primary" href={`${paths.partners}#request`}>
            Become a credit partner
          </Link>
        </div>
      </section>
    </>
  );
}

function Crypto() {
  return (
    <>
      <PageHero
        title="Take crypto from any wallet, on any chain."
        actions={
          <>
            <Btn href={paths.signUp}>Get started</Btn>
            <Btn href={docsUrl("crypto-payments")} variant="secondary">
              Crypto guide
            </Btn>
          </>
        }
      />
      <section className="pp-band pp-night pp-flush-top">
        <div className="mk-wrap">
          <CryptoRoute />
        </div>
      </section>
      <Feature title="Straight to your own wallet">
        <p>
          USDC, USDT and EURC, and major coins, on Ethereum, Base, Arbitrum, Polygon, Avalanche, Solana, Arc and Stellar.
          Payments arrive in the wallet you name. PayRouta never holds them.
        </p>
      </Feature>
      <Feature title="Whatever your customer holds" tone="paper">
        <p>
          Customers can pay with any of 125+ assets on 36+ chains. PayRouta converts it on the way and you receive
          exactly the amount you asked for. If a payment can&apos;t complete, the customer is refunded.
        </p>
        <TextLink href={docsUrl("cross-chain")}>Paying from another chain</TextLink>
      </Feature>
      <Feature title={`${pricing.payroutaOnly.rate}, all in`}>
        <p>No partner fee and no network markup from us. Our fee is billed monthly; failed payments and test mode are free.</p>
        <TextLink href={paths.pricing}>See pricing</TextLink>
      </Feature>
    </>
  );
}

function Pricing() {
  const { partnerProcessed: partner, payroutaOnly: direct } = pricing;
  return (
    <>
      <PageHero title="Pay only for payments that succeed" />
      <section className="pp-band pp-flush-top">
        <div className="mk-wrap">
          <div className="pr-plans">
            <section className="pr-plan pr-plan-main" aria-labelledby="plan-partner">
              <h2 id="plan-partner">Cards, wallets, bank, mobile money, USSD, credit</h2>
              <strong>{partner.rate}</strong>
              <p>
                per successful payment, max {partner.cap}, plus the standard fee of the partner or lender that processed it,
                at cost. Taken from each payment.
              </p>
              <Link className="mk-btn primary" href={paths.signUp}>
                Get started
              </Link>
            </section>
            <section className="pr-plan" aria-labelledby="plan-crypto">
              <h2 id="plan-crypto">Stablecoins and crypto</h2>
              <strong>{direct.rate}</strong>
              <p>all in. No partner fee. The coins go straight to your wallet; our fee is billed monthly.</p>
            </section>
            <section className="pr-plan" aria-labelledby="plan-free">
              <h2 id="plan-free">Failed payments, backup retries, test mode</h2>
              <strong>$0</strong>
              <p>You only pay when a payment succeeds. No setup or monthly fees.</p>
            </section>
          </div>
        </div>
      </section>
      <section className="pp-band pp-paper">
        <div className="mk-wrap pr-details">
          <div>
            <h2 className="mk-h3">Who pays the fees</h2>
            <p>
              You choose. Absorb them, or have them added at checkout so you receive your full price. The customer sees
              the fee as its own line before paying. Set a default in your dashboard and override it on any payment.
              Businesses in the EU and UK can&apos;t add card or bank fees for customers; the law there forbids it.
            </p>
            <h3 className="mk-h3">A $100 card order at 2.9% + 30¢</h3>
            <FeeBars />
          </div>
          <div>
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
            <h2 className="mk-h3">Everything else</h2>
            <p>
              Fees on a refunded payment aren&apos;t returned. Above {pricing.volumeThreshold},{" "}
              <Link href={`${paths.contact}?intent=pricing`}>ask about volume rates</Link>. The details are in the{" "}
              <a href={docsUrl("billing")}>billing docs</a>.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}

function Partners() {
  return (
    <>
      <PageHero title="Reach every merchant on PayRouta" />
      <section className="pp-band pp-flush-top" aria-labelledby="pa-where">
        <div className="mk-wrap">
          <h2 className="mk-h2" id="pa-where">
            Where you fit
          </h2>
          <PartnerMap />
        </div>
      </section>
      <section className="pp-band pp-paper" aria-labelledby="pa-live">
        <div className="mk-wrap">
          <h2 className="mk-h2" id="pa-live">
            Going live
          </h2>
          <JoinSteps />
        </div>
      </section>
      <section className="pp-band">
        <div className="mk-wrap mk-contact">
          <div className="mk-contact-form" id="request">
            <h2 className="mk-box-title">Request provider access</h2>
            <ProviderAccessForm />
          </div>
          <aside className="mk-box">
            <h2 className="mk-box-title">Lenders</h2>
            <p className="mk-box-note">
              Price each plan, approve the customer and pay the merchant; the customer repays you. Choose &ldquo;Lender /
              consumer-credit provider&rdquo; in the form. The contract is in the <a href={docsUrl("credit")}>credit docs</a>.
            </p>
            <h2 className="mk-box-title">Payment providers</h2>
            <p className="mk-box-note">
              Implement the <a href={docsUrl("provider-integration")}>Provider API</a>, or describe your existing API so we
              can map it. Automated checks cover payments, status, idempotency, webhooks, refunds and settlement reports.
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
      </section>
    </>
  );
}

function PlatformList() {
  return (
    <dl className="pp-platforms">
      {platforms.map((p) => (
        <div key={p.name}>
          <dt>{p.name}</dt>
          <dd>
            {p.detail}
            {p.availability !== "available" && <span className="pp-soon"> · {availabilityLabel[p.availability]}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function PricingLine() {
  return (
    <Feature title="Pay only when a payment succeeds" tone="paper">
      <p>
        {pricing.partnerProcessed.rate} per payment, max {pricing.partnerProcessed.cap}, plus the partner&apos;s fee.{" "}
        {pricing.payroutaOnly.rate} for stablecoins and crypto, all in. No setup or monthly fees, and test mode is free.
      </p>
      <TextLink href={paths.pricing}>See pricing</TextLink>
    </Feature>
  );
}

function Integrations() {
  return (
    <>
      <PageHero
        title="Take payments wherever you sell."
        actions={
          <>
            <Btn href={paths.signUp}>Get started</Btn>
            <Btn href={docsUrl("quickstart")} variant="secondary">
              Quickstart
            </Btn>
          </>
        }
        visual={<ButtonPreview />}
      />
      <Feature
        title="Pick where you sell"
        tone="paper"
        visual={
          <AddAnywhere
            initial="shopify"
            origin={origin()}
            statuses={{
              link: status("No website"),
              html: status("Any website or app"),
              server: status("Your own server"),
              agents: status("AI agents"),
              shopify: status("Shopify"),
              woocommerce: status("WooCommerce"),
            }}
          />
        }
      >
        <p>Start with a link today and add the button or a store plugin when you&apos;re ready. Every route ends in the same dashboard.</p>
        <PlatformList />
      </Feature>
      <Feature title="On your own server">
        <p>
          Create a checkout with one call from the Node or Python SDK, send the customer to it, and mark the order paid
          when the signed webhook arrives. Requests are idempotent, so a retry never charges twice.
        </p>
        <div className="mk-actions">
          <TextLink href={docsUrl("sdks")}>SDKs</TextLink>
          <TextLink href={docsUrl("webhooks")}>Webhooks</TextLink>
          <TextLink href={docsUrl("api-reference")}>API reference</TextLink>
        </div>
      </Feature>
    </>
  );
}

const regionId: Record<string, string> = {
  Africa: "africa",
  "Latin America": "latin-america",
  Asia: "asia",
  "Europe and the UK": "europe",
  Worldwide: "worldwide",
};

function PaymentMethods() {
  // Africa first: it's where most of PayRouta's merchants sell.
  const order = Object.keys(regionId);
  const regions = markets.filter((m) => m.name !== "Anywhere").sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
  const anywhere = markets.filter((m) => m.name === "Anywhere");
  return (
    <>
      <PageHero
        title="The ways the world pays, in one checkout."
        actions={
          <>
            <Btn href={paths.signUp}>Get started</Btn>
            <Btn href={docsUrl("payment-methods")} variant="secondary">
              Payment methods guide
            </Btn>
          </>
        }
      />
      <section className="pp-band pp-flush-top">
        <div className="mk-wrap">
          <CoverageGrid />
        </div>
      </section>
      <section className="pp-band pp-paper" aria-labelledby="pm-regions">
        <div className="mk-wrap">
          <h2 className="mk-h2" id="pm-regions">
            By region
          </h2>
          <div className="pm-regions">
            {regions.map((m) => (
              <article key={m.name} id={regionId[m.name]} className="pm-region">
                <h3>{m.name}</h3>
                <p>{m.methods}</p>
                <dl>
                  <dt>Currencies</dt>
                  <dd>{m.currencies}</dd>
                </dl>
                <span className={`pm-state pm-${m.availability}`}>{availabilityLabel[m.availability]}</span>
              </article>
            ))}
          </div>
        </div>
      </section>
      <section className="pp-band" aria-labelledby="pm-anywhere">
        <div className="mk-wrap">
          <h2 className="mk-h2" id="pm-anywhere">
            Anywhere
          </h2>
          <div className="pm-regions">
            {anywhere.map((m) => (
              <article key={m.currencies} className="pm-region">
                <h3>{m.currencies}</h3>
                <p>{m.methods}</p>
                <span className={`pm-state pm-${m.availability}`}>{availabilityLabel[m.availability]}</span>
              </article>
            ))}
            <article className="pm-region pm-credit">
              <h3>Pay with credit</h3>
              <p>Instalments from licensed lenders, country by country.</p>
              <TextLink href={paths.credit}>How credit works</TextLink>
            </article>
          </div>
        </div>
      </section>
      <section className="pp-band pp-paper" aria-labelledby="pm-payouts">
        <div className="mk-wrap">
          <h2 className="mk-h2" id="pm-payouts">
            Where you get paid
          </h2>
          <div className="pm-regions">
            {payouts.map((p) => (
              <article key={p.destination} className="pm-region">
                <h3>{p.destination}</h3>
                <p>{p.detail}</p>
                <span className={`pm-state pm-${p.availability}`}>{availabilityLabel[p.availability]}</span>
              </article>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

function SocialSellers() {
  return (
    <>
      <PageHero
        title="Sell in the chat. Get paid in the chat."
        actions={
          <>
            <Btn href={createLinkHref}>Create a payment link</Btn>
            <Btn href={paths.paymentLinks} variant="secondary">
              How links work
            </Btn>
          </>
        }
        visual={<LinkPicture origin={origin()} />}
      />
      <Feature title="No website, no app, no problem" tone="paper">
        <Steps
          steps={[
            "Post the item",
            "Send buyers the link",
            "Each buyer pays on their own checkout",
          ]}
        />
      </Feature>
      <Feature title="The ways your buyers already pay" visual={<HeroDemo />}>
        <p>
          Bank transfer from any bank app, USSD without data, mobile money, cards and stablecoins. Buyers see the ways
          that work where they are. Cards, banks and mobile money open region by region; stablecoins work today.
        </p>
      </Feature>
      <Feature title="Sell the phone, not just the case" tone="paper" visual={<CreditTimeline />}>
        <p>
          With credit at checkout, a buyer can take a ₦150,000 phone home today and repay a licensed lender over six
          weeks. You&apos;re paid in full. {!creditLive() && "Credit opens country by country as lenders join."}
        </p>
        <TextLink href={paths.credit}>Pay with credit</TextLink>
      </Feature>
      <PricingLine />
    </>
  );
}

function OnlineStores() {
  return (
    <>
      <PageHero
        title="Every way to pay at your store's checkout."
        actions={
          <>
            <Btn href={paths.signUp}>Get started</Btn>
            <Btn href={paths.integrations} variant="secondary">
              Integrations
            </Btn>
          </>
        }
        visual={<HeroDemo initial="gb" />}
      />
      <Feature title="Add it to the store you have" tone="paper">
        <p>One button on any site, the PayRouta Checkout plugin for WooCommerce, or a Pay button on your Shopify order pages.</p>
        <PlatformList />
      </Feature>
      <Feature title="A backup partner for every payment">
        <p>
          When a partner is down, the same payment goes through another, so a busy weekend isn&apos;t lost to someone
          else&apos;s outage. You pay only for payments that succeed.
        </p>
        <PaymentFlow />
      </Feature>
      <Feature title="Bigger baskets, paid over time" tone="paper" visual={<CreditTimeline />}>
        <p>
          Customers who can&apos;t pay all at once can spread the cost with a licensed lender. You&apos;re paid in full;
          the lender carries the risk. {!creditLive() && "Opening country by country as lenders join."}
        </p>
        <TextLink href={paths.credit}>Pay with credit</TextLink>
      </Feature>
      <PricingLine />
    </>
  );
}

function Saas() {
  return (
    <>
      <PageHero
        title="Sell worldwide. Let every customer pay their way."
        actions={
          <>
            <Btn href={paths.signUp}>Get started</Btn>
            <Btn href={docsUrl("quickstart")} variant="secondary">
              Quickstart
            </Btn>
          </>
        }
        visual={<HeroDemo initial="anywhere" />}
      />
      <Feature title="A yearly plan, paid monthly" tone="paper">
        <p>
          Sell the year upfront and get paid for it today. Your customer repays a licensed lender monthly, so the annual
          price stops being a barrier. {!creditLive() && "Credit opens country by country as lenders join."}
        </p>
        <TextLink href={paths.credit}>Pay with credit</TextLink>
      </Feature>
      <section className="pp-band pp-night">
        <div className="mk-wrap">
          <h2 className="mk-h2">Customers with no card can pay in stablecoins</h2>
          <CryptoRoute />
        </div>
      </section>
      <Feature title="Fits the stack you have">
        <p>Create checkouts from your server with the Node or Python SDK and grant access when the signed webhook arrives.</p>
        <div className="mk-actions">
          <TextLink href={docsUrl("sdks")}>SDKs</TextLink>
          <TextLink href={docsUrl("webhooks")}>Webhooks</TextLink>
        </div>
      </Feature>
      <PricingLine />
    </>
  );
}

// Agentic payments: agents pay links over HTTP within their key's limits,
// and a merchant's assistant runs payments over MCP (lib/agents, lib/mcp).
function Agents() {
  return (
    <>
      <PageHero
        title="AI agents pay you. Your assistant runs your payments."
        actions={
          <>
            <Btn href={paths.signUp}>Get started</Btn>
            <Btn href={docsUrl("agents")} variant="secondary">
              Agents guide
            </Btn>
          </>
        }
      />
      <Feature title="Agents pay your payment links" visual={<AgentTerms />}>
        <p>
          Any payment link answers an AI agent with 402 Payment Required: the price, and how it can pay. The agent opens its
          own checkout and sends the exact transfer from its wallet, or signs one transfer from its NEAR Intents balance with
          no gas. You&apos;re paid, settled and notified as for any customer.
        </p>
        <TextLink href={docsUrl("agents")}>Agent API</TextLink>
      </Feature>
      <Feature title="Limits on every agent key" tone="paper" visual={<AgentKeyCard />}>
        <p>
          Give an agent a key with a budget per day, week or month, a most-per-payment, and the merchants it may pay.
          PayRouta checks every payment against them before preparing it. Revoke the key and the agent stops.
        </p>
      </Feature>
      <Feature title="Run your payments from your AI assistant" visual={<AssistantTools />}>
        <p>
          Connect Claude or any MCP client to PayRouta with an API key. Your assistant creates checkouts and payment links,
          finds payments and issues refunds, with only the permissions you gave the key.
        </p>
        <TextLink href={docsUrl("mcp")}>MCP server</TextLink>
      </Feature>
    </>
  );
}

function AgentTerms() {
  return (
    <pre className="aa-code ag-code" tabIndex={0} aria-label="A payment link's answer to an AI agent">
      <code>{`GET /api/agent/v1/links/k3Fd92xQ

402 Payment Required
{
  "merchant": "Synth Labs",
  "title": "API credits",
  "amount": "25.00",
  "currency": "USD",
  "accepts": [
    { "method": "wallet" },
    {
      "method": "intents",
      "network": "near:mainnet"
    }
  ]
}`}</code>
    </pre>
  );
}

function AgentKeyCard() {
  return (
    <div className="ag-key" aria-label="An agent key and its limits">
      <div className="ag-key-head">
        <strong>Procurement agent</strong>
        <code>pra_production_9xQ…</code>
      </div>
      <div className="ag-key-bar" aria-hidden="true">
        <i style={{ width: "62%" }} />
      </div>
      <dl>
        <div>
          <dt>Spent this week</dt>
          <dd>$310 of $500</dd>
        </div>
        <div>
          <dt>Most per payment</dt>
          <dd>$100</dd>
        </div>
        <div>
          <dt>Merchants</dt>
          <dd>3 allowed</dd>
        </div>
      </dl>
    </div>
  );
}

function AssistantTools() {
  return (
    <ul className="ag-tools" aria-label="What your assistant can do">
      {["create_checkout", "create_payment_link", "list_payment_links", "list_payments", "get_payment", "refund_payment"].map((t) => (
        <li key={t}>
          <code>{t}</code>
        </li>
      ))}
    </ul>
  );
}

export const pageComponents: Record<PageSlug, () => React.ReactNode> = {
  "payment-links": PaymentLinks,
  checkout: Checkout,
  integrations: Integrations,
  "payment-methods": PaymentMethods,
  credit: Credit,
  crypto: Crypto,
  agents: Agents,
  "social-sellers": SocialSellers,
  "online-stores": OnlineStores,
  saas: Saas,
  pricing: Pricing,
  partners: Partners,
};
