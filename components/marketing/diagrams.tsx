// Diagrams for the marketing pages. They carry the explanation so the copy
// can stay short. Built from HTML and CSS (not scaled SVG text) so labels
// stay readable and the layouts reflow to a single column on phones.
// Figures come from content/claims.ts or the credit arithmetic checkout uses.
import { coverage, methodFamilies, pricing, type Availability } from "@/content/claims";
import { instalmentOffer } from "@/lib/treasury/credit";

const naira = (minor: bigint | string) =>
  `₦${new Intl.NumberFormat("en-NG", { maximumFractionDigits: 0 }).format(Number(BigInt(minor) / 100n))}`;

function Arrow({ label }: { label?: string }) {
  return (
    <div className="dg-arrow" aria-hidden="true">
      <span className="dg-arrow-line" />
      {label && <span className="dg-arrow-label">{label}</span>}
    </div>
  );
}

// 1. How a payment moves: button → checkout → the right network → you.
export function PaymentFlow() {
  const networks = ["Card networks", "Wallets", "Banks", "Mobile money", "Lenders", "Blockchains"];
  return (
    <figure className="dg dg-flow" aria-label="A payment from your checkout to your account">
      <div className="dg-flow-row">
        <div className="dg-node">
          <span className="dg-step">1</span>
          <span className="dg-node-title">Your site or app</span>
          <span className="dg-chip dg-chip-ink">Checkout</span>
        </div>
        <Arrow />
        <div className="dg-node">
          <span className="dg-step">2</span>
          <span className="dg-node-title">Customer picks how to pay</span>
          <span className="dg-mini-list">
            <i>Card</i>
            <i>Wallet</i>
            <i>Bank</i>
            <i className="dg-hl">Credit</i>
            <i>Crypto</i>
          </span>
        </div>
        <Arrow />
        <div className="dg-node dg-node-wide">
          <span className="dg-step">3</span>
          <span className="dg-node-title">PayRouta sends it through a licensed partner</span>
          <span className="dg-network">
            {networks.map((n) => (
              <i key={n}>{n}</i>
            ))}
          </span>
          <span className="dg-backup">
            <s>Partner A down</s> <b>→ same payment, partner B</b>
          </span>
        </div>
        <Arrow />
        <div className="dg-node dg-node-end">
          <span className="dg-step">4</span>
          <span className="dg-node-title">You get paid</span>
          <span className="dg-chip">Bank account or crypto wallet</span>
        </div>
      </div>
    </figure>
  );
}

// 2. Credit as a timeline: the merchant is paid in full today, the customer
// repays the lender over six weeks.
export function CreditTimeline() {
  const price = 15000000n;
  const plan = instalmentOffer({
    id: "p4",
    lender: "",
    termsUrl: "",
    amountMinor: price,
    instalments: 4,
    interval: "two-weeks",
    costBps: 0,
    aprBasisPoints: 0,
    firstDueToday: true,
  });
  const weeks = ["Today", "Week 2", "Week 4", "Week 6"];
  return (
    <figure className="dg dg-credit" aria-label={`A ${naira(price)} phone on a 4-payment plan`}>
      <div className="dg-lanes">
        <div className="dg-lane-head" aria-hidden="true" />
        {weeks.map((w) => (
          <div key={w} className="dg-week">
            {w}
          </div>
        ))}

        <div className="dg-lane-label">
          <b>You</b>
          <span>the merchant</span>
        </div>
        <div className="dg-cell dg-cell-paid">
          <span>{naira(price)}</span>
          <small>in full, from the lender</small>
        </div>
        <div className="dg-cell dg-cell-empty" />
        <div className="dg-cell dg-cell-empty" />
        <div className="dg-cell dg-cell-empty" />

        <div className="dg-lane-label">
          <b>Your customer</b>
          <span>repays the lender</span>
        </div>
        {weeks.map((w) => (
          <div key={w} className="dg-cell dg-cell-instalment">
            <span>{naira(plan.instalmentMinor)}</span>
          </div>
        ))}
      </div>
    </figure>
  );
}

// 3. Crypto from any chain: whatever the customer holds is swapped on the way
// and the merchant receives exactly the coin it asked for.
export function CryptoRoute() {
  const chains = ["Bitcoin", "Ethereum", "Solana", "Tron", "BNB Chain", "TON", "Base", "Arbitrum", "Polygon", "Avalanche", "Stellar", "NEAR"];
  return (
    <figure className="dg dg-crypto" aria-label="Paying a USDC invoice on Base with USDT on Tron">
      <div className="dg-crypto-row">
        <div className="dg-chains">
          <span className="dg-node-title">Customer pays from</span>
          <span className="dg-chain-grid">
            {chains.map((c) => (
              <i key={c} className={c === "Tron" ? "dg-hl" : undefined}>
                {c}
              </i>
            ))}
            <i className="dg-more">+24 more</i>
          </span>
          <span className="dg-example">e.g. 151.69 USDT on Tron</span>
        </div>
        <Arrow label="swapped on the way" />
        <div className="dg-node dg-hub">
          <span className="dg-node-title">PayRouta</span>
          <span className="dg-hub-stats">
            <b>125+</b> assets
            <b>36+</b> chains
          </span>
        </div>
        <Arrow label="exact amount" />
        <div className="dg-node dg-node-end">
          <span className="dg-node-title">You receive</span>
          <span className="dg-big">150.00 USDC</span>
          <span className="dg-chip">on Base, in your own wallet</span>
        </div>
      </div>
    </figure>
  );
}

// Marketing shows two states: offered, or coming (content/claims publicLabel).
const shown = (a: Availability) => (a === "planned" ? "planned" : "available");
const cellText = { available: "Available", planned: "Coming" } as const;

// 4. Where it works: regions by ways to pay.
export function CoverageGrid() {
  return (
    <figure className="dg dg-coverage" aria-labelledby="dg-cov-cap">
      <div className="dg-cov-scroll" role="region" aria-label="Ways to pay by region" tabIndex={0}>
        <table className="dg-cov">
          <thead>
            <tr>
              <th scope="col">Region</th>
              {methodFamilies.map(([id, label]) => (
                <th key={id} scope="col">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {coverage.map((row) => (
              <tr key={row.region}>
                <th scope="row">
                  {row.region}
                  <small>{row.examples}</small>
                </th>
                {methodFamilies.map(([id]) => {
                  const a = row.cells[id];
                  return (
                    <td key={id}>
                      {a ? (
                        <span className={`dg-dot dg-dot-${shown(a)}`}>
                          <span className="mk-sr">{cellText[shown(a)]}</span>
                        </span>
                      ) : (
                        <span className="dg-dot dg-dot-none">
                          <span className="mk-sr">Not offered</span>
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <figcaption id="dg-cov-cap" className="dg-cap dg-legend">
        <span>
          <i className="dg-dot dg-dot-available" /> Available
        </span>
        <span>
          <i className="dg-dot dg-dot-planned" /> Coming
        </span>
      </figcaption>
    </figure>
  );
}

// Pricing: where a $100 card payment goes, merchant absorbing fees vs the
// customer paying them. Mirrors the worked example on the pricing page.
export function FeeBars() {
  const rows = [
    { label: "You absorb the fees", total: 100, you: 95.8, partner: 3.2, ours: 1.0 },
    { label: "Customer pays the fees", total: 104.37, you: 100, partner: 3.33, ours: 1.04 },
  ];
  const max = 104.37;
  return (
    <figure className="dg dg-fees" aria-labelledby="dg-fees-cap">
      {rows.map((r) => (
        <div key={r.label} className="dg-fee-row">
          <span className="dg-fee-label">
            {r.label}
            <small>Customer pays ${r.total.toFixed(2)}</small>
          </span>
          <span className="dg-fee-bar" style={{ width: `${(r.total / max) * 100}%` }}>
            <i className="dg-fee-you" style={{ flexGrow: r.you }}>
              You get ${r.you.toFixed(2)}
            </i>
            <i className="dg-fee-partner" style={{ flexGrow: r.partner }} title={`Partner fee $${r.partner.toFixed(2)}`} />
            <i className="dg-fee-ours" style={{ flexGrow: r.ours }} title={`Our fee $${r.ours.toFixed(2)}`} />
          </span>
        </div>
      ))}
      <figcaption id="dg-fees-cap" className="dg-cap dg-legend">
        <span>
          <i className="dg-sw dg-fee-you" /> You receive
        </span>
        <span>
          <i className="dg-sw dg-fee-partner" /> Partner fee (2.9% + 30¢ in this example)
        </span>
        <span>
          <i className="dg-sw dg-fee-ours" /> Our fee ({pricing.partnerProcessed.rate}, max {pricing.partnerProcessed.cap})
        </span>
      </figcaption>
    </figure>
  );
}

// Partners: how a provider or lender goes live.
export function JoinSteps() {
  const steps: [string, string][] = [
    ["Request", "Tell us what you're licensed for, where."],
    ["Invite", "Approved partners get a workspace."],
    ["Connect", "Build to our API, or map yours. Test in sandbox."],
    ["Certify", "Automated checks, then live payments."],
  ];
  return (
    <ol className="dg dg-steps">
      {steps.map(([title, text], i) => (
        <li key={title}>
          <span className="dg-step">{i + 1}</span>
          <b>{title}</b>
          <span>{text}</span>
        </li>
      ))}
    </ol>
  );
}

// Partners: where each kind of partner sits between merchants and customers.
export function PartnerMap() {
  return (
    <figure className="dg dg-partners" aria-label="Where providers and lenders sit">
      <div className="dg-pm">
        <div className="dg-node">
          <span className="dg-node-title">Merchants</span>
          <span className="dg-chip">One checkout button</span>
        </div>
        <Arrow />
        <div className="dg-node dg-hub">
          <span className="dg-node-title">PayRouta</span>
          <span className="dg-chip">Routing, ledger, payouts</span>
        </div>
        <Arrow />
        <div className="dg-pm-partners">
          <div className="dg-node">
            <span className="dg-node-title">Payment providers</span>
            <span className="dg-chip">Process cards, banks, wallets, mobile money</span>
          </div>
          <div className="dg-node dg-node-credit">
            <span className="dg-node-title">Lenders</span>
            <span className="dg-chip">Offer plans, approve customers, pay merchants</span>
          </div>
        </div>
      </div>
    </figure>
  );
}

// 5. Continental credit switches & 4-stage asynchronous credit lifecycle.
export function ContinentalCreditMap() {
  const continents = [
    { region: "North America", currencies: "USD · CAD", rails: ["Affirm", "Afterpay", "Klarna", "Zip", "Visa Installments"] },
    { region: "Europe & UK", currencies: "EUR · GBP · SEK", rails: ["Klarna", "Clearpay", "Alma", "PayPal Credit", "PSD2 Overdraft"] },
    { region: "Latin America", currencies: "BRL · MXN · COP", rails: ["Mercado Crédito", "Kueski Pay", "Addi", "NuPay", "Open Finance"] },
    { region: "Africa", currencies: "NGN · KES · GHS · ZAR", rails: ["Migo Credit", "Carbon POS", "CredPal", "Wallet Credit Draw"] },
    { region: "Asia-Pacific", currencies: "IDR · SGD · MYR · INR · AUD", rails: ["Kredivo", "Akulaku", "Atome", "Grab PayLater", "UPI Credit Line"] },
  ];
  return (
    <figure className="dg dg-credit-mesh" aria-label="Continental credit coverage and 4-stage credit lifecycle">
      <div className="dg-mesh-grid">
        {continents.map((c) => (
          <div key={c.region} className="dg-node">
            <span className="dg-node-title">{c.region}</span>
            <span className="dg-chip">{c.currencies}</span>
            <span className="dg-network">
              {c.rails.map((r) => (
                <i key={r}>{r}</i>
              ))}
            </span>
          </div>
        ))}
      </div>
      <ol className="dg dg-steps" style={{ marginTop: 20 }}>
        <li>
          <span className="dg-step">1</span>
          <b>checkout.initiated</b>
          <span>Localized plans priced for the exact basket.</span>
        </li>
        <li>
          <span className="dg-step">2</span>
          <b>credit.pending_approval</b>
          <span>Inventory locked while lender underwrites.</span>
        </li>
        <li>
          <span className="dg-step">3</span>
          <b>credit.disbursed</b>
          <span>Lender approves and disburses full principal.</span>
        </li>
        <li>
          <span className="dg-step">4</span>
          <b>payment.succeeded</b>
          <span>Principal settles in fiat or USDC.</span>
        </li>
      </ol>
    </figure>
  );
}

