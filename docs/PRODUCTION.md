# Running PayRouta in production

This is the operator's runbook: server setup, configuration, deploys, opening live payments partner by partner, and routine operations. The last section lists what code cannot supply.

## 1. What runs where

| Process | What it does | Supervisor name |
| --- | --- | --- |
| Web (`.next/standalone/server.js`) | Site, dashboards, APIs, checkout, provider webhooks | `payrouta-web` |
| Worker (`scripts/worker.ts`) | Payments, provider status reads, partner provisioning, screening, malware scans, webhook deliveries, reconciliation, retention | `payrouta-worker` |

Both processes must be running. Without the worker, checkout never completes and applications never reach providers. The server also runs PostgreSQL 17, a ClamAV daemon (clamd) and nginx, and every one of them is bound to localhost except nginx.

## 2. First-time server setup

From a checkout of this repository on a fresh Ubuntu server:

```sh
DOMAIN=pay.example.com ADMIN_EMAIL=ops@example.com bash scripts/setup-vps.sh
```

The script:

- installs Node 24, PM2 with log rotation, PostgreSQL 17, ClamAV, nginx and certbot
- turns on a firewall (SSH and web only) and unattended security upgrades
- writes `/opt/payrouta/.env` (mode 0600) with a generated database password, auth secret and **secret-store master key**
- sets up a daily database backup kept for 14 days

**Back up `SECRET_MASTER_KEYS` offline immediately.** Every stored secret (partner API keys, webhook secrets) is encrypted under it; losing it means re-entering every secret.

Then fill in the remaining values in `/opt/payrouta/.env` (see §3). Add the GitHub secrets `CONTABO_HOST`, `CONTABO_USER` and `CONTABO_SSH_KEY`, and create a GitHub environment named `production` (you can require approval for it).

## 3. Configuration

| Variable | Needed for | Blocking |
| --- | --- | --- |
| `PORTAL_MODE=production`, `BETTER_AUTH_URL` (HTTPS), `BETTER_AUTH_SECRET` | Anything | Yes |
| `DATABASE_URL` | Anything | Yes |
| `SECRET_MASTER_KEYS` (and optionally `SECRET_ACTIVE_KEY_ID`) | Storing partner and webhook secrets | Yes |
| `SMTP_URL`, `MAIL_FROM` | Sign-up verification, password reset, invitations | Yes |
| `S3_BUCKET`, `S3_REGION` (+ AWS credential chain; `S3_ENDPOINT` for S3-compatible stores) | Evidence document storage | Yes |
| `CLAMD_HOST`, `CLAMD_PORT` | Malware scanning. Without it every document stays quarantined | Yes |
| `OPENSANCTIONS_API_KEY` | Screening merchants before any partner disclosure | Yes |
| `SITE_URL` | Indexable public site and canonical URLs | No |
| `CONTACT_WEBHOOK_URL` (+ token) | Website enquiries | No |
| `HOSTED_SANDBOX=enabled` | Merchants testing with simulated providers on this host | No |

`npm run preflight:production` prints this checklist against the live configuration without showing any values. Every deploy runs it, and **a deploy stops if a blocking item is missing**.

If you turn on the hosted sandbox, seed the simulated providers once:

```sh
cd /opt/payrouta/current && npm run sandbox:providers
```

## 4. Deploying

Pushing to `main` runs CI: typecheck, lint, unit tests, database tests against a disposable PostgreSQL, and a production build. The deploy then:

1. ships only tracked files (`git archive`) to `/opt/payrouta/releases/<commit>`
2. installs dependencies, generates the Prisma client, applies migrations and builds
3. runs the production preflight
4. switches `/opt/payrouta/current` to the new release and reloads both processes
5. checks `GET /api/health`, and rolls back to the previous release if the check fails
6. keeps the last five releases

Migrations only ever add; roll back code by pointing `current` at an earlier release and running `pm2 startOrReload /opt/payrouta/current/ecosystem.config.cjs`.

## 5. Opening live payments

Live payments go through accounts **the merchant owns** at each provider. They open provider by provider, and merchant by merchant.

### Per partner (once)

1. **Partner programme access.** Apply to the provider's partner programme where one is required (PayPal, Klarna, most others; Stripe Connect is self-serve). Confirm in writing that the accounts are merchant-owned (see `docs/PARTNER-PROGRAM.md`).
2. **Sandbox connection.** In **Ops → Partner programmes**, configure the sandbox connection with the provider's test credentials, and register the webhook URL shown there with the provider.
3. **Qualify in the provider's own sandbox.** Using a test merchant:
   - apply and finish the hosted onboarding until the account is Approved
   - confirm a signed account webhook arrives and matches
   - take a test payment through checkout to Confirmed
   - check that a missed webhook is recovered by a status read

   Record the IDs for each step under **Record sandbox qualification**.
4. **Production connection.** Only now can you configure and enable the production connection, with live credentials and the live webhook URL. PayRouta refuses to enable it without step 3.

### Per merchant

1. The merchant saves their business profile and applies to providers. PayRouta screens them with OpenSanctions, and reviews appear under **Screening held for review**.
2. The merchant finishes each provider's onboarding. Approved accounts appear on their **Payment methods** page.
3. The merchant submits **Business setup** with the required documents. Ops reviews it in **Merchants**.
4. Ops proposes and approves a **live scope**: the merchant's country, an explicit list of payer countries, the methods, one currency and limits. The proposal is pre-filled with the merchant's approved partner accounts.
5. With an approved scope, a clear screening and an approved account, the merchant's production intents execute on their own account.

## 6. Routine operations

| Task | How |
| --- | --- |
| Health | `GET /api/health`; `pm2 status`; `pm2 logs payrouta-worker` |
| Failed jobs | The preflight reports them. Inspect the `Job` table (`state = 'Failed'`, `error`) |
| Rotate the secret master key | Add a new key to `SECRET_MASTER_KEYS`, set `SECRET_ACTIVE_KEY_ID` to it, run `npm run secrets:rotate`, reload, then remove the old key |
| Rotate a partner credential | Save the connection again with the new secret; the old reference stays until you revoke it |
| Pause a partner | Disable its connection. Status reads pause, merchant state is unchanged, and it stops being offered at checkout |
| Restore a backup | `gunzip -c backup.sql.gz \| sudo -u postgres psql payrouta` into an empty database, then redeploy the matching release |
| Unmatched provider events | Listed in **Ops → Partner programmes** |

## 7. What code cannot supply

Use the current [global launch checklist](LAUNCH-CHECKLIST.md) and [platform billing runbook](PLATFORM-BILLING.md) before opening paid production scope. Configure accepted fee caps for every non-USD currency. Monthly usage statements need separate tax invoices and collection; no merchant money is automatically charged by the fee engine.


Before taking real money:

- **Legal opinion** on operating as a technology provider in each launch market. For example, confirm with counsel that Nigeria's CBN licensing categories don't apply to your flow.
- **Partner programme approvals** and signed terms with each provider, including data-processing agreements for the fields you share.
- **Published privacy notice and terms** covering merchant data, partner disclosures, screening and retention periods. The 90-day evidence retention is a development default, not a policy.
- **Security assurance** partners will ask for: a penetration test, an incident-response contact and process, and, as you grow, SOC 2 or ISO 27001.
- **Named operators** with verified identities and authenticator MFA, provisioned through a reviewed process, never public sign-up.
- **Real sandbox qualification** of each partner module (§5). The Stripe and PayPal modules have so far been verified only against simulated provider responses.
