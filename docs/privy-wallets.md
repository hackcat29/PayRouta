# Privy merchant wallets

The merchant Crypto balance page offers optional, user-owned embedded EVM
wallets alongside existing NEAR and browser wallets. Portal authentication
continues to use Better Auth. Wallet sign-in is a separate email verification
with Privy; it does not grant access to a PayRouta business.

## Enable

1. In the Privy dashboard, select the PayRouta app, enable email login and
   user-owned Ethereum embedded wallets. Do not configure a developer-controlled
   owner, delegated signer, or server signer for this flow. Keep wallet export
   enabled; configure recovery and MFA before funding wallets.
2. Add the exact deployment origin to Privy's allowed origins. For development,
   allow `http://127.0.0.1:3000` (or the actual port used locally).
3. Set `NEXT_PUBLIC_PRIVY_APP_ID` in the deployment build environment. The supplied
   app ID is `cmw51vn5102370hjvg2bresn6`. If the app uses a separate client,
   also set `NEXT_PUBLIC_PRIVY_CLIENT_ID`. Both are public identifiers. No app
   secret, authorization private key, or server signing credential is needed.
4. Rebuild and restart. Without an app ID, external-wallet functionality is used.

## Flow and control

In live mode, an owner/admin selects settlement assets, signs in to the wallet,
explicitly creates a wallet if needed, then chooses **Connect this wallet**.
Wallet creation alone never replaces a business receive account. The existing
merchant endpoint issues an expiring, single-use business-bound challenge,
checks membership and step-up authentication, and verifies the EVM signature
before connecting the account. Existing live-processing reviews still apply.

This connects an EVM signing identity to the existing **NEAR Intents account**.
The displayed balance is held on NEAR Intents, not the EVM address's onchain
USDC balance. Do not send EVM tokens directly to the displayed address expecting
them to appear in that balance. Checkout uses its own quoted deposit flow.
The native receive-address pools are unchanged: a single embedded wallet
address must not be added repeatedly to simulate fresh checkout addresses.

Payouts, refunds, and existing cash-out signing re-resolve the authenticated
embedded wallet against the saved account address and prompt for a signature.
No PayRouta server can sign or sweep funds. Export opens Privy's own export UI;
PayRouta does not receive, log, or store the key. Wallet sessions are cleared
when a different PayRouta user opens this flow in the same browser.

The wallet belongs to its individual Privy login, **not** every admin of the
organization. An invited admin cannot automatically use it. Multi-admin
organization wallets, recovery/ownership transfer procedures, and delegated
automation require a separate design. Use an external organization-controlled
wallet if this personal ownership model is unsuitable.

## Limits and verification

This does not provision Bridge customers, bank accounts, direct EVM receive
balances, gas sponsorship, or automatic fiat settlement. Bridge eligibility,
KYB, supported networks/currencies, and settlement integration remain separate.
The integration currently exposes EVM wallets; it does not create Privy Solana,
Stellar, or NEAR wallets. The SDK's Solana peer packages are installed because
the bundler resolves their optional imports even in the EVM flow.

Before production funding, test email verification, wallet creation, export,
the ownership challenge, a refresh/reconnect, signature cancellation, wrong
wallet rejection, and portal/wallet sign-out using the real Privy app. This
requires interactive email verification. Unit tests cover provider selection,
logout/readiness guards, changed accounts, rejected signing, and compatibility
with the server's ERC-191 ownership verifier. They do not establish that the
Privy dashboard or a deployed origin has been configured correctly.

Official references:

- [React setup](https://docs.privy.io/basics/react/setup)
- [Wallet creation](https://docs.privy.io/wallets/wallets/create/create-a-wallet)
- [Export](https://docs.privy.io/wallets/wallets/export)
- [Ethereum provider](https://docs.privy.io/wallets/using-wallets/ethereum/ethereum-provider)

## Dependency review

The production build, type checking, focused lint checks, and 20 wallet/intents
tests pass. A local browser smoke check using the supplied App ID confirmed
that the wallet controls and Privy email login dialog load, with no page errors.
It did not complete email verification, create a wallet, or move funds.
The broader suite passed 741 tests; four email-marketing tests could not reach
the local database at `127.0.0.1:55432`.

The dependency audit still reports advisories, including Privy's transitive
WalletConnect/x402 dependencies and a pre-existing critical Better Auth
advisory. Patched `decode-uri-component` and 8.x `ws` versions are enforced via
overrides. These overrides do not resolve every advisory. Review the remaining
dependency findings before deploying; do not apply `npm audit fix --force`
blindly, since its proposed SDK downgrade can break this integration.
