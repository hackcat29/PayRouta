"use client";
// Settle crypto checkouts straight to an address on any chain
// (lib/intents/settlement-address.ts): a stablecoin and network, and the
// address twice. Saving asks you to confirm it's you (step-up dialog).
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { errorText, offline } from "@/lib/error-copy";

export type AddressView = { assetId: string; symbol: string; chainName: string; address: string; active: boolean };
type Asset = { assetId: string; blockchain: string; chainName: string; symbol: string };

export function AddressSettlement({ orgId, current, canConfigure }: { orgId: string; current: AddressView | null; canConfigure: boolean }) {
  const router = useRouter();
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [editing, setEditing] = useState(!current?.active);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function api(action: string, input?: object) {
    let r: Response;
    try {
      r = await fetch("/api/merchant", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, orgId, ...(input ? { input } : {}) }) });
    } catch {
      throw new Error(offline);
    }
    const body = await r.json().catch(() => null);
    if (!r.ok) throw new Error(errorText(body, r.status));
    return body;
  }
  useEffect(() => {
    if (!editing || assets) return;
    let alive = true;
    void api("settlement-address-options")
      .then((b: { assets: Asset[] }) => alive && setAssets(b.assets))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);
  const chains = useMemo(() => [...new Set((assets ?? []).map((a) => a.chainName))], [assets]);

  if (current?.active && !editing)
    return (
      <div className="ms-address-on">
        <p>
          Checkouts settle in <strong>{current.symbol}</strong> on <strong>{current.chainName}</strong> to
        </p>
        <code className="ms-address">{current.address}</code>
        {canConfigure && (
          <div className="ms-link-actions ms-left">
            <button type="button" className="ms-btn" onClick={() => setEditing(true)}>
              Change
            </button>
            <button
              type="button"
              className="ms-btn"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setError("");
                void api("settlement-address-stop")
                  .then(() => router.refresh())
                  .catch((e: Error) => setError(e.message))
                  .finally(() => setBusy(false));
              }}
            >
              Stop
            </button>
          </div>
        )}
        {error && <p className="p-notice error" role="alert">{error}</p>}
      </div>
    );

  if (!canConfigure) return <p>Ask an owner or admin to set an address.</p>;
  return (
    <form
      className="ms-link-form"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setBusy(true);
        setError("");
        void api("settlement-address-set", {
          assetId: String(f.get("assetId")),
          address: String(f.get("address")).trim(),
          confirm: String(f.get("confirm")).trim(),
        })
          .then(() => {
            setEditing(false);
            router.refresh();
          })
          .catch((err: Error) => setError(err.message))
          .finally(() => setBusy(false));
      }}
    >
      <label className="ms-link-wide">
        Stablecoin and network
        <select name="assetId" required defaultValue={current?.assetId ?? ""} disabled={!assets}>
          <option value="">{assets ? "Choose" : "Loading…"}</option>
          {chains.map((chain) => (
            <optgroup key={chain} label={chain}>
              {(assets ?? [])
                .filter((a) => a.chainName === chain)
                .map((a) => (
                  <option key={a.assetId} value={a.assetId}>
                    {a.symbol} on {a.chainName}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </label>
      <label>
        Your address on that network
        <input name="address" required autoComplete="off" spellCheck={false} defaultValue={current?.address ?? ""} />
      </label>
      <label>
        The same address again
        <input name="confirm" required autoComplete="off" spellCheck={false} />
      </label>
      <p className="ms-link-wide ms-warn">Send only to an address you control on that network. Payments sent to a wrong address can&apos;t be recovered.</p>
      <div className="ms-link-actions ms-left ms-link-wide">
        <button className="ms-btn primary" disabled={busy || !assets}>
          {busy ? "Saving…" : "Settle here"}
        </button>
        {current?.active && (
          <button type="button" className="ms-btn" onClick={() => setEditing(false)}>
            Cancel
          </button>
        )}
      </div>
      {error && <p className="p-notice error ms-link-wide" role="alert">{error}</p>}
    </form>
  );
}
