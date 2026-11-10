# Command line

The `payrouta` command runs PayRouta from a terminal or a script. With a merchant API key it creates checkouts and payment links, looks up and refunds payments, manages plans and subscriptions, and records usage. With an agent key it pays links and invoices within the key's limits.

It has exactly the commands and permissions of the key you give it, the same as the [MCP server](mcp.md).

## Install

The CLI needs Node.js 20 or later.

```sh
npm run build --prefix sdks/cli
npm link ./sdks/cli
```

## Sign in

Create a key under **Developers → API keys** (or **Agent keys**), then:

```sh
payrouta login --key pr_sandbox_…
payrouta whoami
```

The key is saved to `~/.config/payrouta/config.json`, readable only by you. In CI, set `PAYROUTA_API_KEY` instead. `PAYROUTA_URL` points the CLI at another PayRouta host.

## Commands

| Command | Does | Needs |
| --- | --- | --- |
| `checkout create` | Creates a checkout for one order and prints its link | `payments:write` |
| `links create`, `links list` | Creates or lists payment links | `payments:write`, `payments:read` |
| `payments list`, `payments get <id>` | Lists payments, or shows one | `payments:read` |
| `payments refund <id>` | Refunds a payment, in full or in part | `refunds:write` |
| `plans create`, `plans list` | Creates or lists subscription plans | `subscriptions:write`, `subscriptions:read` |
| `subscriptions create`, `list`, `get <id>`, `cancel <id>` | Manages subscriptions | `subscriptions:write`, `subscriptions:read` |
| `usage record <subscription>` | Adds usage to a subscription's meter | `subscriptions:write` |
| `pay terms`, `open`, `checkout`, `submit`, `status`, `spending` | Pays a link or invoice with an agent key | agent key |

`payrouta tools` lists the commands your key can run. Add `--help` to any command for its flags.

## Examples

```sh
payrouta links create --title "Ankara dress" --amount 45.00 --currency USD \
  --country NG --methods card,bank-transfer --crypto

payrouta checkout create --reference order_2291 --amount 40.00 --currency USD \
  --payer-country NG --methods card,mobile-money --return-url https://shop.example/orders/2291

payrouta payments list --state Confirmed --limit 10
payrouta payments refund pay_123 --reason "Out of stock"
payrouta usage record sub_123 --meter api_calls --quantity 3200
```

Lists take commas (`--methods card,bank-transfer`) or repeated flags. `--no-crypto` sets a flag to false. `--json '{…}'` passes arguments as JSON.

## Output and exit codes

Output is JSON when piped, so scripts and agents can parse it, and plain text in a terminal. `--output json` or `--output text` chooses.

| Code | Meaning |
| --- | --- |
| `0` | Done |
| `1` | The operation failed; the message says why |
| `2` | The command or a flag was wrong |
| `3` | No key, or the key was refused |
