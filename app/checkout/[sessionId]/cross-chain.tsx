"use client";
// Paying with a token the merchant doesn't receive directly
// (lib/intents/checkout.ts): NEAR Intents quotes a swap, the customer sends
// the quoted amount to a one-time deposit address, from a connected wallet
// or any other wallet or exchange, and the exact invoice amount is
// delivered to the merchant. Confirmation and the receipt appear in the
// main checkout (view.tsx).
import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import type { WalletTransfer } from "@/lib/intents/checkout";
import { Steps, eta } from "./progress-steps";
import { TokenIcon } from "./token-icon";
import { TokenPicker, type Row } from "./token-picker";
import type { Connected } from "./swap-wallet";

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
  timeEstimate?: number;
  explorerUrl?: string;
  transfer?: WalletTransfer;
};
type Api = (action?: object) => Promise<Record<string, unknown>>;

const errors: Record<string, string> = {
  CROSS_CHAIN_REFUND_ADDRESS_INVALID: "Check your refund address: it must be your own address on the chain you pay from.",
  CROSS_CHAIN_QUOTE_REFUSED: "No route is available for that token right now. Try another token or chain.",
  CROSS_CHAIN_QUOTE_MISMATCH: "No exact quote is available right now. Try another token.",
  CROSS_CHAIN_TOO_LATE: "There isn't enough time left for a cross-chain payment. Pay directly, or start a new checkout.",
  CROSS_CHAIN_RATE_LIMITED: "Too many requests. Wait a few seconds and try again.",
  CROSS_CHAIN_AMOUNT_TOO_SMALL: "This amount is below the minimum for that token on that network. Try another token or chain, or pay directly above.",
};
// Where the swap is: the step it's on, and what the customer needs to know.
const stage: Record<string, { step: number; text?: string }> = {
  PENDING_DEPOSIT: { step: 0 },
  KNOWN_DEPOSIT_TX: { step: 1, text: "Transfer seen. The swap starts once it's final." },
  INCOMPLETE_DEPOSIT: { step: 1, text: "Less than the quoted amount arrived. Send the rest, or it will be refunded to your address." },
  PROCESSING: { step: 1 },
  SUCCESS: { step: 2 },
};

function useQr(text?: string) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let alive = true;
    if (!text) return;
    import("qrcode")
      .then((q) => q.toDataURL(text, { margin: 1, width: 336 }))
      .then((url) => alive && setSrc(url))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [text]);
  return text ? src : "";
}

// `primary`: this is how the customer pays (they chose a token to swap, or
// the merchant settles into a NEAR Intents account), not an alternative to a
// direct transfer. `preset`: the token and refund address the customer
// already chose (pay-picker.tsx), quoted as soon as instructions exist.
export function CrossChain({
  api,
  onCopy,
  primary = false,
  preset,
  wallet,
  sent,
  onSent,
}: {
  api: Api;
  onCopy: (value: string, label: string) => void;
  primary?: boolean;
  preset?: { originAsset: string; refundTo: string };
  wallet?: Connected | null;
  sent?: string;
  onSent?: (hash: string) => void;
}) {
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [assetId, setAssetId] = useState("");
  const [picking, setPicking] = useState(false);
  const [refundTo, setRefundTo] = useState("");
  const [payment, setPayment] = useState<Payment | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [walletMessage, setWalletMessage] = useState("");
  const quoted = useRef(false);
  const qr = useQr(payment?.status === "PENDING_DEPOSIT" ? payment.depositAddress : undefined);

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

  async function payFromWallet() {
    if (!wallet || !payment?.transfer) return;
    setBusy(true);
    setWalletMessage("");
    try {
      onSent?.(await wallet.send(payment.transfer, api, payment.deadline));
    } catch (e) {
      const err = e as { code?: number; message?: string; mayHaveSent?: boolean };
      if (err.mayHaveSent) onSent?.("uncertain");
      setWalletMessage(err.code === 4001 ? "Payment was cancelled in your wallet." : err.message || "Your wallet didn't send the payment.");
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

  const rows = useMemo<Row[]>(
    () =>
      (assets ?? []).map((a) => ({
        key: a.assetId,
        assetId: a.assetId,
        symbol: a.symbol,
        route: "swap",
        method: "",
        optionId: null,
        chainId: a.chain,
        chainName: a.chainName,
      })),
    [assets],
  );
  const chosen = rows.find((r) => r.key === assetId);

  if (!assets?.length && !payment)
    return primary && assets ? (
      <p role="alert" className="sc-error">
        Payment instructions aren&apos;t available right now. Try again in a few minutes, or contact the merchant.
      </p>
    ) : null;

  const where = payment ? stage[payment.status] : undefined;
  const instructions = payment?.status === "PENDING_DEPOSIT" && !sent;
  const canWallet = !!wallet && !!payment?.transfer && wallet.family === payment.transfer.family;

  const body = payment ? (
    ["REFUNDED", "FAILED"].includes(payment.status) ? (
      <div className="sc-swap">
        <p role="status">
          {payment.status === "REFUNDED"
            ? "The swap couldn't complete. Your funds were refunded to your address."
            : "The swap failed. Your funds will be refunded to your address."}
        </p>
        <button type="button" onClick={() => setPayment(null)}>
          Pay another way
        </button>
      </div>
    ) : instructions ? (
      <div className="sc-swap">
        <p>
          Send exactly{" "}
          <strong>
            {payment.send} {payment.symbol}
          </strong>{" "}
          on <strong>{payment.chainName}</strong>.
        </p>
        {canWallet && (
          <>
            <button type="button" className="sc-primary" disabled={busy} onClick={() => void payFromWallet()}>
              {busy ? "Check your wallet…" : `Pay with ${wallet!.name}`}
            </button>
            {walletMessage && (
              <p role="alert" className="sc-error">
                {walletMessage}
              </p>
            )}
          </>
        )}
        <div className="sc-deposit">
          {qr && <Image unoptimized src={qr} width="168" height="168" alt={`Deposit address on ${payment.chainName}, as a QR code`} />}
          <div>
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
            <label>Amount</label>
            <code>
              {payment.send} {payment.symbol}
            </code>
            <button type="button" onClick={() => onCopy(payment.send, "Amount")}>
              Copy amount
            </button>
          </div>
        </div>
        <dl className="pc-lines">
          <div>
            <dt>Send before</dt>
            <dd>{new Date(payment.deadline).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</dd>
          </div>
          <div>
            <dt>Refunds to</dt>
            <dd>
              <code>{payment.refundTo}</code>
            </dd>
          </div>
        </dl>
      </div>
    ) : (
      <div className="sc-swap">
        <Steps
          steps={["Transfer sent", "Swapping", "Payment confirmed"]}
          current={payment.status === "PENDING_DEPOSIT" ? 0 : (where?.step ?? 1)}
          estimate={payment.status === "SUCCESS" ? undefined : eta(payment.timeEstimate)}
        />
        {payment.status === "PENDING_DEPOSIT" && sent && (
          <p className="sc-pending">
            {sent === "uncertain" ? "Check your wallet activity before sending again." : "Waiting for your transfer to arrive."}
          </p>
        )}
        {where?.text && <p className="sc-pending">{where.text}</p>}
        {payment.explorerUrl && (
          <p>
            <a href={payment.explorerUrl} target="_blank" rel="noreferrer">
              View on explorer
            </a>
          </p>
        )}
      </div>
    )
  ) : (
    <div className="sc-cross-form">
      <button type="button" className="pc-token" aria-haspopup="dialog" aria-label={chosen ? `Token: ${chosen.symbol} on ${chosen.chainName}` : "Choose a token"} onClick={() => setPicking(true)}>
        {chosen ? (
          <>
            <TokenIcon symbol={chosen.symbol} />
            <span className="pc-token-name">
              <b>{chosen.symbol}</b>
              <small>{chosen.chainName}</small>
            </span>
          </>
        ) : (
          <span className="pc-token-name">
            <b>Choose a token</b>
          </span>
        )}
      </button>
      <TokenPicker open={picking} rows={rows} selected={assetId} onClose={() => setPicking(false)} onSelect={(r) => { setAssetId(r.key); setPicking(false); }} />
      <label htmlFor="cc-refund">Refund address{chosen ? ` on ${chosen.chainName}` : ""}</label>
      <input id="cc-refund" value={refundTo} autoComplete="off" spellCheck={false} onChange={(e) => setRefundTo(e.target.value)} />
      <button type="button" className="sc-primary" disabled={busy || !assetId || refundTo.trim().length < 20} onClick={() => void getQuote()}>
        {busy ? "Getting a quote…" : "Get payment instructions"}
      </button>
      {error && (
        <p role="alert" className="sc-error">
          {error}
        </p>
      )}
    </div>
  );

  // The customer's own payment is shown as is; paying with a different
  // token is one of the other ways to pay.
  return primary || payment ? (
    <div className="sc-cross">
      {body}
      {error && payment && (
        <p role="alert" className="sc-error">
          {error}
        </p>
      )}
    </div>
  ) : (
    <div className="sc-cross">
      <h3>Pay with a different token</h3>
      {body}
    </div>
  );
}
