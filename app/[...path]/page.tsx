import { notFound } from "next/navigation";
import { pages, type PageSlug, useCases } from "@/content/marketing";
import { ButtonLink, ClosingCTA, TextLink, Flow } from "@/components/shared";
import { CodeBlock } from "@/components/code-block";
import { MethodFilter } from "@/components/method-filter";
import { MerchantIntegrationVisual } from "@/components/merchant-integration-visual";
import {
  intentExample,
  trustedOrigin,
  marketingPaths,
} from "@/lib/site-config";
export function generateStaticParams() {
  return Object.values(marketingPaths).map((path) => ({
    path: path.slice(1).split("/"),
  }));
}
function pageSlug(path: string[]): PageSlug | undefined {
  return (Object.keys(marketingPaths) as PageSlug[]).find(
    (key) => marketingPaths[key] === "/" + path.join("/"),
  );
}
export async function generateMetadata({
  params,
}: {
  params: Promise<{ path: string[] }>;
}) {
  const { path } = await params;
  const slug = pageSlug(path);
  const p = slug ? pages[slug] : undefined;
  return p
    ? {
        title: p.title,
        description: p.intro,
        alternates: trustedOrigin()
          ? { canonical: slug ? marketingPaths[slug] : undefined }
          : undefined,
      }
    : {};
}
export default async function MarketingPage({
  params,
}: {
  params: Promise<{ path: string[] }>;
}) {
  const { path } = await params;
  const slug = pageSlug(path);
  const p = slug ? pages[slug] : undefined;
  if (!p || !slug) notFound();
  const cta =
    slug === "providers"
      ? {
          primaryHref: "/provider/sign-up",
          primaryText: "Register as Provider",
          secondaryHref: "/docs/provider-integration",
          secondaryText: "Integration specs",
        }
      : slug === "pricing"
        ? {
            primaryHref: "/merchant",
            primaryText: "Get started in Sandbox",
            secondaryHref: "/contact?intent=pricing",
            secondaryText: "Custom enterprise volume",
          }
        : slug === "developers"
          ? {
              primaryHref: "/docs",
              primaryText: "Explore API Docs",
              secondaryHref: "/docs/quickstart",
              secondaryText: "Quickstart guide",
            }
          : slug === "merchants"
            ? {
                primaryHref: "/merchant",
                primaryText: "Open Merchant Console",
                secondaryHref: "/docs",
                secondaryText: "Explore documentation",
              }
            : {
                primaryHref: "/merchant",
                primaryText: "Open Merchant Console",
                secondaryHref: "/docs",
                secondaryText: "Explore documentation",
              };

  return (
    <>
      <section className="page-hero">
        <div className="container">
          <div className="hero-live-pill" style={{ marginBottom: 16, display: "inline-flex" }}>
            <span className="pulsing-green-dot" />
            <span>PayRouta Production Gateway</span>
          </div>
          <h1>{p.headline}</h1>
          <p className="lead">{p.intro}</p>
          <div className="actions">
            <ButtonLink href={cta.primaryHref}>{cta.primaryText}</ButtonLink>
            <TextLink href={cta.secondaryHref}>{cta.secondaryText}</TextLink>
          </div>
        </div>
      </section>
      {slug === "payment-flow" && (
        <div className="container flow-overview">
          <Flow
            steps={[
              "Payment intent",
              "Availability",
              "Customer method selection",
              "Provider routing",
              "Execution",
              "Settlement",
            ]}
          />
          <nav className="anchor-links" aria-label="Payment flow sections">
            {["availability", "checkout", "execution", "settlement"].map(
              (id) => (
                <a key={id} href={"#" + id}>
                  {id === "checkout"
                    ? "Customer checkout"
                    : id[0].toUpperCase() + id.slice(1)}
                </a>
              ),
            )}
          </nav>
        </div>
      )}
      <section className="section">
        <div className="container">
          {slug === "payment-methods" ? (
            <MethodFilter />
          ) : slug === "use-cases" ? (
            useCases.map((c) => (
              <article className="story" key={c.title}>
                <div className="story-grid">
                  <div>
                    <h2>{c.title}</h2>
                    <p>{c.need}</p>
                    <TextLink href="/contact?intent=merchant">
                      Discuss your payment flow
                    </TextLink>
                  </div>
                  <dl>
                    <dt>Payer choice</dt>
                    <dd>{c.choice}</dd>
                    <dt>Eligible route</dt>
                    <dd>{c.route}</dd>
                    <dt>Merchant outcome</dt>
                    <dd>{c.outcome}</dd>
                    <dt>Integration benefit</dt>
                    <dd>{c.benefit}</dd>
                  </dl>
                </div>
                <Flow
                  steps={[
                    "Available methods",
                    "Customer selection",
                    "Eligible provider",
                    "Settlement updates",
                  ]}
                />
              </article>
            ))
          ) : (
            p.sections.map(([title, copy], i) => (
              <article
                className="editorial-row"
                key={title}
                id={
                  slug === "payment-flow"
                    ? [
                        "payment-intent",
                        "availability",
                        "checkout",
                        "provider-routing",
                        "execution",
                        "settlement",
                      ][i]
                    : undefined
                }
              >
                <h2>{title}</h2>
                <p>{copy}</p>
              </article>
            ))
          )}
        </div>
      </section>
      {slug === "payment-flow" && (
        <section className="section cloud">
          <div className="container">
            <div className="content-grid">
              <article className="content-card">
                <h2>Availability asks “can it work?”</h2>
                <p>
                  Evaluate the complete context before presenting a payment
                  method. A method can be unavailable or restricted even when
                  its providers operate in that country.
                </p>
                <TextLink href="/docs/payment-methods">
                  Read the availability model
                </TextLink>
              </article>
              <article className="content-card">
                <h2>Routing asks “which provider?”</h2>
                <p>
                  Compare eligible providers for the chosen method. If none
                  remains before execution, ask the customer to choose again.
                </p>
                <TextLink href="/docs/errors">
                  Understand retry boundaries
                </TextLink>
              </article>
            </div>
            <div className="callout" style={{ marginTop: 32 }}>
              <h3>Pay-in and settlement answer different questions.</h3>
              <p>
                A customer may select a digital-asset pay-in while a merchant
                prefers local currency. That preference needs an eligible
                conversion direction and settlement path; it is not a guarantee.
              </p>
              <TextLink href="/docs/settlement">Explore settlement</TextLink>
            </div>
          </div>
        </section>
      )}
      {slug === "payment-methods" && (
        <section className="section cloud">
          <div className="container split">
            <h2>Availability is more than a location.</h2>
            <div>
              <p>
                Currency, provider capability, limits, compliance, liquidity,
                and current operating status all influence which methods can
                serve a transaction.
              </p>
              <p>
                Examples on this page describe intended categories. They are not
                a list of launched integrations or supported markets.
              </p>
              <TextLink href="/docs/payment-methods">
                Explore availability states
              </TextLink>
            </div>
          </div>
        </section>
      )}
      {slug === "merchants" && (
        <section className="section cloud">
          <div className="container">
            <MerchantIntegrationVisual />
            <div className="callout" style={{ marginTop: 40 }}>
              <h3>Production Checkout &amp; Multi-Rail Treasury</h3>
              <p>
                Embed our modern checkout drawer, dispatch payment links, or integrate directly with the TypeScript or Python SDK.
                When buyers pay through bank transfer, card, mobile money, or Base USDC, funds automatically clear and settle into
                your corporate treasury according to your preferences.
              </p>
            </div>
          </div>
        </section>
      )}
      {slug === "providers" && (
        <section className="section cloud">
          <div className="container split">
            <div>
              <h2>Declare each supported direction.</h2>
              <p>
                A conceptual manifest describes a provider’s execution scope.
                Applicable compliance information and technical behavior are
                reviewed during onboarding.
              </p>
              <Flow steps={["Apply", "Review", "Integrate", "Test", "Pilot"]} />
              <TextLink href="/docs/provider-integration">
                Provider integration concepts
              </TextLink>
            </div>
            <CodeBlock
              label="Conceptual capability manifest"
              code={JSON.stringify(
                {
                  provider_id: "global_payment_gateway",
                  methods: [
                    "pix",
                    "upi",
                    "binance_pay",
                    "card",
                    "ondo_usdy",
                    "bank_transfer",
                  ],
                  countries: ["BR", "IN", "US", "GLOBAL"],
                  currencies: ["BRL", "INR", "USD", "EUR"],
                  directions: [
                    {
                      operation: "pay_in",
                      methods: ["pix", "upi", "binance_pay", "card"],
                    },
                    {
                      operation: "settlement",
                      targets: ["local_fiat", "usdc", "ondo_usdy"],
                    },
                  ],
                  limits: "declared per capability",
                  availability: "reported in real-time",
                  settlement: "validated during onboarding",
                },
                null,
                2,
              )}
            />
          </div>
        </section>
      )}
      {slug === "developers" && (
        <section className="section cloud">
          <div className="container split">
            <div>
              <h2>A payment starts with intent.</h2>
              <p>
                Every payment initiates with a strongly-typed intent. All responses adhere to our OpenAPI contract and include full cryptographic idempotency keys.
              </p>
              <TextLink href="/docs/quickstart">
                Walk through quickstart integration
              </TextLink>
              <br />
              <TextLink href="/docs/webhooks">
                Reliable HMAC webhook verification
              </TextLink>
            </div>
            <CodeBlock code={intentExample} />
          </div>
        </section>
      )}
      {slug === "pricing" && (
        <section className="section cloud">
          <div className="container faq-layout">
            <div>
              <h2>Transparent pricing built for scale.</h2>
              <p>
                No hidden subscriptions or minimum transaction quotas. Pay only for successful payments with zero setup cost.
              </p>
            </div>
            <div className="faq">
              {[
                [
                  "How does PayRouta fee structure work?",
                  "PayRouta charges a flat 0.5% platform fee on successfully settled transactions, plus the direct clearing fee of the selected underlying payment provider.",
                ],
                [
                  "Is the Sandbox free?",
                  "Yes. All developers receive free and instant access to the PayRouta Sandbox simulator, including mock webhooks, synthetic cards, and automated failover testing.",
                ],
                [
                  "What payment volumes qualify for custom pricing?",
                  "Merchants processing over $100,000 / ₦150M monthly can access discounted interchange rates, custom treasury settlement terms, and dedicated SLA support.",
                ],
              ].map(([q, a]) => (
                <details key={q}>
                  <summary>{q}</summary>
                  <p>{a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      )}
      {slug === "about" && (
        <section className="section cloud">
          <div className="container">
            <h2>The principles behind the design.</h2>
            <div className="content-grid">
              {[
                [
                  "Customer choice",
                  "Customers decide how to pay. Routing respects that decision.",
                ],
                [
                  "Real availability",
                  "Whether a payment can actually process right now matters more than a static logo on a website.",
                ],
                [
                  "Working with multiple providers",
                  "Connecting different payment providers through one standard format makes them easy to manage.",
                ],
                [
                  "Reliable execution",
                  "Clear payment statuses and safe checks protect against accidental double charges.",
                ],
                [
                  "Developer clarity",
                  "Keep the integration understandable and the transaction status honest.",
                ],
              ].map(([t, d]) => (
                <article className="content-card" key={t}>
                  <h3>{t}</h3>
                  <p>{d}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
      )}
      {slug === "provider-routing" && (
        <section className="section cloud">
          <div className="container split">
            <div>
              <h2>Provider routing within the customer’s choice.</h2>
              <p>
                PayRouta finds eligible providers strictly for the method the customer
                selected, whether that is iDEAL in Europe, FedNow in the US, Pix in Brazil,
                NIP in Nigeria, OPay, PalmPay, Binance Pay, or cards. Providers are ranked by cost,
                settlement speed, or past uptime.
              </p>
              <p>
                If a primary provider is unavailable before a payment starts, a backup
                provider for that same method is used. The customer’s payment choice
                remains fixed.
              </p>
              <TextLink href="/docs/errors">
                Read the status-check and retry principles
              </TextLink>
            </div>
            <div className="callout">
              <h3>Customer choice stays fixed.</h3>
              <Flow
                steps={[
                  "Method chosen (e.g. iDEAL, OPay, Pix, Card)",
                  "Filter eligible method providers",
                  "Apply merchant routing policy",
                  "Eligible provider selected",
                ]}
              />
              <TextLink href="/docs/payment-methods">
                Understand method availability
              </TextLink>
            </div>
          </div>
        </section>
      )}
      {slug === "settlement" && (
        <section className="section cloud">
          <div className="container split">
            <div>
              <h2>Settlement is flexible — receive funds in any available method you prefer.</h2>
              <p>
                Settlement is not fixed. How a customer pays and how a merchant
                receives funds are independent choices. Customers pay in their
                preferred local method, while merchants can be settled in any
                available method of their choice—including domestic bank
                transfers, multi-currency accounts, stablecoins, crypto exchange
                balances, or Real-World Assets (RWAs).
              </p>
              <TextLink href="/docs/settlement">
                Read the settlement documentation
              </TextLink>
            </div>
            <div>
              <Flow
                steps={[
                  "Customer payment confirmed",
                  "Currency or asset conversion",
                  "Settled in your preferred available method",
                ]}
              />
              <TextLink href="/docs/webhooks">
                Handle asynchronous transaction updates
              </TextLink>
            </div>
          </div>
        </section>
      )}
      <ClosingCTA />
    </>
  );
}
