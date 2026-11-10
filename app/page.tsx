import Link from "next/link";
import { HeroStage } from "@/components/marketing/hero";
import { DevTabs } from "@/components/marketing/dev-tabs";
import { Figure, Marquee, RiseWords } from "@/components/marketing/motion";
import { TokenBand } from "@/components/marketing/token-band";
import { StorePlatforms } from "@/components/marketing/commerce";
import { SettleChooser } from "@/components/marketing/settle";
import { LinkPicture } from "@/components/marketing/add-anywhere";
import { CoverageGrid, CreditTimeline, PaymentFlow } from "@/components/marketing/diagrams";
import {
  ArrowLeftRight,
  Blocks,
  Bot,
  Braces,
  FlaskConical,
  Globe,
  Landmark,
  LineChart,
  ReceiptText,
  ShieldCheck,
  Undo2,
  Webhook,
  type LucideIcon,
} from "lucide-react";
import { figures, payouts, pillars, publicLabel, settleIn, waysToPay } from "@/content/claims";
import { createLinkHref, docsUrl, trustedOrigin, paths } from "@/lib/site-config";
import { instalmentOffer } from "@/lib/treasury/credit";

// The phone in the payment-link tile, in 4 payments two weeks apart, first
// one today: the plan checkout shows, from its own arithmetic.
const naira = (minor: bigint) => `₦${(Number(minor) / 100).toLocaleString("en-NG", { maximumFractionDigits: 0 })}`;
const phonePlan = instalmentOffer({
  id: "preview",
  lender: "",
  termsUrl: "",
  amountMinor: 15000000n,
  instalments: 4,
  interval: "two-weeks",
  costBps: 0,
  aprBasisPoints: null,
  firstDueToday: true,
});

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

type Capability = { icon: LucideIcon; title: string; text: string; href: string; label?: string };
const bankPayouts = payouts.find((p) => p.destination === "Bank account")!.availability;

// What runs after the payment, and what developers and agents build on.
const operations: Capability[] = [
  {
    icon: Landmark,
    title: "Balances and payouts",
    text: "See what's available and what's on its way, then pay out to your bank on your schedule. Crypto lands in your own wallet.",
    href: docsUrl("settlement"),
    label: publicLabel(bankPayouts),
  },
  {
    icon: ArrowLeftRight,
    title: "Cash out crypto",
    text: "Turn your crypto balance into money in a bank account or mobile money wallet.",
    href: docsUrl("cash-out"),
  },
  {
    icon: Undo2,
    title: "Refunds and disputes",
    text: "Refund in full or in part, and answer a dispute with evidence before its deadline.",
    href: docsUrl("refunds-disputes"),
  },
  {
    icon: ReceiptText,
    title: "Customers can pay the fees",
    text: "Absorb fees, or add them at checkout so you receive your full price.",
    href: docsUrl("billing"),
  },
  {
    icon: Globe,
    title: "Local payment methods",
    text: "Pix in Brazil, M-Pesa in Kenya, bank transfer in Nigeria: shown first, under the name customers know.",
    href: paths.paymentMethods,
  },
  {
    icon: Blocks,
    title: "Shopify and WooCommerce",
    text: "A Pay button after Shopify checkout, and a plugin for WooCommerce.",
    href: paths.integrations,
  },
  {
    icon: LineChart,
    title: "Analytics and payment issues",
    text: "Conversion, payments saved by a backup processor, and every reconciliation difference in one place.",
    href: docsUrl("settlement"),
  },
  {
    icon: ShieldCheck,
    title: "Teams and security",
    text: "Roles for your team, passkeys, an authenticator for sensitive actions, and single sign-on.",
    href: docsUrl("teams"),
  },
];
const developers: Capability[] = [
  { icon: Braces, title: "API and SDKs", text: "One call per order from Node or Python, or plain HTTP.", href: docsUrl("api-reference") },
  { icon: Webhook, title: "Webhooks", text: "Signed events for payments, settlements and subscriptions.", href: docsUrl("webhooks") },
  {
    icon: Bot,
    title: "MCP server",
    text: "Your assistant runs payments with an API key; a buyer's agent pays with an agent key.",
    href: docsUrl("mcp"),
  },
  { icon: FlaskConical, title: "Test mode", text: "Every flow end to end with test money before you go live.", href: docsUrl("quickstart") },
];

function Capabilities({ items, label }: { items: Capability[]; label: string }) {
  return (
    <ul className="hp-caps" aria-label={label} data-reveal="stagger">
      {items.map(({ icon: Icon, title, text, href, label: status }) => (
        <li key={title}>
          <Link className="hp-cap" href={href}>
            <span className="hp-cap-icon" aria-hidden="true">
              <Icon size={20} strokeWidth={1.75} />
            </span>
            <span className="hp-cap-title">
              {title}
              {status && <span className="hp-cap-status">{status}</span>}
            </span>
            <span>{text}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

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
            <h1 className="hp-h1">
              <RiseWords text="One checkout for every way the world pays." />
            </h1>
            <div className="hp-cta">
              <Link className="mk-btn primary lg" href={createLinkHref}>
                Create a payment link <span aria-hidden="true">→</span>
              </Link>
              <Link className="mk-btn ghost-dark lg" href={paths.integrations}>
                Add to Shopify or WooCommerce
              </Link>
            </div>
          </div>
          <HeroStage />
        </div>
        <Marquee items={waysToPay} label="Ways customers pay" />
      </section>

      <section className="hp-figures" aria-label="PayRouta in numbers">
        <div className="mk-wrap hp-figures-row" data-reveal="stagger">
          {figures.map((f) => (
            <Figure key={f.label} {...f} />
          ))}
        </div>
      </section>

      <section className="hp-sec hp-paper hp-commerce" aria-labelledby="commerce-h">
        <div className="mk-wrap">
          <h2 className="hp-h2" id="commerce-h" data-reveal>
            Sell on Shopify and WooCommerce.
          </h2>
          <StorePlatforms />
        </div>
      </section>

      <section className="hp-sec" aria-labelledby="products-h">
        <div className="mk-wrap">
          <h2 className="hp-h2" id="products-h" data-reveal>
            Sell in a chat, on a site or in a store.
          </h2>
          <div className="hp-bento" data-reveal="stagger">
            <Link data-tilt className="hp-tile hp-tile-links" href={paths.paymentLinks}>
              <span className="hp-tile-text">
                <span className="hp-tile-title">Payment links</span>
                <span>No website? Create a link and share it on WhatsApp, Instagram or by SMS.</span>
                <More>Payment links</More>
              </span>
              <LinkPicture origin={origin} />
            </Link>
            <Link data-tilt className="hp-tile hp-tile-button" href={paths.checkout}>
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
            <Link data-tilt className="hp-tile hp-tile-credit" href={paths.credit}>
              <span className="hp-tile-text">
                <span className="hp-tile-title">Pay with credit</span>
                <span>
                  Customers spread the cost with a licensed lender. You&apos;re paid in full today.
                  {!creditLive && " Opening country by country."}
                </span>
                <More>Pay with credit</More>
              </span>
              <span className="hp-mini-plan" aria-hidden="true">
                {["Today", "2 weeks", "4 weeks", "6 weeks"].map((when) => (
                  <i key={when}>
                    <b>{naira(BigInt(phonePlan.instalmentMinor))}</b>
                    {when}
                  </i>
                ))}
              </span>
            </Link>
            <Link data-tilt className="hp-tile hp-tile-crypto" href={paths.crypto}>
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
            <Link data-tilt className="hp-tile hp-tile-subs" href={paths.subscriptions}>
              <span className="hp-tile-text">
                <span className="hp-tile-title">Subscriptions</span>
                <span>Bill every month for a price, for usage, or both. Customers pay each invoice from any wallet.</span>
                <More>Subscriptions</More>
              </span>
              <span className="hp-mini-invoice" aria-hidden="true">
                <i>
                  Pro <b>$20.00</b>
                </i>
                <i>
                  API calls × 3,200 <b>$6.40</b>
                </i>
                <i className="hp-mini-total">
                  Due <b>$26.40</b>
                </i>
              </span>
            </Link>
            <Link data-tilt className="hp-tile hp-tile-agents" href={paths.agents}>
              <span className="hp-tile-text">
                <span className="hp-tile-title">AI agents</span>
                <span>Agents pay your links and invoices over HTTP, within the limits you set. Your assistant runs payments over MCP.</span>
                <More>Agentic payments</More>
              </span>
              <span className="hp-mini-code" aria-hidden="true">
                <code>{"402 Payment Required"}</code>
                <code>{'"amount": "25.00", "accepts": ["wallet", "intents"]'}</code>
              </span>
            </Link>
          </div>
        </div>
      </section>

      <section className="hp-sec hp-paper" aria-labelledby="settle-h">
        <div className="mk-wrap">
          <h2 className="hp-h2" id="settle-h" data-reveal>
            Customers pay with anything. You&apos;re settled in what you choose.
          </h2>
          <div data-reveal>
            <SettleChooser
              options={settleIn.map((o) => ({
                id: o.id,
                name: o.name,
                detail: o.detail,
                label: publicLabel(o.availability),
              }))}
            />
          </div>
        </div>
      </section>

      <section className="hp-sec hp-night hp-flow" aria-labelledby="flow-h">
        <div className="mk-wrap">
          <div className="hp-flow-head" data-reveal>
            <h2 className="hp-h2" id="flow-h">
              Any token, any chain. Settled through NEAR Intents.
            </h2>
            <Link className="hp-link" href={paths.crypto}>
              Crypto payments <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>
        <TokenBand />
      </section>

      <section className="hp-sec" aria-labelledby="credit-h">
        <div className="mk-wrap hp-split">
          <div className="hp-text" data-reveal>
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
          <div data-reveal>
            <CreditTimeline />
          </div>
        </div>
      </section>

      <section className="hp-sec hp-paper" aria-labelledby="how-h">
        <div className="mk-wrap">
          <h2 className="hp-h2" id="how-h" data-reveal>
            How a payment moves
          </h2>
          <div data-reveal>
            <PaymentFlow />
          </div>
        </div>
      </section>

      <section className="hp-sec" aria-labelledby="cov-h">
        <div className="mk-wrap">
          <h2 className="hp-h2" id="cov-h" data-reveal>
            Where customers can pay
          </h2>
          <div data-reveal>
            <CoverageGrid />
          </div>
        </div>
      </section>

      <section className="hp-sec hp-night hp-dev" aria-labelledby="dev-h">
        <div className="mk-wrap hp-dev-grid">
          <div className="hp-dev-copy" data-reveal>
            <h2 className="hp-h2" id="dev-h">
              For developers and their agents
            </h2>
            <div className="hp-dev-links">
              <a className="hp-link" href={docsUrl("quickstart")}>
                Quickstart <span aria-hidden="true">→</span>
              </a>
              <a className="hp-link" href={docsUrl("api-reference")}>
                API reference <span aria-hidden="true">→</span>
              </a>
            </div>
          </div>
          <div data-reveal>
            <DevTabs origin={origin} />
          </div>
        </div>
        <div className="mk-wrap">
          <Capabilities items={developers} label="For developers" />
        </div>
      </section>

      <section className="hp-sec" aria-labelledby="ops-h">
        <div className="mk-wrap">
          <h2 className="hp-h2" id="ops-h" data-reveal>
            Everything after the payment.
          </h2>
          <Capabilities items={operations} label="Running your payments" />
        </div>
      </section>

      <section className="hp-sec hp-doors" aria-label="For lenders and payment providers">
        <div className="mk-wrap hp-doors-grid" data-reveal="stagger">
          <Link data-tilt className="hp-door" href={`${paths.partners}#request`}>
            <span className="hp-door-title">Lenders</span>
            <More>Become a credit partner</More>
          </Link>
          <Link data-tilt className="hp-door" href={`${paths.partners}#request`}>
            <span className="hp-door-title">Payment providers</span>
            <More>Request provider access</More>
          </Link>
        </div>
      </section>
    </div>
  );
}
