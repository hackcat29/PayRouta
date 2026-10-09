"use client";
import { useEffect, useState } from "react";
import { lines, type LineKey } from "@/content/claims";

// Split-flap board of simulated payments. A new departure arrives every few
// seconds; rerouted payments show REROUTED before settling to PAID.
const feed: { id: string; line: LineKey; method: string; via: string; reroute?: boolean }[] = [
  { id: "2291", line: "card", method: "Cards · DE", via: "PROVIDER B", reroute: true },
  { id: "2292", line: "bank", method: "Pix · BR", via: "PROVIDER C" },
  { id: "2293", line: "mobile", method: "M-Pesa · KE", via: "PROVIDER D" },
  { id: "2294", line: "bank", method: "UPI · IN", via: "PROVIDER F" },
  { id: "2295", line: "wallet", method: "Apple Pay · GB", via: "PROVIDER B" },
  { id: "2296", line: "crypto", method: "USDC · US", via: "PROVIDER E" },
  { id: "2297", line: "bank", method: "Transfer · NG", via: "PROVIDER G", reroute: true },
  { id: "2298", line: "card", method: "Cards · MX", via: "PROVIDER A" },
  { id: "2299", line: "mobile", method: "MoMo · GH", via: "PROVIDER H" },
  { id: "2300", line: "bank", method: "SEPA · FR", via: "PROVIDER C" },
];
const ROWS = 6;

function Flap({ text, width, tone }: { text: string; width: number; tone?: "green" | "red" }) {
  const chars = text.padEnd(width, " ").slice(0, width).split("");
  return (
    <span className={`mk-flap${tone ? " " + tone : ""}`} aria-hidden="true">
      {chars.map((ch, i) => (
        <b key={`${i}-${ch}`}>{ch === " " ? " " : ch}</b>
      ))}
    </span>
  );
}

function clock(minutes: number) {
  const t = 12 * 60 + 4 + minutes;
  return `${String(Math.floor(t / 60) % 24).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

export function DepartureBoard() {
  const [tick, setTick] = useState(ROWS);
  const [settled, setSettled] = useState(true);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let half: number;
    const id = window.setInterval(() => {
      setTick((t) => t + 1);
      setSettled(false);
      half = window.setTimeout(() => setSettled(true), 1300);
    }, 3200);
    return () => {
      clearInterval(id);
      clearTimeout(half);
    };
  }, []);

  const rows = Array.from({ length: ROWS }, (_, age) => {
    const n = tick - age;
    const item = feed[((n % feed.length) + feed.length) % feed.length];
    let status = "PAID";
    let tone: "green" | "red" | undefined = "green";
    if (age === 0 && !settled) {
      status = "ROUTING";
      tone = undefined;
    } else if (item.reroute && age <= 1) {
      status = "REROUTED";
      tone = "red";
    }
    return { ...item, n, time: clock(n), status, tone };
  });

  return (
    <div className="mk-board-wrap">
      <div className="mk-board-title">
        <strong>Departures</strong>
        <span>
          <span className="mk-dot-live" /> Sandbox simulation · every payment has a backup route
        </span>
      </div>
      <div className="mk-deps" role="table" aria-label="Simulated payment departures">
        <div className="mk-dep head" role="row">
          <span role="columnheader">Time</span>
          <span role="columnheader">Payment</span>
          <span role="columnheader">Method</span>
          <span role="columnheader">Via</span>
          <span role="columnheader">Status</span>
        </div>
        {rows.map((r) => (
          <div className="mk-dep" role="row" key={r.n}>
            <span role="cell" aria-label={r.time}>
              <Flap text={r.time} width={5} />
            </span>
            <span role="cell" aria-label={`Payment ${r.id}`}>
              <Flap text={`PAY${r.id}`} width={7} />
            </span>
            <span role="cell" className="route">
              <span className="mk-bullet sm" style={{ background: lines[r.line].color }} aria-hidden="true">
                {lines[r.line].bullet}
              </span>
              {r.method}
            </span>
            <span role="cell" aria-label={r.via.toLowerCase()}>
              <Flap text={r.via.replace("PROVIDER ", "PRV ")} width={5} />
            </span>
            <span role="cell" aria-label={r.status.toLowerCase()}>
              <Flap text={r.status} width={8} tone={r.tone} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
