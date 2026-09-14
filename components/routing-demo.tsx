"use client";
import { useEffect, useReducer, useState } from "react";
import {
  ArrowDown,
  Check,
  Landmark,
  RotateCcw,
  Route,
  ShieldCheck,
  Zap,
  CreditCard,
  Coins,
  QrCode,
  TrendingUp,
  Smartphone,
  Receipt,
  CalendarClock,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import {
  getAllDirectProviders,
  initial,
  providers,
  reducer,
  scenarios,
  type Policy,
} from "@/lib/demo/model";
import { track } from "@/lib/analytics";

function getMethodIcon(id: string): LucideIcon {
  if (
    id === "bank" ||
    id === "pix" ||
    id === "upi" ||
    id === "spei" ||
    id === "sepa_instant" ||
    id === "ideal" ||
    id === "paynow"
  )
    return Zap;
  if (id === "wallet") return Wallet;
  if (id === "card" || id === "rupay" || id === "jcb" || id === "verve")
    return CreditCard;
  if (id === "ach" || id === "direct_debit") return Landmark;
  if (id === "stablecoins" || id === "usdc" || id === "crypto" || id === "stablecoin") return Coins;
  if (id === "binance_pay") return QrCode;
  if (id === "ondo_usdy" || id === "rwa") return TrendingUp;
  if (id === "mobile") return Smartphone;
  if (id === "boleto" || id === "oxxo" || id === "konbini" || id === "cash_voucher")
    return Receipt;
  if (id === "bnpl") return CalendarClock;
  return Landmark;
}

export function RoutingDemo() {
  const [s, dispatch] = useReducer(reducer, initial);
  const [userSelectedInst, setUserSelectedInst] = useState<{
    scenario: number;
    method: string | null;
    inst: string;
  } | null>(null);

  const scenario = scenarios[s.scenario];
  const eligible = providers(s);
  const directInstitutions = s.method
    ? getAllDirectProviders(scenario.id, s.method)
    : [];

  const selectedDirectInst =
    userSelectedInst &&
    userSelectedInst.scenario === s.scenario &&
    userSelectedInst.method === s.method
      ? userSelectedInst.inst
      : directInstitutions[0] || null;

  useEffect(() => {
    if (s.phase !== "processing" && s.phase !== "confirmed") return;
    const timer = setTimeout(
      () =>
        dispatch({
          type: "advance",
          phase: s.phase === "processing" ? "confirmed" : "settled",
          run: s.run,
        }),
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 80 : 900,
    );
    return () => clearTimeout(timer);
  }, [s.phase, s.run]);

  return (
    <section
      className="demo"
      id="routing-demo"
      aria-label="Payment routing demonstration"
    >
      <div className="demo-top">
        <span>
          <Route size={16} /> PAYMENT EXPLORER
        </span>
        <button
          className="icon-button"
          aria-label="Reset routing demo"
          onClick={() => dispatch({ type: "reset" })}
        >
          <RotateCcw size={16} />
        </button>
      </div>

      <div className="demo-body">
        <div className="invoice">
          <div>
            <span className="small-label">Amount</span>
            <strong>
              {scenario.currency} {scenario.amount}
            </strong>
          </div>
          <label className="scenario-label">
            <span className="sr-only">Scenario</span>
            <select
              aria-label="Scenario"
              value={s.scenario}
              onChange={(e) => {
                dispatch({ type: "scenario", value: Number(e.target.value) });
                track("demo", { action: "scenario" });
              }}
            >
              {scenarios.map((c, i) => (
                <option key={c.id} value={i}>
                  {c.flag} {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="demo-stage-label">
          <span>01</span> Choose payment method
        </div>

        <div className="method-options">
          {scenario.methods.map((m) => {
            const Icon = getMethodIcon(m.id);
            return (
              <button
                className={s.method === m.id ? "method selected" : "method"}
                key={m.id}
                onClick={() => dispatch({ type: "method", value: m.id })}
              >
                <Icon size={16} aria-hidden="true" />
                <span>{m.label}</span>
                <span className="sr-only">Available</span>
              </button>
            );
          })}
        </div>

        {s.method && directInstitutions.length > 0 && (
          <div className="direct-providers-container">
            <div className="direct-providers-header-clean">
              {s.method === "bank"
                ? "Select your bank:"
                : s.method === "wallet"
                  ? "Select your wallet:"
                  : s.method === "mobile"
                    ? "Select mobile provider:"
                    : s.method === "card"
                      ? "Select card scheme:"
                      : "Select provider:"}
            </div>

            <div
              className="direct-providers-grid"
              role="group"
              aria-label="Direct providers"
            >
              {directInstitutions.map((inst) => {
                const isSelected = selectedDirectInst === inst;
                return (
                  <button
                    key={inst}
                    type="button"
                    className={`direct-provider-chip ${isSelected ? "selected" : ""}`}
                    onClick={() =>
                      setUserSelectedInst({
                        scenario: s.scenario,
                        method: s.method,
                        inst,
                      })
                    }
                    aria-pressed={isSelected}
                  >
                    <span>{inst}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="stage-connector">
          <ArrowDown size={17} />
        </div>

        <div className="demo-stage-label">
          <span>02</span> Intelligent routing
        </div>

        {!s.method ? (
          <div className="empty-route">
            <Route size={23} />
            <p>
              Choose a payment method above.
              <br />
              <small>Then compare eligible providers.</small>
            </p>
          </div>
        ) : (
          <>
            <label className="policy">
              Optimization
              <select
                value={s.policy}
                onChange={(e) =>
                  dispatch({ type: "policy", value: e.target.value as Policy })
                }
              >
                {["Balanced", "Lower cost", "Faster"].map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </label>

            <div className="provider-list">
              {eligible.map((p, i) => (
                <div
                  className={i === 0 ? "provider active" : "provider"}
                  key={p.id}
                >
                  <span>
                    {p.name}
                    {i === 0 && <small>Optimal route</small>}
                  </span>
                  <span>
                    {p.cost} cost
                    <small>{p.time}</small>
                  </span>
                  {i === 0 && <Check size={16} />}
                </div>
              ))}
            </div>

            {!eligible.length && (
              <p role="status">
                No eligible providers remain. Please choose another method or reset.
              </p>
            )}
          </>
        )}

        <div className="demo-outcome" aria-live="polite">
          <ShieldCheck size={18} />
          <span>
            {s.phase === "idle"
              ? "Ready when you choose."
              : s.phase === "processing"
                ? "Processing simulated payment…"
                : s.phase === "confirmed"
                  ? "Simulated payment confirmed. Settlement pending."
                  : `Simulated settlement complete in ${scenario.currency}.`}
          </span>
        </div>

        <button
          className="button simulate"
          disabled={!eligible.length || s.phase !== "idle"}
          onClick={() => {
            dispatch({ type: "start" });
            track("demo", { action: "simulate" });
          }}
        >
          Simulate payment <ArrowDown size={16} />
        </button>
      </div>

      <p className="demo-disclaimer">
        Illustrative demo — no real payment is processed.
      </p>
    </section>
  );
}
