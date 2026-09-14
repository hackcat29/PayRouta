import { notFound } from "next/navigation";
import { pages, type PageSlug, useCases } from "@/content/marketing";
import { ButtonLink, ClosingCTA, TextLink, Flow } from "@/components/shared";
import { CodeBlock } from "@/components/code-block";
import { MethodFilter } from "@/components/method-filter";
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
  return (
    <>
      <section className="page-hero">
        <div className="container">
          <p className="early-access">Early access · In development</p>
          <h1>{p.headline}</h1>
          <p className="lead">{p.intro}</p>
          <div className="actions">
            <ButtonLink
              href={
                slug === "providers"
                  ? "/contact?intent=provider"
                  : slug === "pricing"
                    ? "/contact?intent=pricing"
                    : "/contact?intent=merchant"
              }
            >
              {slug === "providers"
                ? "Become a provider"
                : slug === "pricing"
                  ? "Discuss pricing"
                  : "Request merchant access"}
            </ButtonLink>
            <TextLink href={slug === "developers" ? "/docs" : "/#routing-demo"}>
              {slug === "developers"
                ? "Explore the docs"
                : "Try the routing demo"}
            </TextLink>
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
            <h2>From requirements to a pilot.</h2>
            <Flow
              steps={[
                "Discuss requirements",
                "Confirm coverage",
                "Integrate",
                "Validate",
                "Pilot",
              ]}
            />
            <div className="callout" style={{ marginTop: 40 }}>
              <h3>Planned checkout options</h3>
              <p>
                Hosted checkout, payment links, and SDK capabilities are
                planned. The first step is confirming your requirements and the
                access available for your use case.
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
                This local JSON object illustrates the proposed shape. It does
                not call a service or establish a published API contract.
              </p>
              <TextLink href="/docs/quickstart">
                Walk through an integration
              </TextLink>
              <br />
              <TextLink href="/docs/webhooks">
                Design for reliable updates
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
              <h2>Understand the whole payment flow.</h2>
              <p>
                Possible PayRouta fees are separate from provider charges,
                conversion costs, and network charges. The applicable structure
                must be confirmed in a commercial discussion.
              </p>
            </div>
            <div className="faq">
              {[
                [
                  "Are rates available?",
                  "A public fee schedule has not been set. Share your requirements to discuss the intended commercial model.",
                ],
                [
                  "Is there a free tier?",
                  "No free tier, subscription, or transaction minimum is being offered on this early-access site.",
                ],
                [
                  "What should I include?",
                  "Tell us the methods, corridors, expected volume range, settlement needs, and support requirements. Do not include sensitive financial information.",
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
