"use client";
import { useId, useState } from "react";

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function Range({
  label,
  value,
  min,
  max,
  step,
  format,
  hint,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  hint: string;
  onChange: (v: number) => void;
}) {
  const id = useId();
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="mk-range">
      <label htmlFor={id}>
        {label}
        <output htmlFor={id}>{format(value)}</output>
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={format(value)}
        style={{ "--p": `${pct}%` } as React.CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <small>{hint}</small>
    </div>
  );
}

export function RevenueCalculator() {
  const [volume, setVolume] = useState(500_000);
  const [failure, setFailure] = useState(4);
  const [recovery, setRecovery] = useState(60);

  const atRisk = volume * (failure / 100);
  const recovered = atRisk * (recovery / 100);

  return (
    <div className="mk-card mk-calc" data-reveal>
      <div className="mk-calc-inputs">
        <Range
          label="Monthly payment volume"
          value={volume}
          min={10_000}
          max={5_000_000}
          step={10_000}
          format={(v) => money.format(v)}
          hint="Total value your customers attempt to pay each month."
          onChange={setVolume}
        />
        <Range
          label="Attempts failing on the provider side"
          value={failure}
          min={0.5}
          max={15}
          step={0.5}
          format={(v) => `${v}%`}
          hint="Timeouts, outages and technical declines — not customer declines."
          onChange={setFailure}
        />
        <Range
          label="Share recoverable on a backup route"
          value={recovery}
          min={10}
          max={90}
          step={5}
          format={(v) => `${v}%`}
          hint="Depends on how many eligible providers serve each method."
          onChange={setRecovery}
        />
      </div>
      <div className="mk-calc-out" aria-live="polite">
        <span className="mk-kicker" style={{ margin: 0 }}>
          Revenue you could keep
        </span>
        <div className="big">{money.format(recovered * 12)}</div>
        <span style={{ fontWeight: 700, marginTop: -8 }}>per year</span>
        <dl>
          <dt>Volume at risk each month</dt>
          <dd>{money.format(atRisk)}</dd>
          <dt>Recovered each month</dt>
          <dd>{money.format(recovered)}</dd>
        </dl>
        <p className="note">
          An illustrative estimate from the figures you enter, not a guarantee.
          Real recovery depends on your methods, markets and provider coverage.
        </p>
      </div>
    </div>
  );
}
