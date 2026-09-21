# PayRouta marketing website

A complete early-access marketing website and conceptual documentation foundation. Built with Next.js App Router, strict TypeScript, React Server Components, Tailwind CSS with semantic CSS tokens, self-hosted Inter, Lucide icons, local Markdown, and Zod validation.

## Run locally

Use Node.js 24 LTS (the installed framework requires Node 20.9 or newer) and npm. Keep the single `package-lock.json`.

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:3000. No environment settings are required for the illustrative demo, docs, or form validation. Online enquiry submission is explicitly unavailable by default.

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm run start
```

Run the production server after the build; stop the development server first if both would use port 3000. To use another local port: `npm run start -- --port 3100`.

Installation and Node hosting follow the official [Next.js installation guide](https://nextjs.org/docs/app/getting-started/installation) and [self-hosting guide](https://nextjs.org/docs/app/guides/self-hosting). This is a normal Node-server application, not a static export: the enquiry endpoint requires server execution. Deploy to a compatible Node host or a platform with native Next.js support. Keep TLS at the hosting ingress and server secrets in the host’s secret manager. No deployment or DNS change has been made.

## Routes

- Marketing: `/`, `/platform/payment-flow`, `/platform/payment-methods`, `/platform/provider-routing`, `/platform/settlement`, `/solutions/merchants`, `/solutions/providers`, `/solutions/use-cases`, `/developers`, `/pricing`, `/about`, `/contact`.
- Documentation: `/docs`, `/docs/quickstart`, `/docs/api-reference`, `/docs/sdks`, `/docs/payment-intents`, `/docs/payment-methods`, `/docs/webhooks`, `/docs/provider-integration`, `/docs/settlement`, `/docs/errors`.
- Infrastructure: `/api/enquiries`, `/robots.txt`, `/sitemap.xml`, branded 404 and route error boundary.

## Where to edit

- `content/marketing.ts`: typed marketing copy, categories, and hypothetical use cases.
- `content/docs/*.md`: documentation source. `lib/docs.ts` controls ordering and navigation. Search indexes actual title/body text.
- `app/globals.css`: exact supplied brand palette, semantic roles, responsive rules, reduced-motion behavior, and component styling.
- `components/brand-logo.tsx`, `public/brand/`: supplied vector wordmarks and favicon variants, preserving their proportions. No provisional logo was substituted.
- `lib/demo/model.ts`: deterministic local scenarios and reducer. Provider identifiers are anonymized fixture values, not partners.
- `components/routing-demo.tsx`: interaction and cancellable stage timers. Scenario changes clear the selected method; method/policy changes invalidate results; provider exclusion only works before initiation. Run identifiers reject stale completion callbacks. Exhaustion asks for explicit reselection.
- `lib/enquiries/schema.ts`, `lib/enquiries/delivery.ts`, `app/api/enquiries/route.ts`: shared validation, server-only delivery, and bounded request handling.
- `lib/analytics.ts`: disabled-by-default typed analytics adapter. Configure an approved adapter deliberately; the provided callers send only allowlisted actions, intents, and outcomes. No personal form fields are analytics data.
- `scripts/social-image.mjs`: reproducible 1200 × 630 PNG composition using the supplied outlined reverse logo. Run `node scripts/social-image.mjs` after approved social artwork changes.

The optional Figma file was not needed: the supplied brand kit and pasted brief established the design. The reference investor materials informed product context; their aspirational claims were not treated as live capabilities or instructions overriding the brief.

## Environment and launch configuration

Copy `.env.example` to `.env.local` for local configuration. Never commit secrets.

| Setting | Use | Visibility |
| --- | --- | --- |
| `SITE_URL` | Trusted HTTPS production origin. Leave blank for previews. Set before building production metadata. | Used for public metadata; not a secret. |
| `CONTACT_WEBHOOK_URL` | Operator-controlled HTTPS lead destination. URL userinfo and fragments rejected; redirects are never followed. | Server only. |
| `CONTACT_WEBHOOK_TOKEN` | Optional bearer authorization for the configured lead service. | Server only. Never use `NEXT_PUBLIC_`. |
| `CONTACT_EMAIL` | Optional verified fallback contact address. | Publicly displayed when configured. |

A blank `SITE_URL` produces noindex/nofollow metadata and robots disallow rules; the sitemap contains no invented domain. Set it only for the intended public production origin, then rebuild. Canonicals and social-image URLs must be checked against that actual origin before indexing. Preview hosts should also use access controls when privacy is required: noindex is not authentication.

Remaining launch work:

1. Choose the production host and trusted origin. Configure TLS and the deployment environment.
2. Configure and verify the real lead webhook destination and any token. No recipient or email address was supplied, so none is invented.
3. Supply approved privacy/retention information: operator identity, destination/processor, purpose, retention period, access/deletion contact, and applicable disclosure text. Integrate it before enabling real lead collection. This repository does not manufacture a legal policy.
4. Add deployment-appropriate distributed rate limiting or an edge abuse-control facility to `/api/enquiries`, plus operational monitoring that excludes message bodies and personal information. The honeypot and validation are not a substitute for production abuse protection. There is no misleading in-memory distributed limiter.
5. Confirm actual provider participation, coverage, integration access, and commercial terms outside this marketing surface before changing early-access claims.
6. Configure analytics only after deciding the provider and privacy requirements. No tracking SDK or external analytics request is enabled.

## Lead delivery contract

The browser posts only to the same-origin `/api/enquiries` endpoint. The server accepts JSON, checks origin when present, enforces a 16,000-byte streamed body limit and 5-second body read timeout, validates field lengths and an empty honeypot, strips nothing silently from unknown keys (strict schema), and sends only validated business fields, a submission identifier, timestamp, and `/contact` context to the configured HTTPS endpoint.

The delivery request has an 8-second abort timeout and rejects redirects. The client has a 12-second timeout. Only an upstream 2xx acceptance is shown as accepted for delivery; this is not a promise that a person has read the enquiry. Failure or timeout preserves form values. A timeout may occur after receipt, so the UI explicitly describes delivery as unconfirmed.

The client reuses the UUID for unchanged payload retries while the form remains mounted; edits create a new submission reference. `Idempotency-Key` and `submissionId` carry the same UUID. The downstream service must durably deduplicate this key and define its retention window. The website does not guarantee exactly-once delivery, and references do not persist across browser reloads. Successful submissions lock the form until the visitor explicitly starts another enquiry.

No enquiry messages or personal fields are logged, stored in browser storage, or written to a local pseudo-backend. The website itself has no database. Lead data is sent only to the operator-configured destination. Ensure hosting/request logs do not capture bodies or sensitive headers.

## Browser verification

Install the official test browser once:

```sh
npx playwright install chromium
```

Build the app and leave an **unconfigured** local server running on port 3000, then:

```sh
npm run test:e2e
```

The suite starts a separate production server on port 3001 with a reserved, non-deliverable test URL. Browser interception supplies controlled success/failure responses; it never sends enquiries to real recipients. Keep port 3001 free. The delivery unit tests inject a mock fetcher rather than making network calls.

Tests cover all 22 content routes, unique titles/descriptions, internal links and assets, desktop/mobile navigation, contact intents and validation, unconfigured/accepted/error enquiry states, retry identifiers, demo completion and invalidation, docs search/copy, method filtering, reduced motion, 320/360/390/768/1024/1440 widths, 200% text, and representative automated accessibility checks. Screenshot artifacts are in `test-results/` and are ignored by source control.

Automated accessibility checks are evidence for a WCAG 2.2 AA target, not certification. Field Core Web Vitals and production performance are not measured by this local build. No Lighthouse score is claimed. Full assistive-technology and production-device testing remain useful before launch.

## Verified result

Final local verification completed on 2026-09-13: production build, TypeScript, ESLint (no warnings), 14 focused unit/endpoint/route tests, and all 12 Playwright journeys passed. All 22 content routes and internal links resolved; the six requested viewport widths had no page-wide overflow. Representative axe checks passed after contrast corrections. Screenshots were reviewed for homepage, Payment Flow, docs, and contact on mobile and desktop. The enquiry success/error browser checks used intercepted local responses; no real lead was delivered.

## Navigation and route migration

`lib/site-config.ts` is the typed source for canonical marketing paths, navigation groups, footer links, and legacy redirects. Platform and Solutions are groups, with no parent landing pages. The existing documentation paths remain unchanged.

The old `/how-it-works`, `/payment-methods`, `/merchants`, `/providers`, and `/use-cases` URLs redirect directly to their new canonical destinations with HTTP 308. Query parameters are preserved. Payment Flow exposes `#payment-intent`, `#availability`, `#checkout`, `#provider-routing`, `#execution`, and `#settlement`; its section navigation uses those anchors. There were no named section anchors on the previous How It Works page to migrate.

Marketing uses a shared catch-all route that resolves only configured canonical paths; unrecognized paths, including `/platform` and `/solutions`, return 404. Never add legacy routes to static generation or the sitemap. No public production origin has been invented.

## Provider portal

The provider workspace and internal review console are now part of this application. They require a Node server, PostgreSQL and a background worker; static export is no longer sufficient. See [Provider portal setup, accounts, security and adapter contracts](docs/PROVIDER-PORTAL.md).

Start at `/provider/sign-in`. Internal reviewers use `/ops/applications` after MFA verification. Development records and registry publication are explicitly sandbox-only; production services remain fail-closed until their adapters are implemented and configured.

### Customer payment sandbox

The persistent checkout, worker, settlement, webhook, reconciliation and operational journal walkthrough is in [docs/PAYMENTS.md](docs/PAYMENTS.md). Run `npm run payments:seed`, the existing portal worker, and `npm run payments:receiver`; sign in and open `/provider/payments`. Operations inspection is at `/ops/payments`.
