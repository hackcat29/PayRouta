"use client";
// "Pay from another chain or token" (lib/intents/checkout.ts). Shown under a
// crypto checkout's deposit instructions when cross-chain payments are on
// for this checkout. The customer picks what they hold, gives a refund
// address on that chain, and sends the quoted amount to a one-time deposit
// address; the intents network delivers the exact invoice amount to the
// merchant. Confirmation still appears in the main checkout above.
import { useEffect, useMemo, useState } from "react";

type Asset = { assetId: string; chain: string; chainName: string; symbol: string };
type Payment = {
  chainName: string;
  symbol: string;
  send: string;
  depositAddress: string;
  depositMemo: string | null;
  refundTo: string;
  deadline: string;
  status: string;
};
type Api = (action?: object) => Promise<Record<string, unknown>>;

const statusText: Record<string, string> = {
  PENDING_DEPOSIT: "Waiting for your transfer.",
  KNOWN_DEPOSIT_TX: "Transfer seen. The swap starts once it is final.",
  PROCESSING: "Swapping and delivering to the merchant.",
  INCOMPLETE_DEPOSIT: "Less than the quoted amount arrived. Send the rest, or it will be refunded to your address.",
  SUCCESS: "Delivered to the merchant. Final confirmation appears above in a moment.",
  REFUNDED: "The swap could not complete. Your funds were refunded to your address.",
  FAILED: "The swap failed. Your funds will be refunded to your address.",
};
const errors: Record<string, string> = {
  CROSS_CHAIN_REFUND_ADDRESS_INVALID: "Check your refund address: it must be your own address on the chain you pay from.",
  CROSS_CHAIN_QUOTE_REFUSED: "No route is available for that token right now. Try another token or chain.",
  CROSS_CHAIN_QUOTE_MISMATCH: "No exact quote is available right now. Try another token.",
  CROSS_CHAIN_TOO_LATE: "There isn't enough time left for a cross-chain payment. Pay directly, or start a new checkout.",
  CROSS_CHAIN_RATE_LIMITED: "Too many requests. Wait a few seconds and try again.",
  CROSS_CHAIN_AMOUNT_TOO_SMALL: "This amount is below the minimum for that token on that network. Try another token or chain, or pay directly above.",
};

export function CrossChain({ api, onCopy }: { api: Api; onCopy: (value: string, label: string) => void }) {
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [chain, setChain] = useState("");
  const [assetId, setAssetId] = useState("");
  const [refundTo, setRefundTo] = useState("");
  const [payment, setPayment] = useState<Payment | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    api({ action: "cross-chain-options" })
      .then((r) => alive && setAssets(r.available ? (r.assets as Asset[]) : []))
      .catch(() => alive && setAssets([]));
    api({ action: "cross-chain-status" })
      .then((r) => alive && r.payment && setPayment(r.payment as Payment))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [api]);

  useEffect(() => {
    if (!payment || ["SUCCESS", "REFUNDED", "FAILED"].includes(payment.status)) return;
    const t = setInterval(() => {
      api({ action: "cross-chain-status" })
        .then((r) => r.payment && setPayment(r.payment as Payment))
        .catch(() => {});
    }, 5000);
    return () => clearInterval(t);
  }, [api, payment]);

  const chains = useMemo(() => {
    const seen = new Map<string, string>();
    for (const a of assets ?? []) seen.set(a.chain, a.chainName);
    return [...seen].sort((a, b) => a[1].localeCompare(b[1]));
  }, [assets]);
  const tokens = (assets ?? []).filter((a) => a.chain === chain);

  if (!assets?.length && !payment) return null;

  async function getQuote() {
    setBusy(true);
    setError("");
    try {
      const r = await api({ action: "cross-chain-quote", originAsset: assetId, refundTo: refundTo.trim() });
      setPayment(r as unknown as Payment);
    } catch (e) {
      const code = (e as Error).message;
      setError(errors[code] ?? "A cross-chain quote isn't available right now. You can still pay directly above.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="sc-cross" open={!!payment}>
      <summary>Pay from another chain or token</summary>
      {payment ? (
        <div className="sc-deposit">
          <div>
            <p>
              Send exactly{" "}
              <strong>
                {payment.send} {payment.symbol}
              </strong>{" "}
              on <strong>{payment.chainName}</strong> to this one-time address. The merchant receives the exact amount
              above.
            </p>
            <label>Deposit address ({payment.chainName})</label>
            <code>{payment.depositAddress}</code>
            <button type="button" onClick={() => onCopy(payment.depositAddress, "Deposit address")}>
              Copy deposit address
            </button>
            {payment.depositMemo && (
              <>
                <label>Memo (required)</label>
                <code>{payment.depositMemo}</code>
                <button type="button" onClick={() => onCopy(payment.depositMemo!, "Memo")}>
                  Copy memo
                </button>
              </>
            )}
            <button type="button" onClick={() => onCopy(payment.send, "Amount")}>
              Copy amount
            </button>
            <p role="status">{statusText[payment.status] ?? "Checking the swap…"}</p>
            <p className="sc-pending">
              Send before {new Date(payment.deadline).toLocaleTimeString()}. If the swap can&apos;t complete, it is refunded to{" "}
              <code>{payment.refundTo}</code>. Swaps run on NEAR Intents, a liquidity layer for 125+ assets across 36+ chains; PayRouta never holds your funds.
            </p>
          </div>
        </div>
      ) : (
        <div className="sc-cross-form">
          <p>Hold a different token, or on another network? Pay with it. The merchant still receives the amount above.</p>
          <label htmlFor="cc-chain">Network you pay from</label>
          <select
            id="cc-chain"
            value={chain}
            onChange={(e) => {
              setChain(e.target.value);
              setAssetId("");
            }}
          >
            <option value="">Choose a network</option>
            {chains.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <label htmlFor="cc-token">Token</label>
          <select id="cc-token" value={assetId} disabled={!chain} onChange={(e) => setAssetId(e.target.value)}>
            <option value="">Choose a token</option>
            {tokens.map((t) => (
              <option key={t.assetId} value={t.assetId}>
                {t.symbol}
              </option>
            ))}
          </select>
          <label htmlFor="cc-refund">Your address on this network, for refunds</label>
          <input
            id="cc-refund"
            value={refundTo}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setRefundTo(e.target.value)}
          />
          <button type="button" className="sc-primary" disabled={busy || !assetId || refundTo.trim().length < 20} onClick={() => void getQuote()}>
            {busy ? "Getting a quote…" : "Get payment instructions"}
          </button>
          {error && (
            <p role="alert" className="sc-error">
              {error}
            </p>
          )}
        </div>
      )}
    </details>
  );
}
