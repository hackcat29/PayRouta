import Link from "next/link";
import { CheckCircle, XCircle, Warning, ArrowsClockwise } from "@phosphor-icons/react/dist/ssr";
import { headlineStats, lines, type LineKey } from "@/content/claims";
import { Btn, Kicker, LineBadge } from "./ui";
import { LineBundle } from "./route-map";
import { flags, stripCountries } from "./flags";

export function FlagStrip() {
  const loop = [...stripCountries, ...stripCountries];
  return (
    <div
      className="mk-flagstrip"
      role="img"
      aria-label={`Local payment methods by country: ${stripCountries.map(([, n, m]) => `${n}, ${m}`).join("; ")}`}
    >
      <div className="mk-flagstrip-track" aria-hidden="true">
        {loop.map(([code, name, method], i) => {
          const Flag = flags[code];
          return (
            <div className="mk-flagstrip-item" key={code + i}>
              <span className="flag">
                <Flag />
              </span>
              {name}
              <small>{method}</small>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function Stats() {
  return (
    <div className="mk-stats" data-reveal>
      {headlineStats.map((s) => (
        <div className="mk-stat" key={s.label}>
          <strong>{s.value}</strong>
          <span>{s.label}</span>
        </div>
      ))}
    </div>
  );
}

function Phone({ win }: { win: boolean }) {
  return (
    <div className="mk-phone" aria-hidden="true">
      <div className="mk-phone-screen">
        <div className="mk-phone-head">
          <span>Northwind Outfitters</span>
          <span>Order #2291</span>
        </div>
        <div className="mk-phone-amount">€240.00</div>
        <div className="mk-phone-method">
          <span className="mk-bullet sm" style={{ background: lines.card.color }}>
            C
          </span>
          Card •••• 4242
        </div>
        <div className="mk-phone-states">
          <div className="mk-state s1">
            <div className="bar" style={{ background: "var(--ink)", color: "#fff" }}>
              <span className="mk-spinner" /> Processing
            </div>
          </div>
          <div className="mk-state s2">
            <span className="log">
              <Warning size={13} weight="fill" color="#9c2b14" /> provider_a · 504 gateway timeout
            </span>
            <div className="bar" style={{ background: "var(--ink)", color: "#fff" }}>
              <span className="mk-spinner" /> Processing
            </div>
          </div>
          <div className="mk-state s3">
            {win ? (
              <>
                <span className="log">
                  <ArrowsClockwise size={13} weight="bold" /> retry · provider_b · same method
                </span>
                <div className="bar" style={{ background: "var(--ink)", color: "#fff" }}>
                  <span className="mk-spinner" /> Confirming
                </div>
              </>
            ) : (
              <div className="bar" style={{ background: "#ffe1da", color: "#9c2b14" }}>
                <XCircle size={18} weight="fill" /> Payment failed
              </div>
            )}
          </div>
          <div className="mk-state s4">
            {win ? (
              <div className="bar" style={{ background: "var(--mint)", color: "var(--ink)" }}>
                <CheckCircle size={18} weight="fill" /> Paid · €240.00
              </div>
            ) : (
              <>
                <span className="log">customer left checkout</span>
                <div className="bar" style={{ background: "var(--paper-2)", color: "#4b5a61" }}>
                  Cart abandoned
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function Versus() {
  return (
    <div className="mk-versus">
      <article className="mk-card mk-versus-card" data-reveal>
        <header>
          <span className="mk-tag bad">One provider</span>
          <span>Outage = lost sale</span>
        </header>
        <div>
          <h3 className="mk-h3">Their bad day becomes your bad day.</h3>
          <p className="mk-body">
            A timeout, a maintenance window, a degraded acquirer — with a single
            provider, every checkout on that route fails until they recover.
          </p>
        </div>
        <Phone win={false} />
      </article>
      <article className="mk-card mk-versus-card win" data-reveal>
        <header>
          <span className="mk-tag good">PayRouta</span>
          <span>Outage = invisible</span>
        </header>
        <div>
          <h3 className="mk-h3">The payment takes the diversion.</h3>
          <p className="mk-body">
            PayRouta rechecks the attempt, then retries on another eligible
            provider for the same method. Your customer keeps the method they
            chose and never sees the error.
          </p>
        </div>
        <Phone win />
      </article>
    </div>
  );
}

const tile = (line: LineKey) => ({ "--tile-line": lines[line].color }) as React.CSSProperties;

export function MethodBento() {
  return (
    <div className="mk-bento">
      <article className="mk-card mk-tile span-4" style={tile("mobile")} data-reveal>
        <LineBadge line="mobile" />
        <h3 className="mk-h3">Mobile money, approved on the customer&apos;s phone.</h3>
        <p className="mk-body">
          Push-to-pay prompts for the wallets hundreds of millions of people use
          every day, with the state machine handled for you.
        </p>
        <div
          className="mk-tile-visual"
          style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16, alignItems: "end" }}
        >
          <div className="mk-rails">
            {["M-Pesa", "MTN MoMo", "Airtel Money", "Orange Money"].map((r) => (
              <span key={r}>{r}</span>
            ))}
          </div>
          <div className="mk-push" aria-hidden="true">
            <small>
              <span>MOBILE WALLET</span>
              <span>now</span>
            </small>
            <p>Approve payment of KES 2,450.00 to Savanna Grocers?</p>
            <div className="btns">
              <span>Decline</span>
              <span>Approve</span>
            </div>
          </div>
        </div>
      </article>
      <article className="mk-card mk-tile span-2" style={tile("card")} data-reveal>
        <LineBadge line="card" />
        <h3 className="mk-h3">Cards, with a backup acquirer.</h3>
        <p className="mk-body">Global and domestic schemes, 3-D Secure, and a second route ready.</p>
        <div className="mk-tile-visual" aria-hidden="true">
          <div className="mk-cardart">
            <span className="chip" />
            <span>•••• •••• •••• 4242</span>
          </div>
        </div>
      </article>
      <article className="mk-card mk-tile span-2" style={tile("bank")} data-reveal>
        <LineBadge line="bank" />
        <h3 className="mk-h3">Instant bank transfers.</h3>
        <p className="mk-body">Account-to-account on the local instant rail, confirmed in real time.</p>
        <div className="mk-tile-visual" aria-hidden="true">
          <div className="mk-kv">
            <div>
              <span>Rail</span>
              <b>Pix</b>
            </div>
            <div>
              <span>Amount</span>
              <b>R$ 389,90</b>
            </div>
            <div>
              <span>Status</span>
              <b style={{ color: "var(--teal)" }}>confirmed</b>
            </div>
          </div>
        </div>
      </article>
      <article className="mk-card mk-tile span-2" style={tile("wallet")} data-reveal>
        <LineBadge line="wallet" />
        <h3 className="mk-h3">One-tap wallets.</h3>
        <p className="mk-body">Device wallets where the customer&apos;s phone supports them.</p>
        <div className="mk-tile-visual" aria-hidden="true">
          <div className="mk-walletbtns">
            <span>Pay with Apple Pay</span>
            <span>Pay with Google Pay</span>
          </div>
        </div>
      </article>
      <article className="mk-card mk-tile span-2" style={tile("crypto")} data-reveal>
        <LineBadge line="crypto" />
        <h3 className="mk-h3">Stablecoins, observed on-chain.</h3>
        <p className="mk-body">USDC with exact-amount matching and finality before confirmation.</p>
        <div className="mk-tile-visual mk-chain" aria-hidden="true">
          <QrGlyph />
          <div className="mk-confirm">
            <span className="mk-mono">USDC · Base</span>
            <span className="meter">
              <i />
            </span>
            <span style={{ color: "#4b5a61" }}>Waiting for finality</span>
          </div>
        </div>
      </article>
    </div>
  );
}

export function Faq({ items, title = "Questions, answered." }: { items: [string, string][]; title?: string }) {
  return (
    <div className="mk-faq">
      <div data-reveal>
        <Kicker n="?">FAQ</Kicker>
        <h2 className="mk-h2">{title}</h2>
        <p className="mk-lead">
          Can&apos;t find what you need?{" "}
          <Link href="/contact" className="mk-link" style={{ marginTop: 0 }}>
            Talk to our team
          </Link>
        </p>
      </div>
      <div className="mk-faq-list">
        {items.map(([q, a]) => (
          <details key={q}>
            <summary>{q}</summary>
            <p>{a}</p>
          </details>
        ))}
      </div>
    </div>
  );
}

export function Closing({
  title = "Your accounts. Every method. One integration.",
  lead = "Open a sandbox, simulate provider outages, and build a checkout that keeps working when a provider doesn't — on payment accounts in your own name.",
  primary = { href: "/merchant", label: "Start building" },
  secondary = { href: "/contact?intent=merchant", label: "Talk to sales" },
}: {
  title?: React.ReactNode;
  lead?: string;
  primary?: { href: string; label: string };
  secondary?: { href: string; label: string };
}) {
  return (
    <section className="mk-section mk-closing">
      <div className="mk-wrap" data-reveal>
        <Kicker n="→">Next stop</Kicker>
        <h2 className="mk-h1">{title}</h2>
        <p className="mk-lead">{lead}</p>
        <div className="mk-actions">
          <Btn href={primary.href} large>
            {primary.label}
          </Btn>
          <Btn href={secondary.href} ghost large>
            {secondary.label}
          </Btn>
        </div>
      </div>
      <LineBundle className="mk-closing-lines" />
    </section>
  );
}

// Deterministic QR-style glyph (decorative; not a scannable code).
function QrGlyph() {
  const n = 21;
  const inFinder = (x: number, y: number) =>
    (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7);
  const cells: [number, number][] = [];
  let seed = 7;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      seed = (seed * 9301 + 49297) % 233280;
      if (!inFinder(x, y) && seed / 233280 > 0.52) cells.push([x, y]);
    }
  const eye = (x: number, y: number) => (
    <g key={`${x}-${y}`}>
      <rect x={x + 0.5} y={y + 0.5} width="6" height="6" fill="none" stroke="currentColor" strokeWidth="1" />
      <rect x={x + 2} y={y + 2} width="3" height="3" fill="currentColor" />
    </g>
  );
  return (
    <svg className="mk-qr" viewBox={`0 0 ${n} ${n}`} shapeRendering="crispEdges">
      {cells.map(([x, y]) => (
        <rect key={`${x}.${y}`} x={x} y={y} width="1" height="1" fill="currentColor" />
      ))}
      {eye(0, 0)}
      {eye(n - 7, 0)}
      {eye(0, n - 7)}
    </svg>
  );
}
