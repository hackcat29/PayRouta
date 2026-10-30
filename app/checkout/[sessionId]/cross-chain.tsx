"use client";
// Paying with a token the merchant doesn't receive directly
// (lib/intents/checkout.ts): NEAR Intents quotes a swap, the customer sends
// the quoted amount to a one-time deposit address, and the exact invoice
// amount is delivered to the merchant. Confirmation still appears in the main
// checkout above.
import { useEffect, useMemo, useRef, useState } from "react";

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

// `primary`: this is how the customer pays (they chose a token to swap, or
// the merchant settles into a NEAR Intents account), not an alternative to a
// direct transfer. `preset`: the token and refund address the customer
// already chose (pay-picker.tsx), quoted as soon as instructions exist.
export function CrossChain({
  api,
  onCopy,
  primary = false,
  preset,
}: {
  api: Api;
  onCopy: (value: string, label: string) => void;
  primary?: boolean;
  preset?: { originAsset: string; refundTo: string };
}) {
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [chain, setChain] = useState("");
  const [assetId, setAssetId] = useState("");
  const [refundTo, setRefundTo] = useState("");
  const [payment, setPayment] = useState<Payment | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const quoted = useRef(false);

  async function getQuote(originAsset = assetId, refund = refundTo) {
    setBusy(true);
    setError("");
    try {
      const r = await api({ action: "cross-chain-quote", originAsset, refundTo: refund.trim() });
      setPayment(r as unknown as Payment);
    } catch (e) {
      // The checkout API already turns error codes into sentences.
      const message = (e as Error).message;
      setError(
        errors[message] ??
          (message ||
            (primary
              ? "A quote isn't available for that token right now. Try another token or network."
              : "A cross-chain quote isn't available right now. You can still pay directly above.")),
      );
      // Let the customer adjust what they chose.
      setAssetId(originAsset);
      setRefundTo(refund);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    let alive = true;
    api({ action: "cross-chain-options" })
      .then((r) => alive && setAssets(r.available ? (r.assets as Asset[]) : []))
      .catch(() => alive && setAssets([]));
    api({ action: "cross-chain-status" })
      .then((r) => {
        if (!alive) return;
        if (r.payment) setPayment(r.payment as Payment);
        else if (preset && !quoted.current) {
          quoted.current = true;
          void getQuote(preset.originAsset, preset.refundTo);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // The preset is quoted once, when instructions first exist.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  // A preset token that couldn't be quoted shows under its own network.
  const network = chain || assets?.find((a) => a.assetId === assetId)?.chain || "";
  const tokens = (assets ?? []).filter((a) => a.chain === network);

  if (!assets?.length && !payment)
    return primary && assets ? (
      <p role="alert" className="sc-error">
        Payment instructions aren&apos;t available right now. Try again in a few minutes, or contact the merchant.
      </p>
    ) : null;

  return (
    <details className="sc-cross" open={primary || !!payment}>
      <summary>{primary ? "Your payment" : "Pay with a different token"}</summary>
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
            {["REFUNDED", "FAILED"].includes(payment.status) && (
              <button type="button" onClick={() => setPayment(null)}>
                Pay another way
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="sc-cross-form">
          <p>
            {primary
              ? "Pick the network and token you hold. You'll get a one-time address and the exact amount to send."
              : "Hold a different token, or on another network? Pay with it. The merchant still receives the amount above."}
          </p>
          <label htmlFor="cc-chain">Network you pay from</label>
          <select
            id="cc-chain"
            value={network}
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
          <select id="cc-token" value={assetId} disabled={!network} onChange={(e) => setAssetId(e.target.value)}>
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
