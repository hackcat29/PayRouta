// Payment brand marks. The sprite defines each mark once per page; tiles
// draw it with <use>, so a mark repeated in a marquee costs a few bytes.
import type { CSSProperties } from "react";
import type { WayToPay } from "@/content/claims";
import { brandLogos } from "./brand-logos";

export function LogoSprite() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true" focusable="false">
      {Object.entries(brandLogos).map(([id, l]) => (
        <symbol key={id} id={`lg-${id}`} viewBox={l.viewBox} dangerouslySetInnerHTML={{ __html: l.body }} />
      ))}
    </svg>
  );
}

// Logos that are the brand's name written out: drawn wider, and they stand
// in for the name.
export const wordmarkLogos = new Set(["applepay", "googlepay", "venmo", "sepa"]);

// A brand's mark: its logo, or a wordmark tile where no open logo exists.
export function BrandMark({ way, size = 28 }: { way: Pick<WayToPay, "logo" | "mark" | "name">; size?: number }) {
  if (way.logo) {
    const w = wordmarkLogos.has(way.logo) ? Math.round(size * 2.6) : size;
    return (
      <svg className="bm" width={w} height={w} style={w > size ? { margin: `${(size - w) / 2}px 0` } : undefined} aria-hidden="true" focusable="false">
        <use href={`#lg-${way.logo}`} />
      </svg>
    );
  }
  const m = way.mark ?? { text: way.name.slice(0, 2), color: "#1e2466" };
  return (
    <span
      className="bm bm-word"
      aria-hidden="true"
      style={{ "--bm-size": `${size}px`, color: m.color, background: m.bg ?? "transparent" } as CSSProperties}
    >
      {m.text}
    </span>
  );
}
