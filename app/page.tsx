import Link from "next/link";
import {
  ArrowRight,
  Building2,
  CreditCard,
  Smartphone,
  Coins,
  Wallet,
  CheckCircle2,
  Layers,
  Sparkles,
} from "lucide-react";
import { ProductShowcase } from "@/components/product-showcase";
import { trustedOrigin, paths } from "@/lib/site-config";

export const metadata = {
  title: "PayRouta — Multi-Provider Payment Network & Routing",
  description:
    "Accept more payments. Lose fewer customers. PayRouta connects your business to multiple payment providers and automatically uses an available route when a customer pays.",
  alternates: trustedOrigin() ? { canonical: "/" } : undefined,
};

const supportedMethods = [
  {
    icon: Building2,
    title: "Instant Bank Transfers",
    badge: "Direct Clearing",
    description:
      "Instant account-to-account payments with real-time settlement confirmation across Africa (NIP), Europe (SEPA Instant), US (FedNow / RTP), and Brazil (Pix).",
    coverage: ["Nigeria (NIP)", "Europe (SEPA)", "USA (FedNow)", "Brazil (Pix)"],
  },
  {
    icon: CreditCard,
    title: "Global & Domestic Cards",
    badge: "Auto-Failover",
    description:
      "Full scheme support for Visa, Mastercard, and Verve with intelligent same-method routing that switches processors silently if acquiring channels degrade.",
    coverage: ["Visa", "Mastercard", "Verve", "Domestic Schemes"],
  },
  {
    icon: Smartphone,
    title: "Mobile Money & USSD",
    badge: "Instant Push",
    description:
      "High-converting mobile money workflows with instant push-to-pay prompts for MTN MoMo, M-Pesa, Airtel Money, and bank USSD strings.",
    coverage: ["MTN MoMo", "M-Pesa", "Airtel Money", "USSD"],
  },
  {
    icon: Coins,
    title: "Direct Stablecoins (USDC)",
    badge: "On-Chain Finality",
    description:
      "Accept USDC natively on Base and Ethereum with sub-second transaction observation, deterministic finality, and zero chargeback risk.",
    coverage: ["Base Mainnet", "Ethereum", "Arbitrum", "Polygon"],
  },
  {
    icon: Wallet,
    title: "Digital Wallets",
    badge: "One-Tap",
    description:
      "One-tap checkout with Apple Pay, Google Pay, and leading regional super-apps including OPay and PalmPay.",
    coverage: ["Apple Pay", "Google Pay", "OPay", "PalmPay"],
  },
  {
    icon: Layers,
    title: "Unified Settlement",
    badge: "Treasury",
    description:
      "Regardless of how your customers choose to pay, receive automatic daily settlement and unified reconciliation in your preferred treasury currency.",
    coverage: ["NGN Bank Accounts", "USD", "EUR", "USDC Vaults"],
  },
];

const faqs = [
  {
    q: "How does PayRouta prevent failed payments?",
    a: "When a customer initiates a payment, PayRouta evaluates live operational availability, historical success rates, and provider health. If a provider experiences latency or downtime, PayRouta automatically routes through a healthy backup provider within that exact same payment method. The customer completes their checkout seamlessly without seeing an error.",
  },
  {
    q: "Does PayRouta replace our existing payment providers?",
    a: "No. PayRouta is the routing and orchestration intelligence. Underlying payment processors (like Monnify, Paystack, Flutterwave, or your preferred merchant acquirers) perform the regulated fiat execution. PayRouta coordinates eligibility, availability, routing, reconciliation, and failover.",
  },
  {
    q: "How does settlement work if customers pay with different methods?",
    a: "Settlement is completely unified. Whether customers pay with bank transfer, card, mobile money, or USDC, PayRouta tracks and reconciles each transaction against provider settlement batches. Funds are deposited directly to your bank account or treasury wallet in your chosen settlement currency.",
  },
  {
    q: "Can external payment providers register on PayRouta?",
    a: "Yes. Payment processors, banks, and acquirers can self-register on the PayRouta Provider Portal, declare their supported capabilities (countries, currencies, methods), submit compliance documentation, and pass automated sandbox certification before going live.",
  },
  {
    q: "How quickly can our engineering team integrate PayRouta?",
    a: "Most teams integrate in under an hour using our official Node.js / TypeScript (`@payrouta/server`) or Python (`payrouta`) SDKs. One payment intent integration gives you access to every payment method with zero custom adapter maintenance.",
  },
];

export default function Home() {
  return (
    <div className="landing-page-root">
      {/* HERO SECTION */}
      <section className="hero-section dark">
        <div className="container hero-container">
          <div className="hero-text-content">
            <div className="hero-live-pill">
              <span className="pulsing-green-dot" />
              <span>Multi-Provider Payment Network</span>
            </div>

            <h1 className="hero-headline">
              Accept more payments.
              <br />
              <span className="hero-highlight">Lose fewer customers.</span>
            </h1>

            <p className="hero-subhead">
              PayRouta connects your business to multiple payment providers and
              automatically uses an available route when a customer pays.
              Integrate once; accept bank transfers, cards, mobile money, and
              stablecoins with unified settlement.
            </p>

            <div className="hero-cta-group">
              <Link href="/merchant" className="hero-btn-primary">
                Open Merchant Dashboard <ArrowRight size={16} />
              </Link>
              <Link href="/checkout/demo" className="hero-btn-secondary">
                <Sparkles size={15} /> Try Checkout Demo
              </Link>
              <Link href={paths.docs} className="hero-link-docs">
                View API Docs →
              </Link>
            </div>

            <div className="hero-metrics-strip">
              <div className="metric-item">
                <strong>99.98%</strong>
                <span>Network uptime</span>
              </div>
              <div className="metric-divider" />
              <div className="metric-item">
                <strong>0</strong>
                <span>Single points of failure</span>
              </div>
              <div className="metric-divider" />
              <div className="metric-item">
                <strong>&lt; 600ms</strong>
                <span>Route resolution</span>
              </div>
              <div className="metric-divider" />
              <div className="metric-item">
                <strong>10+</strong>
                <span>Payment methods</span>
              </div>
            </div>
          </div>

          {/* INTERACTIVE PRODUCT SHOWCASE CENTERPIECE */}
          <div className="hero-showcase-wrapper">
            <ProductShowcase />
          </div>
        </div>
      </section>

      {/* FAILOVER & ROUTING SECTION */}
      <section className="section bg-light">
        <div className="container">
          <div className="section-header-centered">
            <span className="eyebrow-tag">Intelligent Resilience</span>
            <h2>One payment network. Automatic same-method failover.</h2>
            <p>
              When a payment provider has an outage or bank downtime, single-provider businesses lose sales.
              PayRouta monitors provider health in real-time and silently re-routes transactions within the same payment method.
            </p>
          </div>

          <div className="comparison-grid">
            <div className="comparison-card single-provider">
              <div className="comp-card-badge error">Single Provider Setup</div>
              <h3>Provider Outage = Lost Customer</h3>
              <p>
                If your sole provider experiences API errors, maintenance, or degraded bank rails, 100% of your checkouts fail.
              </p>
              <ul className="comp-list">
                <li className="bad">Customer sees &quot;Payment Failed&quot; and abandons cart</li>
                <li className="bad">Zero automated redundancy or fallback</li>
                <li className="bad">Engineering team spends hours managing manual failover</li>
                <li className="bad">Separate integrations required for every new country</li>
              </ul>
            </div>

            <div className="comparison-card payrouta-network">
              <div className="comp-card-badge success">PayRouta Multi-Provider Network</div>
              <h3>Continuous Availability = Recovered Revenue</h3>
              <p>
                PayRouta continuously evaluates operational health. If Provider A stumbles, Provider B fulfills the exact same payment method.
              </p>
              <ul className="comp-list">
                <li className="good"><CheckCircle2 size={16} /> Buyer completes purchase without disruption</li>
                <li className="good"><CheckCircle2 size={16} /> Automatic same-method failover (Monnify ↔ Paystack ↔ Flutterwave)</li>
                <li className="good"><CheckCircle2 size={16} /> Unified settlement, transaction states, and reconciliation</li>
                <li className="good"><CheckCircle2 size={16} /> One integration covers bank transfers, cards, mobile money, and crypto</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* SUPPORTED PAYMENT METHODS */}
      <section className="section">
        <div className="container">
          <div className="section-header-centered">
            <span className="eyebrow-tag">Complete Coverage</span>
            <h2>Every way your customers want to pay.</h2>
            <p>
              Give your buyers the local payment methods they trust, while your finance team receives unified settlement in your currency of choice.
            </p>
          </div>

          <div className="payment-methods-grid">
            {supportedMethods.map((method) => {
              const Icon = method.icon;
              return (
                <div key={method.title} className="payment-method-card">
                  <div className="method-card-top">
                    <div className="method-icon-bubble">
                      <Icon size={20} />
                    </div>
                    <span className="method-badge">{method.badge}</span>
                  </div>
                  <h3>{method.title}</h3>
                  <p>{method.description}</p>
                  <div className="coverage-tags">
                    {method.coverage.map((tag) => (
                      <span key={tag} className="tag-chip">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* 3-STEP FLOW SECTION */}
      <section className="section bg-light">
        <div className="container">
          <div className="section-header-centered">
            <span className="eyebrow-tag">Simple Workflow</span>
            <h2>How PayRouta works behind the scenes.</h2>
            <p>
              Your customers experience a frictionless checkout. Your business gets enterprise-grade routing.
            </p>
          </div>

          <div className="steps-cards-row">
            <div className="step-card">
              <span className="step-num">01</span>
              <h3>Customer Selects Method</h3>
              <p>
                At checkout, the customer chooses from normalized methods they recognize: Bank Transfer, Card, Mobile Money, or Stablecoins.
              </p>
            </div>
            <div className="step-card">
              <span className="step-num">02</span>
              <h3>Intelligent Route Selection</h3>
              <p>
                PayRouta evaluates compliance, fees, and real-time provider availability to route the attempt through the best available processor.
              </p>
            </div>
            <div className="step-card">
              <span className="step-num">03</span>
              <h3>Unified Settlement</h3>
              <p>
                The payment confirms instantly. Funds are reconciled into your journal ledger and settled to your treasury account automatically.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* DEVELOPER SECTION */}
      <section className="section dark developer-section">
        <div className="container dev-grid">
          <div>
            <span className="eyebrow-tag text-mint">Developer First</span>
            <h2>Integrate in 15 minutes. Never touch another payment adapter.</h2>
            <p className="dev-lead">
              Our official Node.js and Python SDKs provide strict TypeScript definitions,
              runtime validation, automatic idempotency keys, and webhook signature verification out of the box.
            </p>

            <div className="sdk-install-box">
              <div className="sdk-line">
                <span>npm</span>
                <code>npm install @payrouta/server</code>
              </div>
              <div className="sdk-line">
                <span>pip</span>
                <code>pip install payrouta</code>
              </div>
            </div>

            <div className="dev-actions">
              <Link href={paths.docs} className="hero-btn-primary">
                Read Documentation <ArrowRight size={16} />
              </Link>
              <Link href={paths.apiReference} className="hero-btn-secondary">
                OpenAPI Specification
              </Link>
            </div>
          </div>

          <div className="dev-code-card">
            <div className="code-header-bar">
              <div className="code-dots">
                <span /><span /><span />
              </div>
              <span className="code-filename">checkout.ts</span>
            </div>
            <pre className="code-body">
              <code>{`import { PayRouta } from "@payrouta/server";

const payrouta = new PayRouta({
  apiKey: process.env.PAYROUTA_SECRET_KEY,
});

// Create normalized payment intent
const intent = await payrouta.paymentIntents.create({
  amount: "15000.00",
  currency: "NGN",
  reference: "INV-2026-0042",
  customer: { email: "buyer@example.com" },
  acceptedMethods: ["bank_transfer", "card", "stablecoin"],
  settlementCurrency: "NGN",
});

// Redirect customer to secure checkout
return res.redirect(intent.checkoutUrl);`}</code>
            </pre>
          </div>
        </div>
      </section>

      {/* PROVIDER NETWORK SECTION */}
      <section className="section">
        <div className="container provider-invite-card">
          <div className="provider-invite-copy">
            <span className="eyebrow-tag">For Financial Institutions &amp; PSPs</span>
            <h2>Join the PayRouta Provider Network.</h2>
            <p>
              Are you a payment processor, card acquirer, bank, or mobile money operator?
              Self-register your organization, declare your regional capabilities, run automated sandbox certification,
              and receive transaction volume from global merchants.
            </p>
            <div className="provider-buttons">
              <Link href="/provider/onboarding" className="hero-btn-primary">
                Register as Provider <ArrowRight size={16} />
              </Link>
              <Link href="/provider/sign-in" className="hero-btn-secondary">
                Provider Sign In
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ SECTION */}
      <section className="section bg-light">
        <div className="container faq-container">
          <div className="section-header-centered">
            <span className="eyebrow-tag">Got Questions?</span>
            <h2>Frequently asked questions</h2>
          </div>

          <div className="faq-accordion">
            {faqs.map((faq, i) => (
              <details key={i} className="faq-item">
                <summary className="faq-question">
                  <span>{faq.q}</span>
                  <span className="faq-chevron">+</span>
                </summary>
                <div className="faq-answer">
                  <p>{faq.a}</p>
                </div>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* FINAL CTA SECTION */}
      <section className="section dark closing-cta-section">
        <div className="container text-center">
          <h2>Start accepting payments with zero provider lock-in.</h2>
          <p className="cta-sub">
            Launch your merchant workspace in 2 minutes. Test in sandbox, invite your team, and go live.
          </p>
          <div className="cta-buttons-center">
            <Link href="/merchant" className="hero-btn-primary large">
              Launch Merchant Workspace <ArrowRight size={18} />
            </Link>
            <Link href="/checkout/demo" className="hero-btn-secondary large">
              <Sparkles size={16} /> Try Live Checkout Demo
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
