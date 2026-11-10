"use client";
import { MerchantContact, MerchantMark } from "@/components/merchant-mark";
import { VerifiedTick } from "@/components/verified-tick";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
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
import { PayPicker, type PayChoice, type PayToken } from "./pay-picker";
import { Receipt, Steps, eta } from "./progress-steps";
import { solanaProvider, type Connected } from "./swap-wallet";
import { discoverEvmWallets } from "@/lib/blockchain/wallet-discovery";
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
  verified?: boolean;
  logo?: string | null;
  website?: string | null;
  supportEmail?: string | null;
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
  // The customer's transfer, once seen on-chain.
  transaction?: { hash: string; url: string | null } | null;
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
            ? "This checkout link is incomplete or has expired. Open the full link from the merchant."
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
  // What the customer said they pay with, kept for this checkout so a reload
  // returns to the same instructions.
  const [choice, setChoiceState] = useState<PayChoice | null>(() => {
    if (typeof window === "undefined" || id === "demo") return null;
    try {
      return JSON.parse(sessionStorage.getItem(`pay-choice:${id}`) ?? "null");
    } catch {
      return null;
    }
  });
  function remember(next: PayChoice | null) {
    setChoiceState(next);
    try {
      if (next) sessionStorage.setItem(`pay-choice:${id}`, JSON.stringify(next));
      else sessionStorage.removeItem(`pay-choice:${id}`);
    } catch {
      /* The choice still applies for this page view. */
    }
  }
  // The wallet a swap is paid from, kept so the customer can retry.
  const [connected, setConnected] = useState<Connected | null>(null);
  function sentFrom(hash: string) {
    setChoiceState((old) => {
      const next = old ? { ...old, sent: hash } : old;
      try {
        if (next) sessionStorage.setItem(`pay-choice:${id}`, JSON.stringify(next));
      } catch {
        /* Shown for this page view. */
      }
      return next;
    });
  }
  // Pick the option that receives this token, then prepare payment
  // instructions; a swap is quoted once they exist (CrossChain preset), or
  // here, for a swap paid from a connected wallet (`after`).
  async function start(token: PayToken, next: PayChoice, after?: () => Promise<Partial<PayChoice>>) {
    mutating.current = true;
    mutationVersion.current++;
    setBusy(true);
    setError("");
    try {
      if (token.optionId && token.optionId !== current.current?.selectedOption)
        await api({ action: "choose-network", optionId: token.optionId });
      await api({ action: "methods" });
      const selected = await api({ action: "select", method: token.method });
      await api({ action: "confirm", routeId: selected.routeId });
      let extra: Partial<PayChoice> = {};
      if (after)
        try {
          extra = await after();
        } catch (e) {
          const err = e as { code?: number; mayHaveSent?: boolean };
          if (err.mayHaveSent) extra = { sent: "uncertain" };
          setError(err.code === 4001 ? "Payment was cancelled in your wallet. You can pay below." : shown(e));
        }
      remember({ ...next, ...extra });
      await refresh();
    } catch (e) {
      setError(shown(e));
      await refresh().catch(() => {});
    } finally {
      mutating.current = false;
      setBusy(false);
    }
  }
  // A swap from a connected wallet: quote with the wallet as the refund
  // address, then send the quoted amount from it.
  function payWithWallet(token: PayToken, next: PayChoice, wallet: Connected) {
    setConnected(wallet);
    // A token found by its address pays as the checkout's USDC on its chain:
    // the wallet swaps it, and only then pays the exact USDC.
    if (token.route === "dex" && token.via && token.chain && token.contract) {
      const via = token.via,
        found = { chain: token.chain, address: token.contract };
      void start(
        via,
        { ...next, route: "dex", wallet: wallet.name, ...(via.route === "swap" ? { assetId: via.assetId, refundTo: wallet.address } : {}) },
        async () => {
          let deadline: string | undefined;
          if (via.route === "swap")
            deadline = ((await api({ action: "cross-chain-quote", originAsset: via.assetId, refundTo: wallet.address })) as { deadline?: string }).deadline;
          if (!wallet.payDex) throw new Error("This wallet can't pay with that token. Choose another token.");
          return { sent: await wallet.payDex(found, api, deadline ?? current.current?.expiresAt) };
        },
      );
      return;
    }
    void start(token, { ...next, wallet: wallet.name }, async () => {
      const quote = (await api({ action: "cross-chain-quote", originAsset: token.assetId, refundTo: wallet.address })) as {
        transfer?: Parameters<Connected["send"]>[0];
        deadline?: string;
      };
      if (!quote.transfer) throw new Error("Send the amount below from your wallet.");
      return { sent: await wallet.send(quote.transfer, api, quote.deadline) };
    });
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
  const swap = (choice?.route === "swap" || choice?.route === "dex") && choice.assetId ? choice : null;
  const preset = swap
    ? { originAsset: swap.assetId!, refundTo: swap.refundTo ?? "" }
    : undefined;
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
  function goToMerchant() {
    if (!data) return;
    let handled = false;
    toMerchant?.({ preventDefault: () => (handled = true) });
    if (!handled) location.assign(data.returnUrl);
  }
  // Whether this browser has a wallet for the payment's network; without
  // one, the address and QR code are the way to pay.
  const [evmWallets, setEvmWallets] = useState(0);
  const family = payment ? chain(payment.network)?.family : undefined;
  useEffect(() => {
    if (family !== "evm") return;
    return discoverEvmWallets(window, (found) => setEvmWallets(found.length));
  }, [family]);
  // Instructions render only in the browser, after the checkout loads.
  const hasWallet = family === "evm" ? evmWallets > 0 : family === "solana" ? !!solanaProvider() : false;
  // Once shown, other ways to pay stay as the customer left them.
  const [otherOpen, setOtherOpen] = useState<boolean | null>(null);
  const network = chain(data?.network ?? "");
  const finality = network ? network.blockTimeSeconds * network.confirmationsForFinality + 10 : undefined;
  const usd =
    data?.cryptoQuote?.usdAmount ??
    (data && ["USDC", "USDT", "USDT0", "DAI"].includes(data.symbol ?? "") ? data.amount : null);
  const walletLinkBlock = (
    <div className="sc-other-way">
      <h3>Open in an external wallet browser</h3>
      <button disabled={busy} onClick={() => void copyWalletLink()}>
        Copy link for wallet browser
      </button>
      {walletLink && (
        <p>
          <label htmlFor="wallet-checkout-link">Private wallet browser link</label>
          <input id="wallet-checkout-link" readOnly value={walletLink} onFocus={(e) => e.currentTarget.select()} />
        </p>
      )}
    </div>
  );
  return (
    <div className="stablecoin-checkout">
      {data?.sandbox && (
        <div className="sc-test">Test mode · no real money moves</div>
      )}
      <div className="sc-layout">
        <aside className="sc-summary">
          {data ? (
            <p className="sc-merchant">
              <a href={data.returnUrl} onClick={toMerchant} aria-label={`Back to ${data.merchant}`}>
                <MerchantMark className="sc-avatar" name={data.merchant} logo={data.logo} />
                <span>{data.merchant}</span>
              </a>
              {data.verified && <VerifiedTick />}
            </p>
          ) : (
            <p className="sc-merchant">
              <MerchantMark className="sc-avatar" name="P" />
              <span>{error ? "Checkout unavailable" : "Loading checkout…"}</span>
            </p>
          )}
          <h1>
            {data
              ? `${displayTokenAmount(data.amount)} ${data.symbol || ""}`
              : "Your payment"}
          </h1>
          {data?.reference && (
            <dl className="sc-lines">
              <div>
                <dt>Order</dt>
                <dd>{data.reference}</dd>
              </div>
              {data.cryptoQuote && (
                <div>
                  <dt>Value</dt>
                  <dd>
                    ${data.cryptoQuote.usdAmount} · Rate by{" "}
                    {data.cryptoQuote.source}
                  </dd>
                </div>
              )}
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
          {data?.alternatives?.some((x) => x.kind === "fiat") &&
            !data.alternatives.some((x) => x.kind === "fiat" && x.available) &&
            !active &&
            !confirmed &&
            !expired && (
              <div className="sc-switch sc-off" aria-disabled="true">
                Card, digital wallet, bank transfer, mobile money or credit <span className="fc-na">Not available</span>
              </div>
            )}
          {error && (
            <p role="alert" className="sc-error">
              {error}
            </p>
          )}
          {!data && error && (
            <section>
              <h2>Open the full link from the merchant</h2>
              <Link className="sc-primary" href="/">
                Return to PayRouta
              </Link>
            </section>
          )}
          {confirmed ? (
            <Receipt
              merchant={data.merchant}
              rows={[
                ["Amount", `${displayTokenAmount(data.amount)} ${data.symbol ?? ""}`],
                ...(choice?.route === "swap" || choice?.route === "dex"
                  ? ([["Paid with", `${choice.symbol} on ${choice.chainName}`]] as [string, string][])
                  : data.network
                    ? ([["Network", networkName(data.network)]] as [string, string][])
                    : []),
                ["Order", data.reference],
              ]}
              transactionUrl={data.transaction?.url}
              returnHref={data.returnUrl}
              onReturn={goToMerchant}
            />
          ) : data?.attemptState === "Pending" ? (
            <section role="status">
              <h2>Payment detected</h2>
              <Steps
                steps={["Transfer sent", `Confirming on ${networkName(data.network)}`, "Payment confirmed"]}
                current={1}
                estimate={eta(finality)}
              />
              <p>Do not send again.</p>
              {data.transaction?.url && (
                <p>
                  <a href={data.transaction.url} target="_blank" rel="noreferrer">
                    View on explorer
                  </a>
                </p>
              )}
              <button disabled={busy} onClick={() => void checkStatus()}>
                Check payment status
              </button>
              <p role="status">{copied}</p>
            </section>
          ) : expired ? (
            <section role="status">
              <h2>Checkout expired</h2>
              {active && (
                <button disabled={busy} onClick={() => void checkStatus()}>
                  {busy ? "Checking…" : "Check payment status"}
                </button>
              )}
              <p role="status">{copied}</p>
              <a className="sc-primary" href={data.returnUrl} onClick={toMerchant}>
                Return to merchant for a new checkout
              </a>
              <p>Do not send to expired payment instructions.</p>
            </section>
          ) : a?.kind === "intents" && a.amount ? (
            <section>
              <h2>
                {swap
                  ? `Pay with ${swap.symbol} on ${swap.chainName}`
                  : `Pay ${displayTokenAmount(a.amount)} ${a.symbol}`}
              </h2>
              <CrossChain
                api={api}
                primary
                preset={preset}
                wallet={connected}
                sent={choice?.sent}
                onSent={sentFrom}
                onCopy={(v, l) => void copy(v, l)}
              />
              <p role="status">{copied}</p>
            </section>
          ) : payment && swap ? (
            <section>
              <h2>
                Pay with {swap.symbol} on {swap.chainName}
              </h2>
              <CrossChain
                api={api}
                primary
                preset={preset}
                wallet={connected}
                sent={choice?.sent}
                onSent={sentFrom}
                onCopy={(v, l) => void copy(v, l)}
              />
              <details className="sc-other">
                <summary>Other ways to pay</summary>
                <div className="sc-other-way">
                  <h3>
                    Send {displayTokenAmount(payment.amount)} {a?.symbol} on {networkName(payment.network)} instead
                  </h3>
                  <div className="sc-deposit">
                    <div>
                      <label>Exact amount</label>
                      <code>
                        {displayTokenAmount(payment.amount)} {a?.symbol}
                      </code>
                      <label>Merchant receive address</label>
                      <code>{payment.address}</code>
                      <button onClick={() => copy(payment!.address, "Address")}>Copy address</button>
                    </div>
                  </div>
                </div>
                {walletLinkBlock}
              </details>
              <p role="status">{copied}</p>
            </section>
          ) : payment && choice?.route === "dex" && choice.sent ? (
            <section role="status">
              <h2>
                Pay with {choice.symbol} on {choice.chainName}
              </h2>
              <Steps
                steps={["Payment sent", `Confirming on ${networkName(payment.network)}`, "Payment confirmed"]}
                current={1}
                estimate={eta(finality)}
              />
              {choice.sent === "uncertain" && <p className="sc-pending">Check your wallet activity before sending again.</p>}
              <p role="status">{copied}</p>
            </section>
          ) : payment ? (
            <section>
              <h2>
                Pay {displayTokenAmount(payment.amount)} {a?.symbol}
              </h2>
              <p>
                On <strong>{networkName(payment.network)}</strong>. Your wallet
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
              <details
                className="sc-other"
                open={otherOpen ?? !hasWallet}
                onToggle={(e) => {
                  // Only the customer's own clicks; React sets it too.
                  if (e.currentTarget.open !== (otherOpen ?? !hasWallet)) setOtherOpen(e.currentTarget.open);
                }}
              >
                <summary>Other ways to pay</summary>
                <div className="sc-other-way">
                  <h3>Send from another wallet or exchange</h3>
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
                      <p>Send once, exactly this token and amount.</p>
                    </div>
                  </div>
                </div>
                <CrossChain api={api} onCopy={(v, l) => void copy(v, l)} />
                {walletLinkBlock}
              </details>
              <p role="status">{copied}</p>
              <p className="sc-pending">Waiting for your transfer.</p>
            </section>
          ) : active ? (
            <section role="status">
              <h2>Preparing payment instructions</h2>
            </section>
          ) : id === "demo" ? (
            <section>
              <h2>What do you want to pay with?</h2>
              <p className="sc-preview">Preview only. Not payable.</p>
            </section>
          ) : data ? (
            <section>
              <PayPicker
                api={api}
                busy={busy}
                usd={usd}
                fee={data.customerFee ? { amount: data.customerFee, symbol: data.symbol ?? "" } : null}
                onStart={(token, next) => void start(token, next)}
                onWalletPay={payWithWallet}
              />
              {!expired && (
                <details className="sc-other">
                  <summary>Other ways to pay</summary>
                  {walletLinkBlock}
                  <p role="status">{copied}</p>
                </details>
              )}
            </section>
          ) : null}
          {data && <MerchantContact className="sc-contact" name={data.merchant} website={data.website} supportEmail={data.supportEmail} />}
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
