"use client";
// Paying with a token by its contract address, as checkout does it
// (content/docs/cross-chain.md, app/checkout/[sessionId]/token-picker.tsx):
// the address is pasted into the token search, checkout finds the token and
// its price, the wallet swaps it into USDC (Jupiter on Solana, LI.FI on EVM
// networks), and only then pays the exact amount. The examples are real
// contract addresses; token amounts are illustrative.
import { useEffect, useRef, useState } from "react";
import { Check, Search } from "lucide-react";
import { useStage } from "@/components/gpu/use-stage";
import { BrandMark } from "./logos";

type Example = {
  id: string;
  network: string;
  networkLogo: string;
  contract: string;
  name: string;
  symbol: string;
  color: string;
  via: string;
  amount: string;
};

const examples: Example[] = [
  {
    id: "solana",
    network: "Solana",
    networkLogo: "sol",
    contract: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
    name: "Bonk",
    symbol: "BONK",
    color: "#fc8e03",
    via: "Jupiter",
    amount: "≈ 2,150,000 BONK",
  },
  {
    id: "base",
    network: "Base",
    networkLogo: "",
    contract: "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed",
    name: "Degen",
    symbol: "DEGEN",
    color: "#a36efd",
    via: "LI.FI",
    amount: "≈ 13,400 DEGEN",
  },
  {
    id: "ethereum",
    network: "Ethereum",
    networkLogo: "eth",
    contract: "0x6982508145454Ce325dDbE47a25d4ec3d2311933",
    name: "Pepe",
    symbol: "PEPE",
    color: "#3d9a37",
    via: "LI.FI",
    amount: "≈ 4,200,000 PEPE",
  },
];

// typing → found → swapping → paid, then the next example, timed from
// when the example started.
function stageAt(ms: number, length: number) {
  const typeEnd = 300 + length * 28;
  const found = typeEnd + 700;
  const swap = found + 1300;
  const paid = swap + 1700;
  if (ms < typeEnd) return { typed: Math.max(0, Math.floor((ms - 300) / 28)), step: 0, next: false };
  return { typed: length, step: ms < found ? 0 : ms < swap ? 1 : ms < paid ? 2 : 3, next: ms >= paid + 2600 };
}

export function PayWithCa({ total = "40.00" }: { total?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const { visible, still } = useStage(box);
  const [at, setAt] = useState(0);
  // Elapsed time for the example it was measured on.
  const [clock, setClock] = useState({ at: 0, ms: 0 });
  const ex = examples[at];

  useEffect(() => {
    if (still || !visible) return;
    const start = performance.now() - (clock.at === at ? clock.ms : 0);
    const id = setInterval(() => {
      const ms = performance.now() - start;
      if (stageAt(ms, ex.contract.length).next) setAt((n) => (n + 1) % examples.length);
      else setClock({ at, ms });
    }, 40);
    return () => clearInterval(id);
    // The clock resumes from where it was; it isn't a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at, still, visible, ex.contract.length]);

  const stage = still ? { typed: ex.contract.length, step: 3 } : stageAt(clock.at === at ? clock.ms : 0, ex.contract.length);
  const typed = ex.contract.slice(0, stage.typed);
  const full = stage.typed === ex.contract.length;
  return (
    <div className="ca" ref={box}>
      <div className="ca-tabs" role="tablist" aria-label="Example contract address">
        {examples.map((e, i) => (
          <button key={e.id} type="button" role="tab" aria-selected={i === at} className="ca-tab" onClick={() => setAt(i)}>
            <BrandMark way={{ name: e.network, logo: e.networkLogo || undefined, mark: { text: "B", color: "#fff", bg: "#0052ff" } }} size={18} />
            {e.network}
          </button>
        ))}
      </div>
      <div className="ca-card" aria-hidden="true">
        <div className="ca-head">
          <span>Pay</span>
          <b>{total} USDC</b>
        </div>
        <div className={`ca-search${full ? " done" : ""}`}>
          <Search size={16} />
          <span className="ca-input">
            {typed}
            {!full && <i className="ca-caret" />}
            {!typed && <em>Symbol, network or address</em>}
          </span>
        </div>
        <div className={`ca-token${stage.step >= 1 ? " on" : ""}`} key={`t-${ex.id}-${stage.step >= 1}`}>
          {stage.step >= 1 ? (
            <>
              <span className="ca-coin" style={{ background: ex.color }}>
                {ex.symbol[0]}
              </span>
              <span className="ca-token-text">
                <b>
                  {ex.name} <small>{ex.symbol}</small>
                </b>
                <small>
                  {ex.network} · {ex.contract.slice(0, 4)}…{ex.contract.slice(-4)}
                </small>
              </span>
              <span className="ca-amount">{ex.amount}</span>
            </>
          ) : (
            <span className="ca-skeleton" />
          )}
        </div>
        <div className={`ca-route${stage.step >= 2 ? " on" : ""}${stage.step >= 3 ? " paid" : ""}`}>
          <span className="ca-route-label">
            {ex.symbol} <i>→</i> USDC <small>via {ex.via}</small>
          </span>
          <span className="ca-bar">
            <i />
          </span>
        </div>
        <div className={`ca-pay${stage.step >= 3 ? " paid" : ""}`}>
          {stage.step >= 3 ? (
            <>
              <Check size={16} strokeWidth={3} /> Paid {total} USDC
            </>
          ) : (
            `Swap and pay ${total} USDC`
          )}
        </div>
      </div>
    </div>
  );
}
