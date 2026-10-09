# PayRouta marketing brand system

The marketing site uses a transit-map visual language: every payment method is
a coloured **line**, providers are **stations**, and a payment is a packet that
always finds a route. Styles live in `app/marketing.css` (all selectors are
prefixed `mk-`); components live in `components/marketing/`.

## Where to edit

| What | File |
| --- | --- |
| Headline figures, rail names, regions, pricing terms | `content/claims.ts` |
| Page intros (also used as meta descriptions), method catalogue, scenarios | `content/marketing.ts` |
| Page layouts | `components/marketing/pages.tsx`, `app/page.tsx` |
| Hero route map and line bundles | `components/marketing/route-map.tsx` |
| Social cards (1200×630, prerendered per page) | `app/og/[slug]/route.tsx` |

Keep figures in `content/claims.ts` defensible — merchants read them as
commitments. Customer quotes and partner logos should only be added with
written permission.

## Principles ("Wayfinding")

Borrowed from transit signage rather than SaaS templates: warm paper, flat
colour, hard 2px rules, offset block shadows, route bullets, condensed
capitals. No gradients, glows, grain, glass or italic-serif accents.

## Colour

| Token | Value | Use |
| --- | --- | --- |
| `--paper` | `#f4f2ec` | Page background |
| `--white` | `#ffffff` | Cards, alternate sections |
| `--ink` | `#0b1b22` | Text, rules, primary buttons, dark sections |
| `--mint` | `#bdf4dc` | Colour blocks (figures, calculator, closing CTA), CTAs on dark |
| `--teal` | `#00716a` | Text-safe accent |
| `--line-card` | `#2f5bff` | Cards · bullet **C** |
| `--line-bank` | `#00857a` | Bank transfers · bullet **B** |
| `--line-mobile` | `#e8920c` | Mobile money · bullet **M** |
| `--line-wallet` | `#f0502d` | Digital wallets · bullet **W** |
| `--line-crypto` | `#6a4cd9` | Stablecoins · bullet **S** |

A method always uses its line colour and bullet letter — in the route map,
tiles (8px top bar), photo labels, the departure board and social cards.

## Type

- **Archivo** (variable, `wdth` + `wght`, via `next/font/google`) for everything.
  Headlines: weight 900 at `font-stretch: 75%`, uppercase. Section titles:
  weight 800 at 85%. Labels: weight 700 at 87.5%, uppercase, tracked.
- **JetBrains Mono** for code, IDs, amounts in tables and the departure board.
- Social cards use static Archivo subsets in `assets/fonts/` (OFL).

## Signature components

- `RouteWidget` — hero "Route a payment" card: pick a country, a local method,
  press pay, watch a same-method failover (sandbox simulation).
- `DepartureBoard` — split-flap board of simulated payments.
- `RouteMap` — Beck-style network diagram with a closed station and diversion.
- `FlagStrip` — circle flags with each country's go-to payment method.

## Photography

Photos are Unsplash-licensed (credits in `docs/PHOTO-CREDITS.md`), chosen to
show commerce across regions: markets, boutiques, cafés, street retail,
e-commerce packing and developer teams. Each file is:

1. downloaded at 1400–2400 px wide,
2. graded with sharp: `modulate({ saturation: 0.9 })`, `linear(1.04, -4)`, and a
   10% `#102c3a` layer blended with `screen`,
3. exported as WebP quality 74 to `public/images/<name>.webp`.

Images are served with `unoptimized` so standalone deployments don't depend on
the runtime image optimiser. Avoid photos that show another payment company's
branding or app screens.

## Motion

- Section reveals use CSS scroll-driven animations (`data-reveal`); browsers
  without support simply show the content.
- The route map uses SVG `animateMotion`; the departure board ticks every 3.2s.
  Under `prefers-reduced-motion`, packets are hidden, the board stays still and
  all CSS animation is disabled.

## Not yet produced

- Official payment-method logos (Visa, Mastercard, M-Pesa, Pix, etc.). The site
  currently shows rail names as text chips; replace with SVGs from each brand's
  official kit, following their usage guidelines.
- A 30–45 second product video (checkout → simulated outage → reroute),
  recorded from the sandbox.
- Real merchant-console screenshots. The merchants page uses a coded console
  mock labelled "sample data".
