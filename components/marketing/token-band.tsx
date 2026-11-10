// Any token in, the merchant's stablecoin out, through NEAR Intents: the
// TypeGPU particle flow with what goes in and what comes out named on it.
import { TokenFlow } from "@/components/gpu/token-flow";

export function TokenBand() {
  return (
    <div className="hp-flow-stage">
      <TokenFlow />
      <ul className="hp-flow-in" aria-label="Paid with">
        {["ETH", "SOL", "USDT", "XLM", "Any token"].map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
      <span className="hp-flow-node" aria-hidden="true" />
      <span className="hp-flow-near">NEAR Intents</span>
      <span className="hp-flow-out">USDC</span>
    </div>
  );
}
