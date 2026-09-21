# Provider portal verification — 17 September 2026

Verification ran locally against Next.js 16.3.5, Better Auth 1.7.5, Prisma 7.10.0 and PostgreSQL 17.7. Browser acceptance used Chromium through Playwright, with the production Next build and a separately running durable worker.

| Check | Actual result |
|---|---|
| Production build | Passed; all marketing and portal routes compiled |
| TypeScript | Passed |
| ESLint | Passed with no warnings |
| Unit tests | 25 passed |
| Provider portal browser journeys | 5 passed |
| Existing marketing browser journeys | 12 passed |
| npm security audit | 0 reported vulnerabilities |
| Patch whitespace check | Passed |

The five portal journeys cover:

1. Persisting all onboarding sections, defining a capability, fixture evidence, stored simulator runs, duplicate run/submission requests, immutable snapshots (including direct database mutation rejection), requested changes and responses, concurrent-edit rejection, resubmission, separate reviews, approval, blocked production activation, acknowledged sandbox publication, idempotent publication retry, proposed edits preserving the published version, observed availability, manual reductions and acknowledged suspension.
2. Cross-tenant write denial, role denial, credential step-up, secret redaction from responses/page content/audits, private multipart upload, unscanned and unauthorized document access denial, and CSRF rejection.
3. All provider routes, desktop/mobile screenshots, overflow checks, zero axe WCAG A/AA violations on the onboarding checklist, no browser page errors, and genuinely empty production transactions/performance.
4. Real UI signup, local captured email verification, new organization, incomplete draft persistence/resumption, TOTP enrollment and step-up, last-owner protection, recipient-bound invitation acceptance and single-use enforcement.
5. Internal Reviewer versus Operations admin permissions, provider denial from review actions, another tenant's transaction detail denial, all 12 deterministic simulator scenarios, and authentication throttling.

The unit suite includes exact decimal arithmetic, direction/network validation, permission rules, allowed state transitions, safe incomplete draft validation, private/mapped-IP SSRF denial, file signature restrictions, nested credential redaction, uncertain execution handling, simulator/production separation, and effective eligibility gates. It also retains the marketing routing-demo and enquiry tests.

Desktop and mobile screenshot review covered onboarding, capability configuration, application review, transaction detail and internal review. The final retained screenshots are in `.local/review/` (development artifacts, intentionally ignored by Git). Source browser tests regenerate them in `test-results/`.

Issues found and corrected during verification: local service restart after resumption; a contact-page static/runtime configuration mismatch; insufficient footer contrast on mobile; form hint text included in accessible control names; country-name hydration differences across Node/browser locale data; a temporary vault-key location that did not survive session cleanup. The vault now uses a durable private directory outside the repository. Two inaccessible fictional test credentials were explicitly retired rather than reported as usable.

These results verify the local control-plane implementation and simulator. They are not a penetration-test certification or evidence that a real payment provider integration, malware scanner, production registry, production mail or managed secret service is connected. Those gates remain closed; see `PROVIDER-PORTAL.md` for exact adapter and deployment requirements. No public deployment, real message delivery, or movement of funds was performed.
