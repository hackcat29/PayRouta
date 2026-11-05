"use client";
// The Intents-first demo checkout (lib/intents/demo.ts): a store with one
// PayRouta button. The customer pays with any token on any chain, or any
// token by its contract address; the merchant chooses what it is paid in.
// Quotes are live NEAR Intents (1Click) dry quotes; the payment itself is
// simulated, because a dry quote opens no deposit address.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { TokenIcon } from "../[sessionId]/token-icon";
import "./demo.css";

type Token = { assetId: string; symbol: string; chain: string; chainName: string; price: number; decimals: number; contract: string | null };
type Catalog = {
  tokens: Token[];
  chains: number;
  stablecoins: { assetId: string; symbol: string; chain: string; chainName: string }[];
  fiat: readonly { code: string; label: string; partner: string }[];
};
type DexToken = { chain: string; chainName: string; address: string; symbol: string; name: string; price: number };
type Receive = { kind: "stable"; assetId: string } | { kind: "token"; assetId: string } | { kind: "fiat"; code: string };
type Quote = {
  route: "direct" | "intents" | "dex";
  pay: { amount: string; symbol: string; chainName: string; usd: string | null; name?: string };
  via?: { symbol: string; chainName: string; amount: string; swapper: string };
  direct?: boolean;
  deliver: { amount: string; symbol: string; chainName: string };
  convert: { amount: string; symbol: string; chainName: string } | null;
  cashOut: { currency: string; label: string; partner: string } | null;
  timeEstimate: number | null;
};
type Choice = { kind: "listed"; token: Token } | { kind: "dex"; token: DexToken };

const stable = ["USDC", "USDT", "USDT0", "EURC", "DAI"];
const majors = ["BTC", "ETH", "SOL", "wNEAR", "NEAR", "BNB", "TRX", "TON", "XRP", "SUI", "DOGE", "AVAX", "POL", "LTC", "ZEC", "ADA", "APT", "XLM", "BCH"];
// Each coin's own chain comes before its bridged copies.
const home: Record<string, string> = {
  BTC: "btc", ETH: "eth", SOL: "sol", wNEAR: "near", NEAR: "near", BNB: "bsc", TRX: "tron", TON: "ton", XRP: "xrp", SUI: "sui",
  DOGE: "doge", AVAX: "avax", POL: "pol", LTC: "ltc", ZEC: "zec", ADA: "cardano", APT: "aptos", XLM: "stellar", BCH: "bch",
  USDC: "base", USDT: "tron",
};
const rank = (t: Token) => {
  const m = majors.indexOf(t.symbol),
    s = stable.indexOf(t.symbol),
    away = home[t.symbol] && home[t.symbol] !== t.chain ? 50 : 0;
  return (m >= 0 ? m : s >= 0 ? 30 + s : 100) + away;
};
const isAddress = (q: string) => /^0x[0-9a-fA-F]{40}$/.test(q) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(q);
const errorCopy: Record<string, string> = {
  CROSS_CHAIN_AMOUNT_TOO_SMALL: "That's below this route's minimum. Raise the order total or pick another token.",
  CROSS_CHAIN_QUOTE_REFUSED: "No solver can fill that route right now. Try another token.",
  CROSS_CHAIN_RATE_LIMITED: "NEAR Intents is busy. Try again in a few seconds.",
  CROSS_CHAIN_UNAVAILABLE: "NEAR Intents didn't answer. Try again in a few seconds.",
  DEX_NO_ROUTE: "That token has no DEX route into USDC.",
  DEX_ADDRESS_INVALID: "That isn't a Solana or EVM contract address.",
  DEX_UNAVAILABLE: "Token lookup is unavailable right now.",
};

async function call(body?: object) {
  const r = await fetch("/api/demo/intents", body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const b = await r.json().catch(() => null);
  if (!r.ok) throw new Error(errorCopy[b?.error] ?? (r.status === 429 ? "Too many requests. Wait a moment." : "Something went wrong. Try again."));
  return b;
}


export function IntentsDemo() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loadError, setLoadError] = useState("");
  const [total, setTotal] = useState(25);
  const [receive, setReceive] = useState<Receive | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    call()
      .then((c: Catalog) => {
        setCatalog(c);
        setReceive({ kind: "stable", assetId: c.stablecoins[0].assetId });
      })
      .catch((e) => setLoadError(e.message));
  }, []);
  const convertTargets = useMemo(
    () => (catalog ? [...catalog.tokens].filter((t) => majors.includes(t.symbol) || stable.includes(t.symbol)).sort((a, b) => rank(a) - rank(b) || a.chainName.localeCompare(b.chainName)) : []),
    [catalog],
  );
  const kind = receive?.kind ?? "stable";
  return (
    <div className="idemo">
      <p className="idemo-banner">Demo · live NEAR Intents quotes · no money moves</p>
      <header className="idemo-hero">
        <h1>One checkout button. Any token, any chain, any wallet.</h1>
      </header>
      {loadError && <p className="idemo-error" role="alert">{loadError}</p>}
      <div className="idemo-grid">
        <section className="idemo-panel" aria-labelledby="merchant-h">
          <h2 id="merchant-h">Get paid in</h2>
          <div className="idemo-tabs" role="tablist" aria-label="Get paid in">
            {(
              [
                ["stable", "Stablecoin"],
                ["token", "Any token"],
                ["fiat", "Your bank"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                role="tab"
                aria-selected={kind === k}
                disabled={!catalog}
                onClick={() => {
                  if (!catalog) return;
                  setReceive(
                    k === "stable"
                      ? { kind: "stable", assetId: catalog.stablecoins[0].assetId }
                      : k === "token"
                        ? { kind: "token", assetId: convertTargets.find((t) => t.symbol === "wNEAR" && t.chain === "near")?.assetId ?? convertTargets[0].assetId }
                        : { kind: "fiat", code: "NGN" },
                  );
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {catalog && receive && (
            <label className="idemo-field">
              <select
                aria-label="Get paid in"
                value={receive.kind === "fiat" ? receive.code : receive.assetId}
                onChange={(e) =>
                  setReceive(receive.kind === "fiat" ? { kind: "fiat", code: e.target.value } : { kind: receive.kind, assetId: e.target.value })
                }
              >
                {kind === "stable" &&
                  catalog.stablecoins.map((s) => (
                    <option key={s.assetId} value={s.assetId}>
                      {s.symbol} on {s.chainName}
                    </option>
                  ))}
                {kind === "token" &&
                  convertTargets.map((t) => (
                    <option key={t.assetId} value={t.assetId}>
                      {t.symbol} on {t.chainName}
                    </option>
                  ))}
                {kind === "fiat" &&
                  catalog.fiat.map((f) => (
                    <option key={f.code} value={f.code}>
                      {f.code} · {f.label}
                    </option>
                  ))}
              </select>
            </label>
          )}
          <h2>Add to any site</h2>
          <pre className="idemo-code">
            <code>{`<script src="https://payrouta.com/js/v1/payrouta.js" async></script>
<button data-payrouta-checkout="/create-checkout">
  Checkout
</button>`}</code>
          </pre>
        </section>

        <section className="idemo-panel idemo-store" aria-labelledby="store-h">
          <div className="idemo-product">
            <div className="idemo-art" aria-hidden="true">
              ◐
            </div>
            <div>
              <h2 id="store-h">Studio headphones</h2>
              <label className="idemo-total">
                <span aria-hidden="true">$</span>
                <input aria-label="Order total in USD" type="number" min={1} max={10000} step={1} value={total} onChange={(e) => setTotal(Math.max(1, Math.min(10000, Number(e.target.value) || 1)))} />
              </label>
            </div>
          </div>
          <button className="idemo-checkout" disabled={!catalog || !receive} onClick={() => setOpen(true)}>
            Checkout · ${total.toFixed(2)}
          </button>
        </section>
      </div>
      {open && catalog && receive && (
        <CheckoutModal catalog={catalog} total={total} receive={receive} onClose={() => setOpen(false)} />
      )}
      <footer className="idemo-footer">
        <Link href="/docs/cross-chain">How cross-chain checkout works</Link>
        <Link href="/docs/checkout-button">Add the checkout button</Link>
        <Link href="/sign-up">Start accepting payments</Link>
      </footer>
    </div>
  );
}

function CheckoutModal({ catalog, total, receive, onClose }: { catalog: Catalog; total: number; receive: Receive; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<DexToken[] | null>(null);
  const [looking, setLooking] = useState(false);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [error, setError] = useState("");
  const [step, setStep] = useState(-1);
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    dialog.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const q = query.trim();
  const rows = useMemo(() => {
    const needle = q.toLowerCase();
    return catalog.tokens
      .filter((t) => !needle || t.symbol.toLowerCase().includes(needle) || t.chainName.toLowerCase().includes(needle) || t.contract?.toLowerCase() === needle)
      .sort((a, b) => rank(a) - rank(b) || a.symbol.localeCompare(b.symbol) || a.chainName.localeCompare(b.chainName))
      .slice(0, 60);
  }, [catalog, q]);

  // A pasted address that isn't listed is looked up on the DEXes.
  useEffect(() => {
    if (!isAddress(q) || rows.length) return;
    let alive = true;
    const t = setTimeout(() => {
      setLooking(true);
      call({ action: "lookup", address: q })
        .then((r: { tokens: DexToken[] }) => alive && setFound(r.tokens))
        .catch((e) => alive && setError(e.message))
        .finally(() => alive && setLooking(false));
    }, 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, rows.length]);

  const fetchQuote = useCallback(
    async (c: Choice) => {
      setChoice(c);
      setQuote(null);
      setError("");
      setQuoting(true);
      try {
        const r =
          c.kind === "listed"
            ? await call({ action: "quote", input: { originAsset: c.token.assetId, receive, usd: total } })
            : await call({ action: "dex-quote", input: { chain: c.token.chain, address: c.token.address, receive, usd: total } });
        setQuote(r);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setQuoting(false);
      }
    },
    [receive, total],
  );

  // Live prices move: re-quote every 20 seconds until the customer pays.
  useEffect(() => {
    if (!choice || step >= 0) return;
    const t = setInterval(() => void fetchQuote(choice), 20000);
    return () => clearInterval(t);
  }, [choice, step, fetchQuote]);

  const steps = useMemo(() => {
    if (!quote) return [];
    const s: string[] = [];
    if (quote.route === "dex" && quote.via) s.push(`Your wallet swaps ${quote.pay.amount} ${quote.pay.symbol} into ${quote.via.amount} USDC on ${quote.via.chainName} (${quote.via.swapper})`);
    else s.push(`You send ${quote.pay.amount} ${quote.pay.symbol} on ${quote.pay.chainName} from any wallet or exchange`);
    if (quote.route === "intents" || (quote.route === "dex" && !quote.direct)) s.push("NEAR Intents solvers compete to fill the swap");
    s.push(`Exactly ${quote.deliver.amount} ${quote.deliver.symbol} lands in the merchant's NEAR Intents account`);
    if (quote.convert) s.push(`Merchant converts to ${quote.convert.amount} ${quote.convert.symbol} on ${quote.convert.chainName}, one signature, no gas`);
    if (quote.cashOut) s.push(`Merchant cashes out in ${quote.cashOut.currency} through ${quote.cashOut.partner}`);
    return s;
  }, [quote]);

  useEffect(() => {
    if (step < 0 || step >= steps.length) return;
    const t = setTimeout(() => setStep((n) => n + 1), 1300);
    return () => clearTimeout(t);
  }, [step, steps.length]);

  const done = step >= steps.length && steps.length > 0;
  const back = () => {
    setChoice(null);
    setQuote(null);
    setError("");
    setStep(-1);
  };

  return (
    <div className="idemo-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="idemo-modal" role="dialog" aria-modal="true" aria-labelledby="pay-h" tabIndex={-1} ref={dialog}>
        <div className="idemo-modal-head">
          <div>
            <p className="idemo-muted">Harbor Audio</p>
            <p className="idemo-amount">${total.toFixed(2)}</p>
          </div>
          <button className="idemo-close" onClick={onClose} aria-label="Close checkout">
            ×
          </button>
        </div>

        {!choice && (
          <>
            <h2 id="pay-h">What do you want to pay with?</h2>
            <input
              className="idemo-search"
              autoFocus
              placeholder="Token, chain or contract address"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setFound(null);
                setLooking(false);
                setError("");
              }}
              aria-label="Search tokens"
            />
            <ul className="idemo-list" aria-label="Tokens">
              {rows.map((t) => (
                <li key={t.assetId}>
                  <button onClick={() => void fetchQuote({ kind: "listed", token: t })}>
                    <TokenIcon symbol={t.symbol} size={30} />
                    <span className="idemo-tok">
                      <strong>{t.symbol}</strong>
                      <span>{t.chainName}</span>
                    </span>
                    <span className="idemo-approx">≈ {(total / t.price).toPrecision(4)}</span>
                  </button>
                </li>
              ))}
              {found?.map((t) => (
                <li key={`${t.chain}:${t.address}`}>
                  <button onClick={() => void fetchQuote({ kind: "dex", token: t })}>
                    <TokenIcon symbol={t.symbol} size={30} />
                    <span className="idemo-tok">
                      <strong>
                        {t.symbol} <em className="idemo-tag">by address</em>
                      </strong>
                      <span>
                        {t.name} · {t.chainName}
                      </span>
                    </span>
                    <span className="idemo-approx">≈ {(total / t.price).toPrecision(4)}</span>
                  </button>
                </li>
              ))}
            </ul>
            {looking && <p className="idemo-muted" role="status">Looking up…</p>}
            {found && !found.length && !looking && <p className="idemo-muted">No token with DEX liquidity at that address.</p>}
          </>
        )}

        {choice && step < 0 && (
          <>
            <button className="idemo-back" onClick={back}>
              ← Choose another token
            </button>
            <h2 id="pay-h">
              Pay with {choice.token.symbol} on {choice.token.chainName}
            </h2>
            {quoting && !quote && <p className="idemo-muted" role="status">Quoting…</p>}
            {quote && (
              <>
                <dl className="idemo-quote">
                  <div>
                    <dt>You pay</dt>
                    <dd>
                      <strong>
                        {quote.route === "dex" ? "≈ " : ""}
                        {quote.pay.amount} {quote.pay.symbol}
                      </strong>
                      {quote.pay.usd && <span> ≈ ${Number(quote.pay.usd).toFixed(2)}</span>}
                    </dd>
                  </div>
                  <div>
                    <dt>Merchant receives</dt>
                    <dd>
                      <strong>
                        Exactly {quote.deliver.amount} {quote.deliver.symbol}
                      </strong>
                      <span> on {quote.deliver.chainName}</span>
                    </dd>
                  </div>
                  {quote.convert && (
                    <div>
                      <dt>Merchant keeps it as</dt>
                      <dd>
                        <strong>
                          {quote.convert.amount} {quote.convert.symbol}
                        </strong>
                        <span> on {quote.convert.chainName}</span>
                      </dd>
                    </div>
                  )}
                  {quote.cashOut && (
                    <div>
                      <dt>Merchant is paid in</dt>
                      <dd>
                        <strong>{quote.cashOut.currency}</strong>
                        <span> via {quote.cashOut.partner}</span>
                      </dd>
                    </div>
                  )}
                  <div>
                    <dt>Route</dt>
                    <dd>
                      {quote.route === "direct"
                        ? "Direct transfer, no swap needed"
                        : quote.route === "dex"
                          ? `${quote.via?.swapper} → USDC${quote.direct ? "" : " → NEAR Intents"}`
                          : "NEAR Intents exact-output swap"}
                      {quote.timeEstimate ? <span> · about {quote.timeEstimate}s</span> : null}
                    </dd>
                  </div>
                </dl>
                <button className="idemo-checkout" onClick={() => setStep(0)}>
                  Pay {quote.route === "dex" ? "≈ " : ""}
                  {quote.pay.amount} {quote.pay.symbol}
                </button>
              </>
            )}
          </>
        )}

        {step >= 0 && (
          <>
            <h2 id="pay-h">{done ? "Payment complete" : "Paying…"}</h2>
            <ol className="idemo-progress">
              {steps.map((s, i) => (
                <li key={s} data-state={i < step ? "done" : i === step ? "active" : "todo"}>
                  {s}
                </li>
              ))}
            </ol>
            {done && quote && (
              <div className="idemo-receipt" role="status">
                <p>
                  <strong>Merchant received</strong>{" "}
                  {quote.convert
                    ? `${quote.convert.amount} ${quote.convert.symbol}`
                    : quote.cashOut
                      ? `$${quote.deliver.amount} in ${quote.cashOut.currency}`
                      : `${quote.deliver.amount} ${quote.deliver.symbol}`}

                </p>
                <button className="idemo-checkout" onClick={back}>
                  Try another token
                </button>
              </div>
            )}
          </>
        )}
        {error && (
          <p className="idemo-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
