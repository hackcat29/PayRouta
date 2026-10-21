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
| Public facts (availability, prices) | `content/claims.ts` |

## Voice

Short, plain, specific. Show the product (checkout previews, diagrams) instead
of describing it. No status pills on headings, two-tone headlines, tick lists
or superlatives. Unbuilt things are labelled "Coming"; credit is never shown as
live before a licensed lender is.
