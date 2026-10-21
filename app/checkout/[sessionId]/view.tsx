"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { comingSoonMethods } from "@/lib/payments/launch-catalog";
import { WalletButton } from "./wallet-button";
import {
  displayTokenAmount,
  validateStablecoinPayment,
} from "@/lib/blockchain/stablecoin-payment";
import type { DepositPayment } from "@/lib/blockchain/wallet-payment";
import { checkoutCountdown } from "@/lib/payments/checkout-display";
import { chain, networkName } from "@/lib/blockchain/chains";
import { returnHandler, switchCheckout, usePopupBridge } from "./popup";
import { CrossChain } from "./cross-chain";
import "./checkout.css";
import { errorText, shown } from "@/lib/error-copy";
type Action = {
  kind: string;
  text: string;
  address?: string;
  network?: string;
  identifier?: string;
  amount?: string;
  symbol?: string;
  image?: string;
};
type Progress = {
  // Universal checkout: the order's other checkout.
  alternatives?: { kind: "fiat" | "crypto"; available: boolean }[];
  method?: string;
  paymentMethods?: Method[];
  cryptoQuote?: { usdAmount: string; source: string } | null;
  paymentOptions?: {
    id: string;
    network: string;
    symbol: string;
    amount: string;
    available: boolean;
    identifier: string;
    method?: string;
  }[];
  selectedOption?: string;
  chainLocked?: boolean;
  merchant: string;
  reference: string;
  amount: string;
  // Set when the merchant passes fees to the customer.
  customerFee?: string | null;
  state: string;
  attemptState?: string;
  attemptId?: string;
  action?: Action;
  symbol?: string;
  network?: string;
  sandbox: boolean;
  expiresAt: string;
  returnUrl: string;
  settlement: string[];
};
type Method = {
  method: string;
  label?: string;
  status: string;
  explanation?: string;
};
const demoData: Progress = {
  merchant: "Example store",
  reference: "Checkout preview",
  amount: "1.000000",
  symbol: "USDC",
  network: "eip155:84532",
  sandbox: true,
  state: "Preview",
  expiresAt: "",
  returnUrl: "/merchant",
  settlement: [],
};
export function Checkout({ id }: { id: string }) {
  const [data, setData] = useState<Progress | undefined>(() =>
      id === "demo" ? demoData : undefined,
    ),
    [options, setOptions] = useState<Method[]>(() =>
      id === "demo"
        ? [
            { method: "stablecoin", label: "Stablecoins", status: "AVAILABLE" },
            ...comingSoonMethods,
          ]
        : [],
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [copied, setCopied] = useState(""),
    [walletLink, setWalletLink] = useState("");
  const [clock, setClock] = useState(0);
  const current = useRef<Progress | undefined>(undefined),
    exchange = useRef<Promise<unknown> | null>(null),
    mutating = useRef(false),
    mutationVersion = useRef(0);
  const api = useCallback(
    async (action?: object) => {
      const r = await fetch(
        `/api/checkout/${id}`,
        action
          ? {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(action),
            }
          : { cache: "no-store" },
      );
      const b = await r.json().catch(() => null);
      if (!r.ok)
        throw new Error(
          b?.error === "CHECKOUT_EXPIRED_OR_UNAUTHORIZED"
            ? "This checkout link is incomplete, expired or no longer available. Open the full checkout link from the merchant. To switch browsers, use ‘Copy link for wallet browser’ in the original checkout."
            : b?.error === "CHECKOUT_EXPIRED"
              ? "This quote has expired. Return to the merchant for a new checkout with an updated rate."
              : errorText(b, r.status),
        );
      return b;
    },
    [id],
  );
  const refresh = useCallback(async () => {
    const version = mutationVersion.current;
    const b = await api();
    if (version !== mutationVersion.current) return;
    current.current = b;
    setData(b);
    if (b.paymentMethods) setOptions(b.paymentMethods);
  }, [api]);
  useEffect(() => {
    let alive = true,
      inflight = false,
      ticks = 0;
    if (id === "demo") return;
    async function start() {
      const version = mutationVersion.current;
      try {
        const token = location.hash.slice(1);
        if (token && !exchange.current) {
          exchange.current = api({ action: "exchange", token });
        }
        if (exchange.current) await exchange.current;
        if (token) history.replaceState(null, "", location.pathname);
        const b = await api();
        if (alive && version === mutationVersion.current) {
          setClock(Date.now());
          current.current = b;
          setData(b);
          if (b.paymentMethods) setOptions(b.paymentMethods);
        }
        if (b.attemptId || Date.parse(b.expiresAt) <= Date.now()) {
          if (alive)
            setOptions(
              b.paymentMethods ?? [
                {
                  method: b.method || "stablecoin",
                  label:
                    b.method === "crypto-app" ? "Crypto wallet" : "Stablecoins",
                  status: b.attemptId ? "AVAILABLE" : "UNAVAILABLE",
                },
                ...comingSoonMethods,
              ],
            );
        } else {
          const m = await api({ action: "methods" });
          if (alive) setOptions(m.methods);
        }
      } catch (e) {
        if (alive) setError(shown(e));
      }
    }
    void start();
    const timer = setInterval(async () => {
      setClock(Date.now());
      const p = current.current;
      if (
        !alive ||
        inflight ||
        mutating.current ||
        !p ||
        (p.state === "Confirmed" && p.settlement.length) ||
        (!p.attemptId && Date.parse(p.expiresAt) <= Date.now())
      )
        return;
      inflight = true;
      const version = mutationVersion.current;
      try {
        if (++ticks % 5 === 0 && p.attemptId) await api({ action: "refresh" });
        const b = await api();
        if (alive && version === mutationVersion.current) {
          setClock(Date.now());
          current.current = b;
          setData(b);
          if (b.paymentMethods) setOptions(b.paymentMethods);
        }
      } catch {
        /* Worker recovery continues while the network is unavailable. */
      } finally {
        inflight = false;
      }
    }, 2000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [id, api]);
  async function begin() {
    mutating.current = true;
    mutationVersion.current++;
    setBusy(true);
    setError("");
    try {
      await api({ action: "methods" });
      const selected = await api({
        action: "select",
        method: current.current?.method || "stablecoin",
      });
      await api({ action: "confirm", routeId: selected.routeId });
      await refresh();
    } catch (e) {
      setError(shown(e));
    } finally {
      mutating.current = false;
      setBusy(false);
    }
  }
  async function choose(optionId: string) {
    mutating.current = true;
    mutationVersion.current++;
    setBusy(true);
    setError("");
    try {
      await api({ action: "choose-network", optionId });
      await refresh();
      const methods = await api({ action: "methods" });
      setOptions(methods.methods);
    } catch (e) {
      setError(shown(e));
      await refresh().catch(() => {});
    } finally {
      mutating.current = false;
      setBusy(false);
    }
  }
  async function checkStatus() {
    setBusy(true);
    setError("");
    try {
      const result = await api({ action: "refresh" });
      await refresh();
      setCopied(
        result.queued
          ? "Status check requested. This page will update when the network check completes."
          : "No payment attempt is awaiting a transfer. Return to the merchant for a new checkout.",
      );
    } catch (e) {
      setError(shown(e));
    } finally {
      setBusy(false);
    }
  }
  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(`${label} copied`);
    } catch {
      setCopied("Copy is unavailable. Select and copy the address below.");
    }
  }
  async function copyWalletLink() {
    setBusy(true);
    setError("");
    try {
      const result = await api({ action: "wallet-link" });
      const link = new URL(result.checkoutPath, location.origin).href;
      setWalletLink(link);
      await copy(link, "Wallet browser link");
    } catch (e) {
      setError(shown(e));
    } finally {
      setBusy(false);
    }
  }
  const a = data?.action;
  let payment: DepositPayment | undefined;
  if (
    a?.kind === "deposit" &&
    a.address &&
    a.network &&
    a.identifier &&
    a.amount
  ) {
    try {
      payment = {
        address: a.address,
        network: a.network,
        identifier: a.identifier,
        amount: a.amount,
      };
      validateStablecoinPayment(payment);
    } catch {
      payment = undefined;
    }
  }
  const expired = !!data?.expiresAt && Date.parse(data.expiresAt) <= clock,
    confirmed = data?.state === "Confirmed",
    active = data?.attemptId && data.attemptState !== "Rejected";
  usePopupBridge(id, {
    confirmed,
    pending: data?.attemptState === "Pending",
    returnUrl: data?.returnUrl,
    reference: data?.reference,
    method: data?.method,
  });
  const toMerchant = data ? returnHandler(id, { returnUrl: data.returnUrl, reference: data.reference }) : undefined;
  const visibleMethods = [
    ...["stablecoin", "crypto-app"].map(
      (method) =>
        options.find((m) => m.method === method) ?? {
          method,
          label: method === "stablecoin" ? "Stablecoins" : "Crypto wallet",
          status: "NOT_OFFERED",
          explanation: "Not offered for this checkout",
        },
    ),
    ...comingSoonMethods,
  ];
  return (
    <div className="stablecoin-checkout">
      {data?.sandbox && (
        <div className="sc-test">Testnet · test tokens only · no real money moves</div>
      )}
      <div className="sc-layout">
        <aside className="sc-summary">
          <p className="sc-merchant">
            <span className="sc-avatar" aria-hidden>
              {(data?.merchant || "P").slice(0, 1).toUpperCase()}
            </span>
            <span>
              {data?.merchant ||
                (error ? "Checkout unavailable" : "Loading checkout…")}
            </span>
          </p>
          {data && <p className="sc-label">Pay {data.merchant}</p>}
          <h1>
            {data
              ? `${displayTokenAmount(data.amount)} ${data.symbol || ""}`
              : "Your payment"}
          </h1>
          <p className="sc-network">{networkName(data?.network)}</p>
          {data?.reference && (
            <dl className="sc-lines">
              <div>
                <dt>Order</dt>
                <dd>{data.reference}</dd>
              </div>
              {data.customerFee && (
                <div>
                  <dt>Includes processing fee</dt>
                  <dd>
                    {displayTokenAmount(data.customerFee)} {data.symbol || ""}
                  </dd>
                </div>
              )}
            </dl>
          )}
            {data?.cryptoQuote && (
              <p>
                ${data.cryptoQuote.usdAmount} USD · Rate by{" "}
                {data.cryptoQuote.source}.{" "}
                {confirmed
                  ? "Payment received."
                  : data.attemptState === "Pending"
                    ? "Your transfer was detected. Verification continues after the quote deadline."
                    : "Send the exact coin amount before the quote expires."}{" "}
                Network fees are separate.
              </p>
            )}
            {data?.expiresAt &&
              clock > 0 &&
              !confirmed &&
              data.attemptState !== "Pending" && (
                <p className={`sc-countdown ${expired ? "sc-expired" : ""}`}>
                  {expired ? "Payment window ended" : "Checkout expires in "}
                  {!expired && (
                    <span
                      role="timer"
                      aria-label="Checkout time remaining"
                      aria-live="off"
                    >
                      {checkoutCountdown(data.expiresAt, clock)}
                    </span>
                  )}
                </p>
              )}
        </aside>
        <section className="sc-card" aria-label="Payment">
          {!!data?.paymentOptions?.length &&
            data.attemptState !== "Pending" &&
            !confirmed && (
              <div className="sc-network-picker">
                <div
                  className="sc-method-grid"
                  role="group"
                  aria-label="Choose payment type"
                >
                  {visibleMethods
                    .filter(
                      (m) =>
                        m.method === "stablecoin" || m.method === "crypto-app",
                    )
                    .map((m) => (
                      <button
                        key={m.method}
                        className="sc-method"
                        aria-pressed={data.method === m.method}
                        disabled={
                          busy ||
                          !!data.chainLocked ||
                          expired ||
                          m.status !== "AVAILABLE"
                        }
                        onClick={() => {
                          const choice = data.paymentOptions?.find(
                            (o) => o.method === m.method && o.available,
                          );
                          if (choice && choice.id !== data.selectedOption)
                            void choose(choice.id);
                        }}
                      >
                        {m.label}
                      </button>
                    ))}
                </div>
                <label htmlFor="payment-network">Token and network</label>
                <select
                  id="payment-network"
                  value={data.selectedOption || ""}
                  disabled={busy || !!data.chainLocked || confirmed || expired}
                  onChange={(e) => void choose(e.target.value)}
                >
                  {data.paymentOptions.map((o) => (
                    <option key={o.id} value={o.id} disabled={!o.available}>
                      {o.symbol} · {networkName(o.network)} ·{" "}
                      {displayTokenAmount(o.amount)}
                      {!o.available ? " · Unavailable" : ""}
                    </option>
                  ))}
                </select>
                <p>
                  {data.chainLocked
                    ? "Network locked for this checkout. Send only the token shown above."
                    : "Choose a token and network accepted by this merchant."}
                </p>
              </div>
            )}
          {data?.alternatives?.some((x) => x.kind === "fiat" && x.available) &&
            !active &&
            !confirmed &&
            !expired && (
              <button
                type="button"
                className="sc-switch"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  switchCheckout(id, "fiat").catch((e) => {
                    setError(shown(e));
                    setBusy(false);
                  });
                }}
              >
                Pay with card, digital wallet, bank transfer, mobile money or credit instead →
              </button>
            )}
          {error && (
            <p role="alert" className="sc-error">
              {error}
            </p>
          )}
          {!data && error && (
            <section>
              <h2>Open your original checkout link</h2>
              <p>
                A link copied from the address bar may be missing its access
                token. Your wallet browser needs the complete merchant link. If
                its payment countdown has ended, request a new checkout.
              </p>
              <Link className="sc-primary" href="/">
                Return to PayRouta
              </Link>
            </section>
          )}
          {confirmed ? (
            <section role="status">
              <h2>Payment received</h2>
              <p>Your transfer was verified on the finalized chain.</p>
              <p>
                {data.settlement.length
                  ? "Settled to the merchant’s receive address."
                  : "Updating the settlement record…"}
              </p>
              <a className="sc-primary" href={data.returnUrl} onClick={toMerchant}>
                Return to merchant
              </a>
            </section>
          ) : data?.attemptState === "Pending" ? (
            <section role="status">
              <h2>Payment detected</h2>
              <p>Your transfer is visible on the network. Do not send again.</p>
              <p>
                We are waiting for network finality before confirming payment.
                This can take several minutes. You can keep this page open.
              </p>
              <button disabled={busy} onClick={() => void checkStatus()}>
                Check payment status
              </button>
              <p role="status">{copied}</p>
            </section>
          ) : expired ? (
            <section role="status">
              <h2>Checkout expired</h2>
              <p>
                {active
                  ? "If you already sent the transfer, keep this page open. We are waiting for network finality and will show the verified outcome here."
                  : "Return to the merchant to request a new checkout."}
              </p>
              {active && (
                <button disabled={busy} onClick={() => void checkStatus()}>
                  {busy ? "Checking…" : "Check payment status"}
                </button>
              )}
              <p role="status">{copied}</p>
              <a className="sc-primary" href={data.returnUrl} onClick={toMerchant}>
                Return to merchant for a new checkout
              </a>
              <p>
                Do not send to expired payment instructions. If you already
                paid, check the status before starting another payment.
              </p>
            </section>
          ) : payment ? (
            <section>
              <h2>
                Pay {displayTokenAmount(payment.amount)} {a?.symbol}
              </h2>
              <p>
                Send the exact amount on{" "}
                <strong>{networkName(payment.network)}</strong>. Your wallet
                also needs {data?.sandbox ? "test " : ""}
                {chain(payment.network)?.nativeAssetSymbol} for the network fee.
              </p>
              <WalletButton
                payment={payment}
                api={api}
                expiresAt={data?.expiresAt}
                disabled={busy}
                onSubmitted={() => {
                  void api({ action: "refresh" })
                    .then(refresh)
                    .catch(() => {});
                }}
              />
              <details open>
                <summary>Send from another wallet</summary>
                <div className="sc-deposit">
                  {a?.image && (
                    <Image
                      unoptimized
                      src={a.image}
                      width="240"
                      height="240"
                      alt="Stablecoin transfer QR code"
                    />
                  )}
                  <div>
                    <label>Exact amount</label>
                    <code>
                      {displayTokenAmount(payment.amount)} {a?.symbol}
                    </code>
                    <button onClick={() => copy(payment!.amount, "Amount")}>
                      Copy exact amount
                    </button>
                    <label>Merchant receive address</label>
                    <code>{payment.address}</code>
                    <button onClick={() => copy(payment!.address, "Address")}>
                      Copy address
                    </button>
                    <label>
                      {chain(payment.network)?.family === "solana"
                        ? "Token mint"
                        : chain(payment.network)?.family === "stellar"
                          ? "Token and issuer"
                          : "Token contract"}
                    </label>
                    <code>
                      {payment.identifier.slice(
                        payment.identifier.indexOf(":") + 1,
                      )}
                    </code>
                    <p>
                      Use the exact token and network above. Send once; multiple
                      transfers and incorrect amounts need merchant review.
                    </p>
                  </div>
                </div>
              </details>
              <CrossChain api={api} onCopy={(v, l) => void copy(v, l)} />
              <p role="status">{copied}</p>
              <p className="sc-pending">
                Waiting for your transfer. After it is detected, network
                finality can take several minutes before confirmation. You can
                keep this page open to see progress.
              </p>
            </section>
          ) : active ? (
            <section role="status">
              <h2>Preparing payment instructions</h2>
              <p>
                This usually takes a few seconds. Your payment will only be
                confirmed after the transfer is finalized.
              </p>
            </section>
          ) : (
            <section>
              <h2>Choose how to pay</h2>
              <p>
                {data?.method === "crypto-app"
                  ? "Pay from your Web3 wallet using the coin and network selected above."
                  : "Pay stablecoins from your wallet."}
              </p>
              {id === "demo" ? (
                <p className="sc-preview">
                  This is a preview. Create a test checkout to get a real
                  receive address.
                </p>
              ) : (
                <button
                  className="sc-primary"
                  disabled={
                    busy ||
                    !options.some(
                      (m) =>
                        m.method === (data?.method || "stablecoin") &&
                        m.status === "AVAILABLE",
                    )
                  }
                  onClick={begin}
                >
                  {busy
                    ? "Preparing…"
                    : data?.method === "crypto-app"
                      ? "Continue with crypto wallet"
                      : "Continue with stablecoins"}
                </button>
              )}
              {options.find((m) => m.method === (data?.method || "stablecoin"))
                ?.status === "UNAVAILABLE" && (
                <p>
                  This merchant has not configured this token and network yet.
                </p>
              )}
            </section>
          )}
          {data && !expired && !confirmed && (
            <details>
              <summary>Open in an external wallet browser</summary>
              <p>
                Copy this secure link and paste it into your wallet’s browser.
                The same amount, payment and countdown apply. Keep the link
                private.
              </p>
              <button disabled={busy} onClick={() => void copyWalletLink()}>
                Copy link for wallet browser
              </button>
              {walletLink && (
                <p>
                  <label htmlFor="wallet-checkout-link">
                    Wallet browser link
                  </label>
                  <input
                    id="wallet-checkout-link"
                    readOnly
                    value={walletLink}
                    onFocus={(e) => e.currentTarget.select()}
                  />
                </p>
              )}
              {walletLink &&
                ["localhost", "127.0.0.1", "[::1]"].includes(
                  new URL(walletLink).hostname,
                ) && (
                  <p>
                    This local test link works only on this computer. A phone
                    wallet needs a checkout hosted at a reachable web address.
                  </p>
                )}
              <p role="status">{copied}</p>
            </details>
          )}
          <section className="sc-methods" aria-label="Payment methods">
            <h2>Payment methods</h2>
            <div className="sc-method-grid">
              {visibleMethods
                .filter((m) => m.status !== "COMING_SOON")
                .map((m) => (
                  <MethodTile key={m.method} m={m} selected={data?.method === m.method} />
                ))}
            </div>
            {visibleMethods.some((m) => m.status === "COMING_SOON") && (
              <details className="sc-more">
                <summary>Other payment methods</summary>
                <div className="sc-method-grid">
                  {visibleMethods
                    .filter((m) => m.status === "COMING_SOON")
                    .map((m) => (
                      <MethodTile key={m.method} m={m} selected={false} />
                    ))}
                </div>
              </details>
            )}
          </section>
          <footer className="sc-footer">
            <span>
              Powered by <strong>PayRouta</strong>
            </span>
            <Link href="/terms" target="_blank">
              Terms
            </Link>
            <Link href="/privacy" target="_blank">
              Privacy
            </Link>
          </footer>
        </section>
      </div>
    </div>
  );
}

function MethodTile({ m, selected }: { m: Method; selected: boolean }) {
  return (
    <div className={`sc-method ${m.status === "COMING_SOON" ? "sc-disabled" : ""}`}>
      <span>{m.label || m.method}</span>
      <span className="sc-tag">
        {m.status === "COMING_SOON"
          ? "Coming soon"
          : m.status === "AVAILABLE"
            ? "Available"
            : m.status === "NOT_OFFERED"
              ? "Not offered for this checkout"
              : m.status === "LOCKED"
                ? selected
                  ? "Selected"
                  : "Locked"
                : "Unavailable"}
      </span>
    </div>
  );
}
