# PayRouta brand kit: "Adire"

Deep indigo from Yoruba adire cloth, with kola orange for action. Rooted in
West Africa and readable anywhere, and distinct from other payment brands
(Stripe's purple, Ramp's and Wise's lime-green, Paystack's blue, Lemon
Squeezy's yellow). Heroes carry an eleko dot pattern, the resist-dye dots of
adire cloth.

## Mark: the Loop

A route that runs level, loops back over itself and arrives at a node. However
a payment travels, through whichever partner and method, it gets there. It is
not a letter.

Files live in `public/brand/` (SVG master plus PNG export of each):

| File | Use |
| --- | --- |
| `payrouta-horizontal-color` | Default, on white or calico |
| `payrouta-horizontal-reverse` | On indigo or other dark backgrounds (kola loop, white node) |
| `payrouta-horizontal-black` / `-white` | One-colour print, embossing, partner co-branding |
| `payrouta-stacked-*` | Square-ish spaces: social avatars, merch, splash screens |
| `payrouta-submark-*` | The mark alone, at 48px and below |
| `payrouta-app-icon` | App stores, Apple touch icon (kola loop on an indigo tile) |
| `favicon.svg`, `favicon.ico`, `favicon-16/32/48.png` | Browser tabs |

The wordmark is lowercase **payrouta** in Space Grotesk Bold, outlined, so the
files need no font. In running text the name is always **PayRouta**.

- Clear space: the diameter of the node on every side.
- Minimum size: horizontal logo 96px wide; submark 16px.
- Don't rotate the loop, recolour the node on its own, stretch, outline or add
  effects. On photos, use the reverse or a one-colour version.

## Colour

| Token | Hex | Use |
| --- | --- | --- |
| Adire | `#1E2466` | Text, dark sections, the loop on light backgrounds |
| Kola | `#F26B1D` | Primary buttons (with adire text, 4.6:1), the node, highlights |
| Kola light | `#FF9257` | Kola as text on adire (5.4:1 or better) |
| Kola ink | `#B8470A` | Orange text on white (5.3:1) |
| Indigo | `#2E37A4` | Links and accents on light backgrounds (9.6:1) |
| Calico | `#F7F4EE` | Page bands |
| Gold | `#F5B700` | Pay with credit |
| Sky | `#4F8BFF` | Crypto and info |
| Body | `#3B3F5C` | Paragraph text |
| Line | `#E6E1D8` | Borders and rules |

White text on kola is only 3.05:1, so kola buttons always carry adire text.

## Type

- **Space Grotesk** 700 for headings and figures, tight tracking (−0.03 to
  −0.045em). Loaded with `next/font/google` as `--font-display`.
- **Inter** for body and interface text.
- **JetBrains Mono** for code, IDs and small uppercase labels.
- Social cards use static Space Grotesk subsets in `assets/fonts/` (OFL).

## Where it lives in code

| What | File |
| --- | --- |
| Marketing tokens and components | `app/marketing.css` (`--mk-*`) |
| Header menus | `lib/site-config.ts` (`navMenus`), `components/navigation.tsx` |
| Dashboard and auth tokens | `components/portal/portal.css`, `app/merchant/[[...path]]/workspace.css` |
| Checkout and payment link pages | `app/checkout/[sessionId]/checkout.css`, `app/pay/pay.css` |
| Email | `lib/email/templates/base.ts` |
| Social cards | `app/og/[slug]/route.tsx`, `scripts/social-image.mjs` (`public/social.png`) |
| Docs site | `mintlify/docs.json`, `mintlify/logo/`, `mintlify/favicon.svg` |
| Public facts (availability, prices, homepage figures) | `content/claims.ts` |
| Motion and 3D | `components/motion/`, `components/gpu/` (see below) |

## Voice

Short, plain, specific. Show the product (checkout previews, diagrams) instead
of describing it. No status pills on headings, two-tone headlines, tick lists
or superlatives. Unbuilt things are labelled "Coming"; credit is never shown as
live before a licensed lender is.

## Motion and 3D

Flat colour everywhere; depth comes from motion and real 3D, never gradients
(the adire dot pattern is the one repeating fill).

**Motion is attributes, not components.** `components/motion/motion-root.tsx`
is mounted once in `app/layout.tsx`, so server components opt in with plain
attributes:

| Attribute | Effect |
| --- | --- |
| `data-reveal` | rises and fades in when scrolled into view |
| `data-reveal="stagger"` | its children do, one after another |
| `data-tilt` | leans toward the pointer (devices that hover) |
| `data-count="125"` | counts up to the number already in its text ("125+") |

Content is visible without JavaScript; above-the-fold entrances (`RiseWords`
in `components/marketing/motion.tsx`, the hero CTA, page heroes) move without
fading so text keeps full contrast for axe from the first frame. Reduced
motion turns everything off, including the 3D frame loops.

**3D lives in `components/gpu/`**, loaded lazily (`next/dynamic`, `ssr: false`)
only when a scene comes within a screen of the viewport, and paused off-screen:

| Scene | Stack | Used on |
| --- | --- | --- |
| `globe.tsx` (+ `globe-scene.tsx`) | React Three Fiber + three.js `WebGPURenderer`, TSL node materials | Homepage hero (turns to the country picked in the checkout), sign-in/up |
| `loop-mark.tsx` (+ `loop-scene.tsx`) | same | Footer CTA on every marketing page |
| `token-flow.tsx` | TypeGPU root and typed buffers, WGSL compute + render | Homepage "Any token in" band |

`probe.ts` checks once that WebGPU can actually present to a canvas; if not,
three.js runs its WebGL2 backend and the token flow draws on a 2D canvas.
Scenes are decorative (`aria-hidden`); whatever they show is also in the
page's text. The globe's land comes from `components/gpu/globe-land.ts`
(a ~2 KB bitset), rebuilt with `node scripts/globe-land.mjs`.

To test scenes in Playwright, launch with `channel: "chromium"`: the default
headless shell's SwiftShader adapter can't present WebGPU canvases (the probe
then falls back, so tests still pass, but you won't see the WebGPU path).

`/llms.txt` (`app/llms.txt/route.ts`) gives assistants the site in Markdown,
built from `content/claims.ts` and `lib/site-config.ts`.
