# Implementation progress

Source of truth: user-pasted build brief. Reference documents supply product background; aspirational claims do not establish live capabilities.

- Complete: Next.js foundation, supplied brand assets, shared design tokens, responsive navigation/footer, and homepage.
- Complete: deterministic routing simulation with explicit method selection, same-method pre-execution failover, exhaustion and stale-timer protection.
- Complete: all 11 primary routes and nine documentation child routes, local documentation search/copy, payment-method filtering.
- Complete: enquiry schema, validated server endpoint, configurable HTTPS delivery, honest unconfigured/error/acceptance states, retry identifiers.
- Complete: social image, canonical/robots/sitemap configuration, analytics adapter, README and launch guidance.
- Verification: production build, typecheck and lint pass; 13 focused unit/endpoint tests pass. All nine browser journeys pass after contrast fixes. Desktop/mobile screenshot review completed for homepage, How It Works, docs, and contact.

Deployment choice: ordinary local Next.js repository, as explicitly allowed by brief. No public publishing, external messages, or payments.

External launch configuration remains: actual production origin and host; verified lead webhook/token or fallback email; approved privacy/retention text; deployment-level distributed abuse protection. See README.md.


## Navigation and editorial update — complete

- Centralized typed Platform, Solutions, Developers navigation and canonical paths.
- Migrated five legacy routes with direct permanent redirects; query parameters retained.
- Adapted Payment Flow with section anchors; added Provider Routing and Settlement.
- Simplified marketing headings and removed redundant eyebrows, badges, status dots, repeated section numbers and capability tags. Functional payment states and early-access notices retained.
- Updated footer, internal links, static route generation, sitemap and canonical metadata. Documentation URLs unchanged; parent group routes return 404.
- Verified: production build, typecheck, lint, 14 unit tests and 12 browser journeys pass. Reviewed mobile/desktop screenshots for every marketing page; no overflow at the six tested widths.

## Provider onboarding portal — 17 September 2026

Implemented the separate provider workspace and internal operations console in the existing application. Added PostgreSQL/Prisma migrations, Better Auth verified accounts and TOTP, organization roles/invitations, concurrent versioned drafts, immutable submissions, exact directional capabilities, configurable evidence requirements/private quarantine, separate credential purposes and an external-key local vault, durable sandbox/check/publication jobs, review/change history, activation/suspension records, a local registry, effective availability gates, scoped operational tables and audit/notification views.

The local simulator is functional end-to-end. Production adapters remain explicitly unconfigured and fail closed. Setup, seeded accounts, role matrix, adapter contracts and launch checklist are in `docs/PROVIDER-PORTAL.md`; actual verification results are in `docs/PORTAL-VERIFICATION.md`.
