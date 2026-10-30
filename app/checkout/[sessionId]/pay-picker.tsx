"use client";
// "What do you want to pay with?" (payOptions in lib/intents/checkout.ts).
// The customer picks the network and token they hold. A token the merchant
// receives directly is sent as is; anything else is swapped by NEAR Intents
// into the checkout's stablecoin, so it also needs the customer's refund
// address. Which merchant account receives is routing, never shown here.
import { useEffect, useMemo, useState } from "react";
import { displayTokenAmount } from "@/lib/blockchain/stablecoin-payment";

export type PayToken = {
  key: string;
  symbol: string;
  route: "direct" | "swap";
  method: string;
  optionId: string | null;
  amount?: string;
  assetId?: string;
};
type Options = {
  locked: boolean;
  settle: { symbol: string; amount: string } | null;
  chains: { id: string; name: string; tokens: PayToken[] }[];
};
type Api = (action?: object) => Promise<Record<string, unknown>>;
export type PayChoice = { route: "direct" | "swap"; assetId?: string; refundTo?: string; symbol: string; chainName: string };

export function PayPicker({
  api,
  busy,
  onStart,
}: {
  api: Api;
  busy: boolean;
  onStart: (token: PayToken, choice: PayChoice) => void;
}) {
  const [options, setOptions] = useState<Options | null>(null);
  const [chain, setChain] = useState("");
  const [key, setKey] = useState("");
  const [refundTo, setRefundTo] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    api({ action: "pay-options" })
      .then((r) => {
        if (!alive) return;
        const o = r as unknown as Options;
        if (!Array.isArray(o?.chains)) throw new Error("Unexpected payment options");
        setOptions(o);
        // One network: nothing to choose.
        if (o.chains.length === 1) setChain(o.chains[0].id);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [api]);

  const network = useMemo(() => options?.chains.find((c) => c.id === chain), [options, chain]);
  const token = network?.tokens.find((t) => t.key === key);

  if (failed)
    return (
      <p role="alert" className="sc-error">
        Payment options couldn&apos;t load. Refresh the page to try again.
      </p>
    );
  if (!options) return <p role="status">Loading payment options…</p>;
  if (!options.chains.length)
    return <p>This merchant can&apos;t take crypto payments for this checkout right now.</p>;

  return (
    <form
      className="sc-network-picker"
      onSubmit={(e) => {
        e.preventDefault();
        if (!token || !network) return;
        onStart(token, {
          route: token.route,
          symbol: token.symbol,
          chainName: network.name,
          ...(token.route === "swap" ? { assetId: token.assetId, refundTo: refundTo.trim() } : {}),
        });
      }}
    >
      <h2>What do you want to pay with?</h2>
      <label htmlFor="pay-chain">Network</label>
      <select
        id="pay-chain"
        value={chain}
        disabled={busy}
        onChange={(e) => {
          setChain(e.target.value);
          setKey("");
        }}
      >
        <option value="">Choose a network</option>
        {options.chains.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <label htmlFor="pay-token">Token</label>
      <select id="pay-token" value={key} disabled={busy || !network} onChange={(e) => setKey(e.target.value)}>
        <option value="">Choose a token</option>
        {network?.tokens.map((t) => (
          <option key={t.key} value={t.key}>
            {t.symbol}
            {t.route === "direct" && t.amount ? ` · ${displayTokenAmount(t.amount)}` : ""}
          </option>
        ))}
      </select>
      {token?.route === "swap" && (
        <>
          <label htmlFor="pay-refund">Refund address on {network!.name}</label>
          <input
            id="pay-refund"
            value={refundTo}
            disabled={busy}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setRefundTo(e.target.value)}
          />
        </>
      )}
      <button
        className="sc-primary"
        disabled={busy || !token || (token.route === "swap" && refundTo.trim().length < 20)}
      >
        {busy ? "Preparing…" : "Continue"}
      </button>
    </form>
  );
}
