# PayRouta docs (Mintlify)

The public developer docs, as a [Mintlify](https://mintlify.com) site. Pages are MDX; navigation, colours and the API reference are configured in `docs.json`.

## Preview

```sh
npm run docs:dev          # from the repository root, or: cd mintlify && npx mint dev
```

## Deploy

Mintlify deploys from Git. In the Mintlify dashboard, connect the GitHub repository (`hackcat29/PayRouta`), enable **monorepo** and set the docs path to `mintlify`. Every push to the default branch then publishes; pull requests get preview links.

## Keep it in sync

- **API reference.** `openapi/merchant.json` is generated from the merchant API contract (`lib/merchant/contracts.ts`). After changing the API, run `npm run docs:openapi` and commit the result; CI fails if it's stale. `openapi/provider.yaml` is the Provider API spec (`docs/provider-api.openapi.yaml`).
- **Checks.** CI (`.github/workflows/docs.yml`) runs `mint validate` and `mint broken-links` on every change here.
- **Facts.** Availability and prices must agree with `content/claims.ts`, which the marketing site uses. Don't present anything as live before it is.
