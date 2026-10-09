import { lines, type LineKey } from "@/content/claims";

// Beck-style network diagram: each payment method is a line from Checkout to
// Settlement with 45° bends. On the Cards line, Provider A is closed and the
// payment takes a signed diversion through Provider B.
const keys = Object.keys(lines) as LineKey[];
const CX = 110;
const SX = 1090;
const lanes = keys.map((key, i) => ({ key, y: 80 + i * 92, y0: 264 + (i - 2) * 14 }));

function lanePath(y: number, y0: number, diversion = false) {
  const d = Math.abs(y - y0);
  const a = 220 + d;
  const b = 980 - d;
  const mid = diversion ? `H 500 L 536,${y + 36} H 624 L 660,${y}` : "";
  return `M${CX},${y0} H 220 L ${a},${y} ${mid} H ${b} L 980,${y0} H ${SX}`;
}

export function RouteMap({ className = "" }: { className?: string }) {
  const card = lanes[0];
  return (
    <svg
      className={`mk-routemap ${className}`}
      viewBox="0 0 1200 520"
      role="img"
      aria-labelledby="routemap-title routemap-desc"
    >
      <title id="routemap-title">PayRouta network map</title>
      <desc id="routemap-desc">
        Five payment method lines run from checkout to settlement. On the cards
        line, Provider A is closed and the payment is diverted through Provider
        B on the same line.
      </desc>

      {/* diversion under the cards line */}
      <path
        className="diversion"
        d={`M500,${card.y} L536,${card.y + 36} H624 L660,${card.y}`}
        stroke={lines.card.color}
      />

      {lanes.map(({ key, y, y0 }) => (
        <g key={key}>
          <path className="track" d={lanePath(y, y0)} stroke={lines[key].color} />
          {[440, 760].map((x) => (
            <rect key={x} x={x - 4} y={y - 17} width="8" height="12" fill={lines[key].color} />
          ))}
          <circle cx="400" cy={y - 30} r="13" fill={lines[key].color} />
          <text x="400" y={y - 25} textAnchor="middle" fill="#fff" style={{ fontSize: 13, fontWeight: 800 }}>
            {lines[key].bullet}
          </text>
          <text className="label" x="422" y={y - 25}>
            {lines[key].label}
          </text>
        </g>
      ))}

      {/* closed station and diversion on the cards line */}
      <circle cx="580" cy={card.y} r="15" fill="#fff" stroke="#c7361b" strokeWidth="5" />
      <path
        d={`M572,${card.y - 8} l16,16 m0,-16 l-16,16`}
        stroke="#c7361b"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <text className="sub" x="604" y={card.y - 20}>
        Provider A · closed
      </text>
      <circle cx="580" cy={card.y + 36} r="10" fill="#fff" stroke="var(--ink)" strokeWidth="4" />
      <text className="sub" x="602" y={card.y + 64}>
        Diversion via Provider B
      </text>

      {/* interchanges */}
      {[CX, SX].map((x) => (
        <rect
          key={x}
          x={x - 18}
          y={lanes[0].y0 - 22}
          width="36"
          height={lanes[4].y0 - lanes[0].y0 + 44}
          rx="18"
          fill="#fff"
          stroke="var(--ink)"
          strokeWidth="6"
        />
      ))}
      <text className="label" x={CX} y={lanes[4].y0 + 52} textAnchor="middle">
        Checkout
      </text>
      <text className="label" x={SX} y={lanes[4].y0 + 52} textAnchor="middle">
        Settlement
      </text>

      {/* moving payments */}
      {lanes.map(({ key, y, y0 }, i) => (
        <circle key={key} className="packet" r="7" fill="#fff" stroke="var(--ink)" strokeWidth="3">
          <animateMotion
            dur={`${4.4 + i * 0.35}s`}
            repeatCount="indefinite"
            path={lanePath(y, y0, key === "card")}
          />
        </circle>
      ))}
    </svg>
  );
}

// A bundle of parallel lines with a 45° jog and interchange capsules, used as
// a wayfinding strip under heroes and at the foot of the closing call to action.
export function LineBundle({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 1200 170" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      {keys.map((k, i) => {
        const y = 20 + i * 18;
        return (
          <path
            key={k}
            d={`M-10,${y} H 560 L 600,${y + 40} H 1210`}
            fill="none"
            stroke={lines[k].color}
            strokeWidth="9"
            strokeLinejoin="round"
          />
        );
      })}
      {[260, 900].map((x, i) => (
        <rect
          key={x}
          x={x - 14}
          y={(i ? 60 : 20) - 16}
          width="28"
          height={4 * 18 + 32}
          rx="14"
          fill="#fff"
          stroke="var(--ink)"
          strokeWidth="5"
        />
      ))}
    </svg>
  );
}
