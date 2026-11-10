"use client";
// The ways customers pay, as brand tiles drifting in two rows. Scrolling
// the page speeds the rows up and leans them with the scroll, then they
// ease back; hovering a row holds it still.
import { useEffect, useRef } from "react";
import type { WayToPay } from "@/content/claims";
import { BrandMark, wordmarkLogos } from "./logos";

export function LogoMarquee({ items, label }: { items: WayToPay[]; label: string }) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let last = scrollY;
    let boost = 0;
    let raf = 0;
    const tick = () => {
      boost *= 0.92;
      const rate = 1 + Math.min(boost, 6);
      for (const a of el.getAnimations({ subtree: true })) if (a.playState === "running") a.playbackRate = rate;
      el.style.setProperty("--lean", `${Math.max(-6, Math.min(6, boost * 1.4)).toFixed(2)}deg`);
      raf = boost > 0.01 ? requestAnimationFrame(tick) : 0;
    };
    const onScroll = () => {
      boost += Math.abs(scrollY - last) / 120;
      last = scrollY;
      if (!raf) raf = requestAnimationFrame(tick);
    };
    addEventListener("scroll", onScroll, { passive: true });
    return () => {
      removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  const half = Math.ceil(items.length / 2);
  const rows = [items.slice(0, half), items.slice(half)];
  return (
    <div className="lm" ref={root} role="list" aria-label={label}>
      {rows.map((row, r) => (
        <div className={`lm-row${r ? " lm-rev" : ""}`} key={r}>
          {[0, 1].map((copy) => (
            <div className="lm-track" key={copy} aria-hidden={copy === 1 || undefined}>
              {row.map((w) => (
                <span className={`lm-tile lm-${w.family}`} role={copy ? undefined : "listitem"} key={w.name}>
                  <BrandMark way={w} />
                  {w.logo && wordmarkLogos.has(w.logo) ? <span className="mk-sr">{w.name}</span> : w.name}
                </span>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
