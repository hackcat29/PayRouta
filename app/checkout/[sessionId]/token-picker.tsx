"use client";
// "Choose a token" in the crypto checkout (pay-picker.tsx): every token the
// customer can pay with, on every network, in one searchable list. Tokens
// the merchant receives as they are come first, then stablecoins, then each
// network's own coin, then the rest. Search matches a symbol, a network or a
// pasted contract address; an address that isn't listed is looked up, so
// any token with DEX liquidity can pay (lib/intents/dex.ts).
import { useEffect, useMemo, useRef, useState } from "react";
import { displayTokenAmount } from "@/lib/blockchain/stablecoin-payment";
import { TokenIcon } from "./token-icon";
import type { PayToken } from "./pay-picker";

export type Row = PayToken & { chainId: string; chainName: string };

const stable = ["USDC", "USDT", "USDT0", "EURC", "DAI"];
const majors = ["ETH", "BTC", "SOL", "BNB", "wNEAR", "POL", "AVAX", "TRX", "TON", "XRP", "XLM", "SUI", "APT", "DOGE", "LTC", "ARB", "OP"];
const rank = (t: Row) =>
  t.route === "dex"
    ? 4
    : t.route === "direct"
      ? 0
      : stable.includes(t.symbol)
        ? 1 + stable.indexOf(t.symbol) / 10
        : majors.includes(t.symbol)
          ? 2 + majors.indexOf(t.symbol) / 100
          : 3;
export const isAddress = (q: string) => /^0x[0-9a-fA-F]{40}$/.test(q) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(q);

export function ordered(rows: Row[]) {
  return [...rows].sort((a, b) => rank(a) - rank(b) || a.symbol.localeCompare(b.symbol) || a.chainName.localeCompare(b.chainName));
}

export const amountLabel = (t: PayToken) =>
  t.route === "direct" && t.amount ? displayTokenAmount(t.amount) : t.approx ? `≈ ${t.approx}` : "";

export function TokenPicker({
  open,
  rows,
  selected,
  onSelect,
  onClose,
  onLookup,
}: {
  open: boolean;
  rows: Row[];
  selected?: string;
  onSelect: (row: Row) => void;
  onClose: () => void;
  // Finds a token that isn't listed by its address; resolves to an error
  // sentence when there's none the checkout can take.
  onLookup?: (address: string) => Promise<string | null>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");
  const [network, setNetwork] = useState("");
  const [lookup, setLookup] = useState<{ address: string; state: "loading" | "done"; error?: string | null } | null>(null);
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  const networks = useMemo(() => [...new Map(rows.map((r) => [r.chainId, r.chainName]))].sort((a, b) => a[1].localeCompare(b[1])), [rows]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ordered(rows).filter(
      (r) =>
        (!network || r.chainId === network) &&
        (!q ||
          r.symbol.toLowerCase().includes(q) ||
          r.chainName.toLowerCase().includes(q) ||
          (q.length >= 6 && (r.contract ?? "").toLowerCase().includes(q))),
    );
  }, [rows, query, network]);
  const address = query.trim();
  const unlisted = !!onLookup && isAddress(address) && !rows.some((r) => (r.contract ?? "").toLowerCase() === address.toLowerCase());
  // A pasted address loads its token without another tap.
  useEffect(() => {
    if (!unlisted || lookup?.address === address) return;
    const t = setTimeout(() => {
      setLookup({ address, state: "loading" });
      onLookup!(address).then(
        (error) => setLookup({ address, state: "done", error }),
        () => setLookup({ address, state: "done", error: "That token couldn't be loaded. Try again." }),
      );
    }, 250);
    return () => clearTimeout(t);
  }, [unlisted, address, lookup, onLookup]);
  return (
    <dialog ref={dialog} className="tp" aria-labelledby="tp-title" onClose={onClose} onCancel={onClose}>
      <div className="tp-head">
        <h2 id="tp-title">Choose a token</h2>
        <button type="button" className="tp-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="tp-filters">
        <label className="tp-visually-hidden" htmlFor="tp-search">
          Search tokens
        </label>
        <input
          id="tp-search"
          type="search"
          value={query}
          placeholder="Symbol, network or address"
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
        />
        <label className="tp-visually-hidden" htmlFor="tp-network">
          Network
        </label>
        <select id="tp-network" value={network} onChange={(e) => setNetwork(e.target.value)}>
          <option value="">All networks</option>
          {networks.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      </div>
      <ul className="tp-list">
        {shown.map((r) => (
          <li key={`${r.chainId}:${r.key}`}>
            <button type="button" className="tp-row" aria-pressed={r.key === selected} onClick={() => onSelect(r)}>
              <TokenIcon symbol={r.symbol} />
              <span className="tp-name">
                <strong>{r.symbol}</strong>
                <small>{r.chainName}</small>
              </span>
              <span className="tp-amount">{amountLabel(r)}</span>
            </button>
          </li>
        ))}
        {unlisted && lookup?.address === address && lookup.state === "loading" && (
          <li className="tp-empty" role="status">
            Loading token…
          </li>
        )}
        {unlisted && lookup?.address === address && lookup.state === "done" && lookup.error && (
          <li className="tp-empty" role="alert">
            {lookup.error}
          </li>
        )}
        {!shown.length && !unlisted && <li className="tp-empty">No tokens match.</li>}
      </ul>
    </dialog>
  );
}
