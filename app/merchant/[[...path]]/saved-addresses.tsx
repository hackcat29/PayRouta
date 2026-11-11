"use client";
// Your addresses (lib/intents/saved-addresses.ts): exchange and wallet
// addresses you send to from your PayRouta wallet. Send fills in the payout
// form; you sign each send in your own wallet.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Send } from "lucide-react";
import { errorText, offline } from "@/lib/error-copy";
import { memoChains } from "@/lib/intents/memo-chains";
import { confirmAction } from "@/components/portal/confirm-dialog";

export type SavedAddressView = {
  id: string;
  label: string;
  assetId: string;
  chain: string;
  chainName: string;
  symbol: string;
  address: string;
  memoChain: boolean;
};
type Token = { assetId: string; chain: string; chainName: string; symbol: string };

const short = (a: string) => (a.length > 18 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a);

export function SavedAddresses({
  orgId,
  addresses,
  tokens,
  canConfigure,
  canSend,
  onSend,
}: {
  orgId: string;
  addresses: SavedAddressView[];
  tokens: Token[];
  canConfigure: boolean;
  canSend: boolean;
  onSend: (a: SavedAddressView) => void;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [assetId, setAssetId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const chains = useMemo(() => [...new Map(tokens.map((t) => [t.chain, t.chainName])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [tokens]);
  const chosen = tokens.find((t) => t.assetId === assetId);
  async function api(action: string, input: object) {
    let r: Response;
    try {
      r = await fetch("/api/merchant", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, orgId, input }) });
    } catch {
      throw new Error(offline);
    }
    const body = await r.json().catch(() => null);
    if (!r.ok) throw new Error(errorText(body, r.status));
    return body;
  }

  return (
    <section className="ms-addresses">
      <div className="ms-card-head">
        <h2>Your addresses</h2>
        {canConfigure && !adding && (
          <button type="button" className="ms-btn" onClick={() => setAdding(true)}>
            <Plus size={15} aria-hidden /> Add an address
          </button>
        )}
      </div>
      {addresses.length > 0 && (
        <ul className="ms-address-list">
          {addresses.map((a) => (
            <li key={a.id}>
              <span>
                <strong>{a.label}</strong>
                <small>
                  {a.symbol} on {a.chainName} · <code title={a.address}>{short(a.address)}</code>
                </small>
              </span>
              {canConfigure && (
                <span className="ms-row-actions">
                  <button type="button" className="ms-btn primary" disabled={!canSend} onClick={() => onSend(a)}>
                    <Send size={14} aria-hidden /> Send
                  </button>
                  <button
                    type="button"
                    className="ms-btn"
                    onClick={() =>
                      void confirmAction({ title: `Remove ${a.label}?`, confirm: "Remove", danger: true }).then(async (ok) => {
                        if (!ok) return;
                        await api("saved-address-remove", { id: a.id })
                          .then(() => router.refresh())
                          .catch((e: Error) => setError(e.message));
                      })
                    }
                  >
                    Remove
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {adding && (
        <form
          className="ms-link-form"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            setBusy(true);
            setError("");
            void api("saved-address-add", {
              label: String(f.get("label")).trim(),
              assetId,
              address: String(f.get("address")).trim(),
              confirm: String(f.get("confirm")).trim(),
            })
              .then(() => {
                setAdding(false);
                setAssetId("");
                router.refresh();
              })
              .catch((err: Error) => setError(err.message))
              .finally(() => setBusy(false));
          }}
        >
          <label>
            Name
            <input name="label" required maxLength={60} placeholder="Binance USDT" />
          </label>
          <label>
            Token and network
            <select required value={assetId} onChange={(e) => setAssetId(e.target.value)}>
              <option value="">Choose</option>
              {chains.map(([chain, name]) => (
                <optgroup key={chain} label={name}>
                  {tokens
                    .filter((t) => t.chain === chain)
                    .map((t) => (
                      <option key={t.assetId} value={t.assetId}>
                        {t.symbol} on {name}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label>
            Address
            <input name="address" required autoComplete="off" spellCheck={false} />
          </label>
          <label>
            The same address again
            <input name="confirm" required autoComplete="off" spellCheck={false} />
          </label>
          {chosen && memoChains.has(chosen.chain) && (
            <p className="ms-link-wide ms-warn">
              PayRouta can&apos;t add a memo or tag on {chosen.chainName}. Don&apos;t use an exchange deposit address that needs one: the payment
              would be lost.
            </p>
          )}
          <div className="ms-link-actions ms-left ms-link-wide">
            <button className="ms-btn primary" disabled={busy || !assetId}>
              {busy ? "Saving…" : "Save address"}
            </button>
            <button type="button" className="ms-btn" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {!addresses.length && !adding && <p className="ms-empty-line ms-flat">No saved addresses yet.</p>}
      {error && (
        <p className="p-notice error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
