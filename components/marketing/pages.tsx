import {
  ArrowsClockwise,
  ArrowsSplit,
  BracketsCurly,
  CheckCircle,
  ClockCountdown,
  Code,
  Fingerprint,
  Flask,
  GlobeHemisphereWest,
  Heartbeat,
  Key,
  Lightning,
  ListChecks,
  Plugs,
  Receipt,
  Scales,
  ShieldCheck,
  Storefront,
  Stack,
  WebhooksLogo,
} from "@phosphor-icons/react/dist/ssr";
import type { Icon } from "@phosphor-icons/react";
import { pages, useCases, type PageSlug } from "@/content/marketing";
import {
  lines,
  pricing,
  regions,
  status,
  type LineKey,
} from "@/content/claims";
import { paths } from "@/lib/site-config";
import {
  Btn,
  Checks,
  Kicker,
  LineBadge,
  MkLink,
  Photo,
  SectionHead,
} from "./ui";
import { Closing, Faq } from "./sections";
import { LineBundle, RouteMap } from "./route-map";
import { ScrollStory } from "./scroll-story";
import { RevenueCalculator } from "./revenue-calculator";
import { CodeTabs } from "./code-tabs";
import { MethodFilter } from "@/components/method-filter";
import { CodeBlock } from "@/components/code-block";

type Action = { href: string; label: string };

function PageHero({
  kicker,
  title,
  lead,
  primary,
  secondary,
  visual,
  dark = false,
  line,
  children,
}: {
  kicker: string;
  line?: LineKey;
  title: React.ReactNode;
  lead: string;
  primary: Action;
  secondary?: Action;
  visual?: React.ReactNode;
  dark?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <section className={`mk-page-hero${dark ? " mk-dark" : ""}`}>
      <div className="mk-wrap">
        <div className={`mk-page-hero-grid${visual ? "" : " solo"}`}>
          <div>
            <Kicker line={line}>{kicker}</Kicker>
            <h1 className="mk-h1">{title}</h1>
            <p className="mk-lead">{lead}</p>
            <div className="mk-actions">
              <Btn href={primary.href} large>
                {primary.label}
              </Btn>
              {secondary && (
                <Btn href={secondary.href} ghost large>
                  {secondary.label}
                </Btn>
              )}
            </div>
            {children}
          </div>
          {visual}
        </div>
        {!visual && <LineBundle className="mk-strip" />}
      </div>
    </section>
  );
}

function Features({
  items,
  cols = 3,
}: {
  items: [Icon, string, string][];
  cols?: 2 | 3;
}) {
  return (
    <div className={cols === 3 ? "mk-grid-3" : "mk-grid-2"}>
      {items.map(([I, title, copy]) => (
        <article className="mk-card mk-feature" key={title} data-reveal>
          <span className="ic">
            <I size={22} weight="duotone" />
          </span>
          <h3 className="mk-h3">{title}</h3>
          <p className="mk-body">{copy}</p>
        </article>
      ))}
    </div>
  );
}

const sectionsOf = (slug: PageSlug) =>
  pages[slug].sections as unknown as [string, string][];

/* ------------------------------------------------------------------ */

function HealthBoard() {
  const rows: {
    name: string;
    line: LineKey;
    method: string;
    status: "ok" | "warn" | "down";
    bars: number[];
  }[] = [
    {
      name: "provider_a",
      line: "card",
      method: "Cards",
      status: "down",
      bars: [9, 8, 9, 7, 3, 1, 1, 2],
    },
    {
      name: "provider_b",
      line: "card",
      method: "Cards",
      status: "ok",
      bars: [8, 9, 9, 8, 9, 9, 8, 9],
    },
    {
      name: "provider_c",
      line: "bank",
      method: "Bank transfer",
      status: "ok",
      bars: [9, 9, 8, 9, 9, 8, 9, 9],
    },
    {
      name: "provider_d",
      line: "mobile",
      method: "Mobile money",
      status: "warn",
      bars: [8, 7, 6, 7, 5, 6, 7, 6],
    },
    {
      name: "provider_e",
      line: "crypto",
      method: "Stablecoins",
      status: "ok",
      bars: [9, 9, 9, 9, 8, 9, 9, 9],
    },
  ];
  return (
    <div className="mk-panel shadow" data-reveal>
      <div className="mk-panel-bar">
        <span>Provider health</span>
        <span className="right">
          <span className="mk-dot-live" /> sandbox simulation
        </span>
      </div>
      <div className="mk-board-row head">
        <span>Provider</span>
        <span>Success rate</span>
        <span>Latency</span>
        <span>Routing</span>
      </div>
      {rows.map((r) => (
        <div className="mk-board-row" key={r.name}>
          <span className="who">
            <i style={{ background: lines[r.line].color }} />
            <span>
              <span className="mk-mono" style={{ fontSize: 13 }}>
                {r.name}
              </span>
              <br />
              <small style={{ color: "var(--text-dim)", fontWeight: 400 }}>
                {r.method}
              </small>
            </span>
          </span>
          <span
            className={`mk-spark${r.status === "down" ? " bad" : ""}`}
            aria-hidden="true"
          >
            {r.bars.map((b, i) => (
              <i
                key={i}
                style={{ height: `${b * 10}%`, animationDelay: `${i * 0.12}s` }}
              />
            ))}
          </span>
          <span className="mk-mono" style={{ fontSize: 12.5 }}>
            {r.status === "down"
              ? "timeout"
              : r.status === "warn"
                ? "1.9s"
                : "0.4s"}
          </span>
          <span className={`mk-status ${r.status}`}>
            {r.status === "down"
              ? "bypassed"
              : r.status === "warn"
                ? "degraded"
                : "active"}
          </span>
        </div>
      ))}
    </div>
  );
}

function RoutingFunnel() {
  const stages: [string, string, number][] = [
    ["Providers for the chosen method", "8", 100],
    ["Eligible for this corridor, amount and asset", "5", 72],
    ["Your approved accounts, certified and healthy", "3", 48],
    ["Ranked by success, speed, cost and your policy", "1 + backup", 30],
  ];
  return (
    <div className="mk-card" style={{ padding: 28 }} data-reveal>
      <p className="mk-kicker" style={{ marginBottom: 24 }}>
        How a route is chosen
      </p>
      <div style={{ display: "grid", gap: 14 }}>
        {stages.map(([label, n, w], i) => (
          <div key={label}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                fontSize: 14,
                marginBottom: 6,
              }}
            >
              <span>{label}</span>
              <b className="mk-mono" style={{ fontWeight: 500 }}>
                {n}
              </b>
            </div>
            <div
              style={{
                height: 10,
                borderRadius: 10,
                background: "var(--paper-2)",
              }}
            >
              <div
                style={{
                  width: `${w}%`,
                  height: "100%",
                  borderRadius: 10,
                  background: i === 3 ? "var(--teal)" : "var(--line-card)",
                  opacity: i === 3 ? 1 : 0.35 + i * 0.2,
                }}
              />
            </div>
          </div>
        ))}
      </div>
      <p className="mk-body" style={{ fontSize: 13 }}>
        Illustrative example. A lower fee never rescues an ineligible route.
      </p>
    </div>
  );
}

function Ledger() {
  const rows: [string, LineKey, string, string, string][] = [
    ["pay_8Hx2", "card", "provider_b", "Confirmed", "€240.00"],
    ["pay_8Hx7", "bank", "provider_c", "Settled", "€1,180.00"],
    ["pay_8Hy1", "wallet", "provider_b", "Settled", "€64.50"],
    ["pay_8Hy4", "crypto", "provider_e", "Settled", "€512.00"],
    ["pay_8Hy9", "card", "provider_a", "Exception", "€89.00"],
  ];
  return (
    <div className="mk-panel shadow mk-ledger" data-reveal>
      <div className="mk-panel-bar">
        <span>Provider settlements · EUR</span>
        <span className="right">
          <span className="mk-dot-live" /> reconciling
        </span>
      </div>
      <div className="mk-ledger-row head">
        <span>Payment</span>
        <span>Provider</span>
        <span>State</span>
        <span style={{ textAlign: "right" }}>Amount</span>
      </div>
      {rows.map(([id, line, prov, state, amt]) => (
        <div className="mk-ledger-row" key={id}>
          <span className="ref">
            <i style={{ background: lines[line].color }} />
            {id}
          </span>
          <span className="mk-mono" style={{ fontSize: 12.5 }}>
            {prov}
          </span>
          <span
            className={`mk-status ${state === "Exception" ? "warn" : "ok"}`}
            style={{ justifySelf: "start" }}
          >
            {state}
          </span>
          <span className="amt">{amt}</span>
        </div>
      ))}
      <div className="mk-ledger-total">
        <span>Settled to your accounts</span>
        <strong>€1,968.37</strong>
      </div>
    </div>
  );
}

function Console() {
  return (
    <div className="mk-panel shadow" data-reveal>
      <div>
        <div className="mk-panel-bar">
          <span>PayRouta · Overview</span>
          <span className="right">sample data</span>
        </div>
        <div style={{ padding: 20, display: "grid", gap: 16 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
              gap: 12,
            }}
          >
            {[
              ["Gross volume", "€184,920"],
              ["Success rate", "97.8%"],
              ["Recovered by failover", "€6,410"],
            ].map(([k, v]) => (
              <div
                key={k}
                className="mk-kv"
                style={{ padding: 14, display: "block" }}
              >
                <span
                  style={{ fontSize: 12.5, fontWeight: 700, color: "#4b5a61" }}
                >
                  {k}
                </span>
                <div
                  style={{
                    fontSize: 30,
                    fontWeight: 900,
                    fontStretch: "75%",
                    marginTop: 4,
                  }}
                >
                  {v}
                </div>
              </div>
            ))}
          </div>
          <div
            className="mk-ledger"
            style={{ border: "1px solid var(--rule)", borderRadius: 8 }}
          >
            <div className="mk-ledger-row head">
              <span>Payment</span>
              <span>Method</span>
              <span>Status</span>
              <span style={{ textAlign: "right" }}>Amount</span>
            </div>
            {(
              [
                ["order_2291", "card", "Paid", "€240.00"],
                ["order_2290", "bank", "Paid", "R$ 389,90"],
                ["order_2289", "mobile", "Pending", "KES 2,450"],
                ["order_2288", "crypto", "Paid", "412.00 USDC"],
              ] as [string, LineKey, string, string][]
            ).map(([id, line, st, amt]) => (
              <div className="mk-ledger-row" key={id}>
                <span className="ref">
                  <i style={{ background: lines[line].color }} />
                  {id}
                </span>
                <span style={{ fontSize: 13 }}>{lines[line].label}</span>
                <span
                  className={`mk-status ${st === "Paid" ? "ok" : "warn"}`}
                  style={{ justifySelf: "start" }}
                >
                  {st}
                </span>
                <span className="amt">{amt}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function PaymentFlow() {
  return (
    <>
      <PageHero
        kicker="Payment flow"
        line="bank"
        title={
          <>
            From checkout to settlement, <em>without a dead end.</em>
          </>
        }
        lead={pages["payment-flow"].intro}
        primary={{ href: "/docs/quickstart", label: "Read the quickstart" }}
        secondary={{ href: "/merchant", label: "Try the sandbox" }}
      >
        <nav className="mk-anchor-nav" aria-label="Payment flow sections">
          {[
            ["availability", "Availability"],
            ["checkout", "Customer checkout"],
            ["execution", "Execution"],
            ["settlement", "Settlement"],
          ].map(([id, label]) => (
            <a key={id} href={`#${id}`}>
              {label}
            </a>
          ))}
        </nav>
      </PageHero>
      <section className="mk-section">
        <div className="mk-wrap">
          <ScrollStory />
        </div>
      </section>
      <section className="mk-section mk-fog">
        <div className="mk-wrap">
          <SectionHead
            kicker="Two different questions"
            title={
              <>
                Availability asks <em>can it work?</em> Routing asks{" "}
                <em>who runs it?</em>
              </>
            }
          />
          <div className="mk-grid-2">
            <article className="mk-card mk-feature" data-reveal>
              <span className="ic">
                <ListChecks size={22} weight="duotone" />
              </span>
              <h3 className="mk-h3">
                Availability, before the customer chooses
              </h3>
              <p className="mk-body">
                A method only appears when one of your own provider accounts can
                serve this exact payment — country, currency, amount, compliance
                and live health included.
              </p>
              <MkLink href="/docs/payment-methods">
                Read the availability model
              </MkLink>
            </article>
            <article className="mk-card mk-feature" data-reveal>
              <span className="ic">
                <ArrowsSplit size={22} weight="duotone" />
              </span>
              <h3 className="mk-h3">Routing, after the customer chooses</h3>
              <p className="mk-body">
                PayRouta compares only providers for the chosen method. If none
                remains before execution, the customer is asked to choose again
                — never silently switched.
              </p>
              <MkLink href="/docs/errors">Understand retry boundaries</MkLink>
            </article>
          </div>
        </div>
      </section>
      <Closing />
    </>
  );
}

function PaymentMethods() {
  return (
    <>
      <PageHero
        kicker="Payment methods"
        line="wallet"
        title={
          <>
            Every way the world pays, <em>behind one schema.</em>
          </>
        }
        lead={pages["payment-methods"].intro}
        primary={{ href: "/merchant", label: "Start building" }}
        secondary={{ href: "/docs/payment-methods", label: "Method reference" }}
        visual={
          <Photo
            src="card-terminal"
            alt="A customer tapping a card on a payment terminal"
            priority
            tags={[
              { label: "Cards", line: "card" },
              { label: "Wallets", line: "wallet" },
            ]}
          />
        }
      />
      <section className="mk-section">
        <div className="mk-wrap">
          <MethodFilter />
        </div>
      </section>
      <section className="mk-section mk-dark">
        <div className="mk-wrap" style={{ position: "relative" }}>
          <SectionHead
            kicker="Around the world"
            title={
              <>
                Local methods, <em>in every region you sell.</em>
              </>
            }
            lead="Customers see the methods that are normal where they live, in their own currency. Which ones you can offer depends on the provider accounts you hold — this is what PayRouta's schema is designed to route, not a list of live coverage."
          />
          <div className="mk-regions">
            {regions.map((r) => (
              <article key={r.name} data-reveal>
                <h3>
                  <GlobeHemisphereWest
                    size={18}
                    weight="duotone"
                    color="var(--mint)"
                  />
                  {r.name}
                </h3>
                <div className="mk-rails">
                  {r.methods.map((m) => (
                    <span key={m}>{m}</span>
                  ))}
                </div>
                <p className="cur">{r.currencies.join(" · ")}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
      <Closing />
    </>
  );
}

function ProviderRouting() {
  return (
    <>
      <PageHero
        kicker="Provider routing"
        line="card"
        title={
          <>
            When a provider fails, <em>the payment doesn&apos;t.</em>
          </>
        }
        lead={pages["provider-routing"].intro}
        primary={{ href: "/merchant", label: "Simulate an outage" }}
        secondary={{ href: "/docs/errors", label: "Retry semantics" }}
        visual={<HealthBoard />}
      />
      <section className="mk-section mk-fog">
        <div className="mk-wrap">
          <SectionHead
            center
            kicker="Same-method failover"
            title={
              <>
                Watch a card payment <em>find another way.</em>
              </>
            }
          />
          <div
            className="mk-panel shadow"
            style={{ padding: "clamp(12px, 3vw, 32px)" }}
            data-reveal
          >
            <RouteMap />
          </div>
        </div>
      </section>
      <section className="mk-section">
        <div className="mk-wrap">
          <div className="mk-row">
            <div data-reveal>
              <Kicker>The routing rules</Kicker>
              <h2 className="mk-h2">
                Fast when it can be. <em>Careful when it must be.</em>
              </h2>
              <Checks items={sectionsOf("provider-routing")} />
            </div>
            <RoutingFunnel />
          </div>
        </div>
      </section>
      <Closing />
    </>
  );
}

function SettlementPage() {
  return (
    <>
      <PageHero
        kicker="Settlement"
        line="bank"
        title={
          <>
            Many methods in. <em>One clean ledger out.</em>
          </>
        }
        lead={pages.settlement.intro}
        primary={{ href: "/docs/settlement", label: "How settlement works" }}
        secondary={{ href: "/contact?intent=merchant", label: "Talk to sales" }}
        visual={<Ledger />}
      />
      <section className="mk-section mk-fog">
        <div className="mk-wrap">
          <SectionHead
            kicker="Built for finance teams"
            title={
              <>
                Confirmation and settlement are <em>different facts.</em>
              </>
            }
            lead="A payment can be confirmed long before money reaches you. PayRouta tracks each state on its own, ties every payout to provider evidence, and shows you exactly what is still in flight."
          />
          <Features
            items={[
              [
                CheckCircle,
                sectionsOf("settlement")[0][0],
                sectionsOf("settlement")[0][1],
              ],
              [
                Stack,
                sectionsOf("settlement")[1][0],
                sectionsOf("settlement")[1][1],
              ],
              [
                Scales,
                sectionsOf("settlement")[2][0],
                sectionsOf("settlement")[2][1],
              ],
            ]}
          />
        </div>
      </section>
      <Closing />
    </>
  );
}

function Merchants() {
  return (
    <>
      <PageHero
        kicker="For merchants"
        line="card"
        title={
          <>
            Sell anywhere. <em>Get paid every way.</em>
          </>
        }
        lead={pages.merchants.intro}
        primary={{ href: "/merchant", label: "Open your dashboard" }}
        secondary={{ href: "/contact?intent=merchant", label: "Talk to sales" }}
        visual={
          <Photo
            src="boutique-seller"
            alt="An online clothing seller celebrating a sale at her laptop"
            priority
            tags={[
              { label: "Order paid", line: "crypto" },
              { label: "€240.00 · card", line: "card" },
            ]}
          />
        }
      />
      <section className="mk-section">
        <div className="mk-wrap">
          <SectionHead
            kicker="Why merchants switch"
            title={
              <>
                More payment methods. <em>Fewer failed checkouts.</em>
              </>
            }
          />
          <Features
            items={[
              [
                ShieldCheck,
                sectionsOf("merchants")[0][0],
                sectionsOf("merchants")[0][1],
              ],
              [
                Plugs,
                sectionsOf("merchants")[1][0],
                sectionsOf("merchants")[1][1],
              ],
              [
                ListChecks,
                sectionsOf("merchants")[2][0],
                sectionsOf("merchants")[2][1],
              ],
              [
                Fingerprint,
                sectionsOf("merchants")[3][0],
                sectionsOf("merchants")[3][1],
              ],
              [
                Receipt,
                sectionsOf("merchants")[4][0],
                sectionsOf("merchants")[4][1],
              ],
              [
                ArrowsClockwise,
                "Recover revenue automatically",
                "Provider-side failures are retried on another of your providers for the same method, before the customer sees an error.",
              ],
            ]}
          />
        </div>
      </section>
      <section className="mk-section mk-fog">
        <div className="mk-wrap">
          <div className="mk-row">
            <div data-reveal>
              <Kicker>Your dashboard</Kicker>
              <h2 className="mk-h2">
                Every payment, method and payout <em>in one place.</em>
              </h2>
              <p className="mk-lead">
                See payments, settlement and exceptions across all your
                providers without switching between their dashboards. Apply to
                new providers from the same place. Your team gets roles, audit
                history and exports out of the box.
              </p>
              <MkLink href="/merchant">Open the merchant console</MkLink>
            </div>
            <Console />
          </div>
          <div className="mk-row flip">
            <div data-reveal>
              <Kicker>Checkout</Kicker>
              <h2 className="mk-h2">
                A checkout that speaks <em>local.</em>
              </h2>
              <p className="mk-lead">
                Hosted checkout or payment links show each customer only the
                methods that will work for them — in their currency, on any
                device.
              </p>
              <Checks
                items={[
                  [
                    "Hosted checkout",
                    "Redirect with a session and let PayRouta handle method selection and status",
                  ],
                  [
                    "Your own server flow",
                    "Create intents and sessions from your backend with the HTTP API",
                  ],
                  ["SDKs", `${status.sdks}`],
                ]}
              />
            </div>
            <Photo
              src="cafe-counter"
              alt="A customer paying at a café counter"
              tags={[{ label: "Wallet payment", line: "wallet" }]}
            />
          </div>
        </div>
      </section>
      <section className="mk-section">
        <div className="mk-wrap">
          <SectionHead
            kicker="Estimate the upside"
            title={
              <>
                What a backup route <em>is worth to you.</em>
              </>
            }
          />
          <RevenueCalculator />
        </div>
      </section>
      <Closing />
    </>
  );
}

function Providers() {
  return (
    <>
      <PageHero
        kicker="For payment providers"
        line="mobile"
        title={
          <>
            Merchants apply once. <em>You onboard them directly.</em>
          </>
        }
        lead={pages.providers.intro}
        primary={{
          href: "/contact?intent=provider",
          label: "Talk to partnerships",
        }}
        secondary={{
          href: "/docs/provider-integration",
          label: "Integration specs",
        }}
        visual={
          <Photo
            src="city-night"
            alt="A city skyline at night seen from above"
            priority
            tags={[
              { label: "Merchant-owned accounts", line: "crypto" },
              { label: "Pre-screened applications", line: "bank" },
            ]}
          />
        }
      />
      <section className="mk-section">
        <div className="mk-wrap">
          <SectionHead
            kicker="How onboarding works"
            title={
              <>
                From a merchant&apos;s application to <em>their payments.</em>
              </>
            }
          />
          <div className="mk-timeline">
            {sectionsOf("providers").map(([title, copy], i) => (
              <article key={title} data-reveal>
                <span className="when">Step {i + 1}</span>
                <h3 className="mk-h3">{title}</h3>
                <p className="mk-body">{copy}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
      <section className="mk-section mk-fog">
        <div className="mk-wrap mk-row">
          <div data-reveal>
            <Kicker>Capability manifest</Kicker>
            <h2 className="mk-h2">
              Declare exactly <em>what you process.</em>
            </h2>
            <p className="mk-lead">
              Methods, countries, currencies and directions become structured
              capabilities. Certification tests only what you declare, and only
              certified capabilities can route.
            </p>
            <Checks
              items={[
                ["PayRouta Standard", "Implement one documented provider API"],
                [
                  "Declarative mapping",
                  "Map your existing API without writing an adapter",
                ],
                [
                  "Native integration",
                  "Ask us to build and maintain the adapter",
                ],
              ]}
            />
          </div>
          <CodeBlock
            label="Capability manifest"
            code={JSON.stringify(
              {
                provider_id: "global_payment_gateway",
                methods: [
                  "card",
                  "bank_transfer",
                  "pix",
                  "upi",
                  "mobile_money",
                ],
                countries: ["BR", "IN", "KE", "US", "GB"],
                currencies: ["BRL", "INR", "KES", "USD", "GBP"],
                directions: [
                  {
                    operation: "pay_in",
                    methods: ["card", "pix", "upi", "mobile_money"],
                  },
                  { operation: "settlement", targets: ["local_fiat", "usdc"] },
                ],
                limits: "declared per capability",
                availability: "reported in real time",
              },
              null,
              2,
            )}
          />
        </div>
      </section>
      <Closing
        title={
          <>
            Put your rails <em>in front of the world.</em>
          </>
        }
        lead="Tell us about your partner programme, or register in the provider portal to implement the PayRouta Provider API and run automated sandbox certification."
        primary={{
          href: "/contact?intent=provider",
          label: "Talk to partnerships",
        }}
        secondary={{ href: "/provider/sign-up", label: "Provider portal" }}
      />
    </>
  );
}

const industries: {
  img: string;
  title: string;
  copy: string;
  line: LineKey;
  flow: string[];
}[] = [
  {
    img: "founder-laptop",
    title: "SaaS & digital products",
    copy: "Take card and wallet payments from customers worldwide with one application to PayRouta. PayRouta isn't your merchant of record, so sales tax stays with you.",
    line: "card",
    flow: ["Cards", "Wallets", "Your payouts"],
  },
  {
    img: "market-vendor-phone",
    title: "Local merchants in Africa",
    copy: "Accept bank transfer, cards and mobile money through local providers, each account in your name, with a backup provider for the same method.",
    line: "mobile",
    flow: ["Transfers", "Cards", "Mobile money"],
  },
  {
    img: "packing-orders",
    title: "E-commerce",
    copy: "Offer the methods each shopper expects, with a second provider standing by for every method you sell with.",
    line: "bank",
    flow: ["Cards", "Wallets", "Failover"],
  },
  {
    img: "cafe-owner-tablet",
    title: "Online ordering",
    copy: "Keep checkout moving with wallets and cards routed through whichever of your providers is healthy.",
    line: "wallet",
    flow: ["Wallets", "Cards", "Health checks"],
  },
  {
    img: "tokyo-street",
    title: "Digital goods",
    copy: "Sell to a global audience from one checkout, reconciled across every provider you use.",
    line: "crypto",
    flow: ["Cards", "Wallets", "One view"],
  },
];

function UseCases() {
  return (
    <>
      <PageHero
        kicker="Use cases"
        line="crypto"
        title={
          <>
            One payment layer. <em>Every kind of business.</em>
          </>
        }
        lead={pages["use-cases"].intro}
        primary={{
          href: "/contact?intent=merchant",
          label: "Discuss your flow",
        }}
        secondary={{ href: paths.paymentMethods, label: "See every method" }}
      />
      <section className="mk-section">
        <div className="mk-wrap mk-cases">
          {industries.map((c) => (
            <article
              className="mk-card mk-case"
              key={c.title}
              style={
                { "--tile-line": lines[c.line].color } as React.CSSProperties
              }
              data-reveal
            >
              <Photo
                src={c.img}
                alt=""
                sizes="(max-width: 860px) 100vw, 33vw"
              />
              <div className="mk-case-body">
                <LineBadge line={c.line} />
                <h2 className="mk-h3" style={{ marginTop: 14 }}>
                  {c.title}
                </h2>
                <p className="mk-body">{c.copy}</p>
                <div
                  className="mk-case-flow"
                  aria-label={`Typical flow: ${c.flow.join(", ")}`}
                >
                  {c.flow.map((f) => (
                    <span key={f}>{f}</span>
                  ))}
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
      <section className="mk-section mk-fog">
        <div className="mk-wrap">
          <SectionHead
            kicker="Scenarios"
            title={
              <>
                What happens <em>behind the button.</em>
              </>
            }
          />
          <div className="mk-scenarios">
            {useCases.map((c) => (
              <article
                className="mk-card mk-scenario"
                key={c.title}
                data-reveal
              >
                <div>
                  <h3 className="mk-h3">{c.title}</h3>
                  <p className="mk-body">{c.need}</p>
                  <p
                    className="mk-body"
                    style={{ color: "var(--teal)", fontWeight: 500 }}
                  >
                    {c.benefit}
                  </p>
                </div>
                <dl>
                  <dt>Customer choice</dt>
                  <dd>{c.choice}</dd>
                  <dt>Route</dt>
                  <dd>{c.route}</dd>
                  <dt>Outcome</dt>
                  <dd>{c.outcome}</dd>
                </dl>
              </article>
            ))}
          </div>
        </div>
      </section>
      <Closing />
    </>
  );
}

function Developers() {
  return (
    <>
      <section className="mk-page-hero mk-dark">
        <div className="mk-wrap mk-dev">
          <div>
            <Kicker>Developers</Kicker>
            <h1 className="mk-h1">
              Payments that <em>behave.</em>
            </h1>
            <p className="mk-lead">{pages.developers.intro}</p>
            <p className="mk-body">
              {status.sdks}. Or call the HTTP API directly.
            </p>
            <div className="mk-actions">
              <Btn href="/docs/quickstart" large>
                Quickstart
              </Btn>
              <Btn href={paths.apiReference} ghost large>
                API reference
              </Btn>
            </div>
          </div>
          <CodeTabs />
        </div>
      </section>
      <section className="mk-section">
        <div className="mk-wrap">
          <SectionHead
            kicker="What you get"
            title={
              <>
                The hard parts, <em>handled.</em>
              </>
            }
          />
          <Features
            items={[
              [
                Code,
                "Typed SDKs",
                "TypeScript and Python clients for early-access merchants, with runtime validation and safe retries for reads.",
              ],
              [
                Key,
                "Idempotent by default",
                "Every write takes an idempotency key. Replays return the original result, never a second charge.",
              ],
              [
                WebhooksLogo,
                "Signed webhooks",
                "HMAC-signed events with key rotation, timestamps and replay tolerance — verify in one call.",
              ],
              [
                Heartbeat,
                "Normalized states",
                "Confirmed, pending, action required, rejected, unknown — the same five states from every provider.",
              ],
              [
                Flask,
                "A sandbox that fails on purpose",
                "Simulate timeouts, rejections and failovers to test the paths that break checkouts in production.",
              ],
              [
                BracketsCurly,
                "OpenAPI contract",
                "A typed contract for every endpoint, ready for code generation in any language.",
              ],
            ]}
          />
        </div>
      </section>
      <section className="mk-section mk-fog">
        <div className="mk-wrap mk-row">
          <div data-reveal>
            <Kicker>Integration</Kicker>
            <h2 className="mk-h2">
              Four steps to <em>your first payment.</em>
            </h2>
            <Checks items={sectionsOf("developers")} />
            <MkLink href="/docs/webhooks">Verify your first webhook</MkLink>
          </div>
          <Photo
            src="dev-team"
            alt="Two developers reviewing code together at a laptop"
          />
        </div>
      </section>
      <Closing
        title={
          <>
            Get sandbox keys. <em>Test every path.</em>
          </>
        }
        primary={{ href: "/merchant", label: "Create an account" }}
        secondary={{ href: "/docs", label: "Browse the docs" }}
      />
    </>
  );
}

function Pricing() {
  return (
    <>
      <PageHero
        kicker="Pricing"
        line="bank"
        title={
          <>
            Pay for payments that <em>succeed.</em>
          </>
        }
        lead={pages.pricing.intro}
        primary={{ href: "/merchant", label: "Start free in sandbox" }}
        secondary={{ href: "/contact?intent=pricing", label: "Volume pricing" }}
      />
      <section className="mk-section">
        <div className="mk-wrap mk-plans">
          <article className="mk-card mk-plan" data-reveal>
            <span className="name">Sandbox</span>
            <div className="price">
              $0<small>forever</small>
            </div>
            <p className="mk-body">
              {pricing.sandbox} for building and testing every flow.
            </p>
            <Checks
              items={[
                ["Every method", "Simulated end to end"],
                ["Outage simulation", "Timeouts, rejections and failovers"],
                ["Webhooks", "Signed test events"],
              ]}
            />
            <Btn href="/merchant" ghost>
              Get sandbox keys
            </Btn>
          </article>
          <article className="mk-card mk-plan feature" data-reveal>
            <span className="name">Standard</span>
            <div className="price">{pricing.rate}</div>
            <p className="rate-note">{pricing.rateNote}</p>
            <p className="mk-body">
              <strong>{pricing.lowerRate}</strong> for {pricing.lowerRateNote}.
            </p>
            <p className="mk-body">
              Billed monthly, separately from provider settlements. Other
              currencies have agreed currency-specific caps; crypto uses an
              agreed fiat valuation. Applicable taxes are additional.
            </p>
            <p className="mk-body">
              {pricing.plusNote[0].toUpperCase() + pricing.plusNote.slice(1)}.
              No setup fees, no monthly minimums.
            </p>
            <p className="mk-body">{status.live}.</p>
            <Checks
              items={[
                ["Same-method failover", "On every method"],
                ["Provider accounts", "Apply once, own every account"],
                ["Dashboard & team", "Roles, audit history, exports"],
              ]}
            />
            <Btn href="/merchant">Start building</Btn>
          </article>
          <article className="mk-card mk-plan" data-reveal>
            <span className="name">Enterprise</span>
            <div className="price">Custom</div>
            <p className="mk-body">
              For businesses processing over {pricing.volumeThreshold}.
            </p>
            <Checks
              items={[
                ["Volume pricing", "Tiered platform fees"],
                ["Existing accounts", "Connect accounts you already hold"],
                ["Dedicated support", "Named contact and SLA"],
              ]}
            />
            <Btn href="/contact?intent=pricing" ghost>
              Talk to sales
            </Btn>
          </article>
        </div>
      </section>
      <section className="mk-section mk-fog">
        <div className="mk-wrap">
          <SectionHead
            kicker="Who charges what"
            title={
              <>
                Transparent about <em>every fee.</em>
              </>
            }
            lead="PayRouta charges for routing, failover and reconciliation. Each provider charges its own processing fees on your account, under your contract with them."
          />
          <div className="mk-table-wrap" data-reveal>
            <table className="mk-table">
              <thead>
                <tr>
                  <th scope="col">Fee</th>
                  <th scope="col">Charged by</th>
                  <th scope="col">When</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    Cards, wallets &amp; BNPL ({pricing.rate}, USD cap{" "}
                    {pricing.cardCap})
                  </td>
                  <td>PayRouta</td>
                  <td>Successful payments only</td>
                </tr>
                <tr>
                  <td>
                    Bank payments, USSD, mobile money &amp; crypto (
                    {pricing.lowerRate}, USD cap {pricing.bankCap})
                  </td>
                  <td>PayRouta</td>
                  <td>Successful payments only; monthly billing</td>
                </tr>
                <tr>
                  <td>Processing fees</td>
                  <td>Your provider, on your account</td>
                  <td>Per your contract with them</td>
                </tr>
                <tr>
                  <td>Failed or failed-over attempts</td>
                  <td>PayRouta</td>
                  <td className="yes">Never charged</td>
                </tr>
                <tr>
                  <td>Sandbox usage</td>
                  <td>PayRouta</td>
                  <td className="yes">Always free</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>
      <section className="mk-section">
        <div className="mk-wrap">
          <Faq
            title="Pricing questions."
            items={[
              [
                "How is the platform fee calculated?",
                `Cards, digital wallets and BNPL cost ${pricing.rate}, capped at ${pricing.cardCap} for USD payments. Bank transfers, direct debit, USSD, mobile money and crypto cost ${pricing.lowerRate}, capped at ${pricing.bankCap} for USD payments. The percentage applies to the successful payment amount. We bill once per successful payment, including a payment recovered through failover. Failed, pending and unknown attempts do not incur a platform fee. Your provider's processing fees are separate. Other currencies require agreed caps; crypto requires an agreed fiat valuation. Fees are rounded to the nearest billing-currency minor unit, with halves rounded up.`,
              ],
              [
                "How do monthly invoices work?",
                "We provide monthly usage statements separately from your provider settlements. Applicable taxes and invoice payment instructions are handled under your merchant agreement. A successful payment remains in usage if later refunded; any agreed fee credit is reviewed separately.",
              ],
              [
                "Is the sandbox really free?",
                "Yes. Build and test every method, simulate outages and receive signed test webhooks at no cost, with no time limit.",
              ],
              [
                "Can I use my existing provider accounts?",
                "Every account you route through is yours. If you already hold an account with a supported provider, we can connect it instead of opening a new one.",
              ],
              [
                "When does volume pricing apply?",
                `Businesses processing over ${pricing.volumeThreshold} can talk to us about tiered platform fees.`,
              ],
            ]}
          />
        </div>
      </section>
      <Closing />
    </>
  );
}

function About() {
  return (
    <>
      <PageHero
        kicker="About PayRouta"
        line="mobile"
        title={
          <>
            The world doesn&apos;t pay one way. <em>Neither should you.</em>
          </>
        }
        lead={pages.about.intro}
        primary={{ href: "/contact", label: "Get in touch" }}
        secondary={{ href: paths.developers, label: "See the platform" }}
      />
      <section className="mk-section tight">
        <div className="mk-wrap">
          <Photo
            src="dev-team"
            alt="The team working together around laptops"
            className="mk-about-photo"
            sizes="100vw"
          />
        </div>
      </section>
      <section className="mk-section tight">
        <div className="mk-wrap">
          <Kicker>Our mission</Kicker>
          <p className="mk-quote" data-reveal>
            Every business should be able to accept the ways its customers pay,{" "}
            <em>through accounts it owns</em> — and a single provider&apos;s
            outage should never be the reason a sale is lost.
          </p>
        </div>
      </section>
      <section className="mk-section mk-fog">
        <div className="mk-wrap">
          <SectionHead
            kicker="What we believe"
            title={
              <>
                The principles <em>behind the product.</em>
              </>
            }
          />
          <Features
            items={[
              [
                Storefront,
                "Customer choice",
                "Customers decide how to pay. Routing respects that decision and never swaps their method.",
              ],
              [
                Lightning,
                "Real availability",
                "Whether a payment can complete right now matters more than a logo on a website.",
              ],
              [
                ArrowsSplit,
                "No single point of failure",
                "Every method should have more than one provider ready to run it.",
              ],
              [
                ShieldCheck,
                "Your money, on your schedule",
                "Regulated partners hold your balance, never PayRouta's own bank accounts, and you're paid out on your schedule.",
              ],
              [
                ClockCountdown,
                "Honest states",
                "A timeout is not a failure. Uncertain payments are rechecked before anything is retried.",
              ],
              [
                Code,
                "Developer clarity",
                "Integrations should be small, typed and predictable, in any market.",
              ],
            ]}
          />
        </div>
      </section>
      <Closing
        title={
          <>
            Build the future of payments <em>with us.</em>
          </>
        }
        lead="Merchants, providers, partners and future teammates — we'd love to hear from you."
        primary={{ href: "/contact", label: "Contact us" }}
        secondary={{
          href: "/contact?intent=provider",
          label: "Partner with us",
        }}
      />
    </>
  );
}

export const pageComponents: Record<PageSlug, () => React.ReactNode> = {
  "payment-flow": PaymentFlow,
  "payment-methods": PaymentMethods,
  "provider-routing": ProviderRouting,
  settlement: SettlementPage,
  merchants: Merchants,
  providers: Providers,
  "use-cases": UseCases,
  developers: Developers,
  pricing: Pricing,
  about: About,
};
