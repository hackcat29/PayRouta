# Payment intents

> Launch scope: stablecoins and direct crypto wallet payments for every merchant, plus cards, digital wallets, bank transfers and mobile money through PayRouta's processing partners once your payments account is activated. Exchange-app payments are Coming soon. Stablecoin sandbox payments use actual testnet tokens; they cannot simulate a successful deposit. See [Crypto wallet payments](crypto-payments.md).
A payment intent records what is owed: the amount, the asset, which methods you accept, and where the customer returns. It is the object your systems reference from checkout through settlement.

## Lifecycle

| Intent state | Meaning |
| --- | --- |
| `Open` | Waiting for the customer to choose a method and confirm, or for them to try again after a rejection |
| `Processing` | A provider has been asked to execute the payment |
| `Confirmed` | The provider has confirmed that the customer's funds were accepted |
| `Cancelled` | You cancelled the intent before any attempt was made |

Each attempt through a provider has its own state: `Pending`, `Requires action` (the customer must complete a step), `Unknown`, `Confirmed` or `Rejected`.

- **Unknown is not a failure.** PayRouta rechecks with the provider before it considers any other route, so a customer is never charged twice.
- **A rejected attempt returns the intent to `Open`.** The rejected attempt is kept as evidence, and the customer can choose again.
- **`Confirmed` never goes back to an earlier state.** Conflicting provider evidence is raised as an exception for review instead.

## Expiry

An intent and its checkout sessions expire after 30 minutes. Funds that arrive after expiry are still recorded, and they raise a *late funds* exception for you to review.

## Methods and routing

`methods` limits what can be offered. At checkout PayRouta evaluates each accepted method against:

- your approved provider accounts
- the provider's health and restrictions
- the amount and currency
- your workspace's limits

Only methods that pass are shown.

Once the customer chooses a method, PayRouta ranks the eligible providers for **that method** by your routing policy (`balanced`, `lower-cost` or `faster`) and locks a route for 60 seconds. If a provider rejects the payment before it starts, PayRouta may try one alternate provider for the same method. It never switches the customer to a different method.

## Currency

`settlement` must currently equal `asset`, because PayRouta does not convert currencies. If you need conversion, arrange it with your provider.

## Choosing a stablecoin network

`paymentOptions` can contain up to 20 additional exact quotes: `asset`, `amount`, `precision` and `settlement`. The top-level quote remains the default. Each option needs an approved receive pool and must settle in its own asset. Quote all amounts explicitly; PayRouta does not assume a peg or convert EURC, USDC, USDT.

Checkout offers only those quoted options and locks the selection as soon as any payment attempt exists. A choice change before that point discards the earlier route and selects the matching trusted amount, asset and fee snapshot. Never fulfill an order until its authenticated payment-confirmed event.

Merchants can also create these checkouts under **Payment methods → Create stablecoin checkout**. Enter explicit amounts for the eligible token/network options. Open or copy the resulting link. A lost response can be retried to recover the same checkout without creating another invoice. Sandbox offers the registered USDC/EURC test deployments; USDT are labelled Mainnet only.

## Cancelling

`POST /payment-intents/{id}/cancel` works only before any payment attempt exists. It revokes the checkout sessions, but it cannot recall instructions a provider has already issued.

## Metadata

Up to 20 string pairs for your own reconciliation. Never put secrets, card data or personal identity data in metadata.

### `feeBearer`

Optional: `"merchant"` (absorb fees) or `"customer"` (add them to the amount). Defaults to your setting under **Settings → Who pays fees**. When the customer pays, the returned `amount` is the total charged, `baseAmount` your price and `customerFee` the difference. See [Fees and billing](billing.md).

Wallet checkouts created through `POST /api/v1/crypto-checkouts` can quote stablecoins and original crypto coins together against one USD total. Select the exact registered deployments and configured receive pools. Each option uses its own observed CoinGecko USD price, amount and fee valuation; EURC and dollar stablecoins are not assumed to have dollar parity. Customers can switch categories before any payment attempt, then the selected asset is locked. Wrapped and bridged tokens are excluded.
