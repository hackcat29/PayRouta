# PayRouta CLI

Run PayRouta from a terminal or a script: create checkouts and payment links,
look up and refund payments, manage plans and subscriptions, record usage,
and, with an agent key, pay links and invoices.

The CLI speaks to PayRouta's MCP endpoint, so it has exactly the commands
and permissions of the key you give it. New operations appear in
`payrouta tools` as soon as the server has them.

## Install

```sh
npm run build --prefix sdks/cli
npm link ./sdks/cli        # puts `payrouta` on your PATH
```

## Sign in

```sh
payrouta login --key pr_sandbox_…          # a merchant API key
payrouta login --key pra_…                 # or an agent key
payrouta whoami
```

The key is saved to `~/.config/payrouta/config.json` (readable only by
you). `PAYROUTA_API_KEY` and `PAYROUTA_URL` override it, which suits CI.

## Examples

```sh
payrouta links create --title "Ankara dress" --amount 45.00 --currency USD \
  --country NG --methods card,bank-transfer --crypto

payrouta checkout create --reference order_2291 --amount 40.00 --currency USD \
  --payer-country NG --methods card,mobile-money --return-url https://shop.example/orders/2291

payrouta payments list --state Confirmed --limit 10
payrouta payments get pay_123
payrouta payments refund pay_123 --reason "Out of stock"

payrouta subscriptions list --state Active
payrouta usage record sub_123 --meter api_calls --quantity 3200
```

Every command takes `--help` for its flags (typed from the server's schema),
and `--json '{…}'` for raw arguments. Output is JSON when piped, so scripts
and agents can read it, and plain text in a terminal; `--output json|text`
chooses.

Exit codes: `0` done, `1` the operation failed, `2` usage error, `3` no key or
the key was refused.
