# MCP server

Connect your AI assistant to PayRouta with the Model Context Protocol. Claude, and any other MCP client, can then create checkouts and payment links, look up payments and issue refunds for your business, with only the permissions of the API key you give it.

For AI agents that pay merchants, see [Agentic payments](agents.md).

## Connect

The server is at `https://payrouta.com/api/mcp` (Streamable HTTP). Create an API key under **Developers → API keys**, then add the server to your client:

```json
{
  "mcpServers": {
    "payrouta": {
      "url": "https://payrouta.com/api/mcp",
      "headers": { "Authorization": "Bearer pr_production_…" }
    }
  }
}
```

A `pr_sandbox_…` key works in test mode, a `pr_production_…` key live. Every request carries the key; the server keeps no sessions.

## Tools

| Tool | Does | Needs |
| --- | --- | --- |
| `create_checkout` | Creates a checkout for one order and returns its link | `payments:write` |
| `create_payment_link` | Creates a reusable payment link | `payments:write` |
| `list_payment_links` | Lists your payment links | `payments:read` |
| `list_payments` | Lists payments, by state or reference | `payments:read` |
| `get_payment` | One payment by id | `payments:read` |
| `refund_payment` | Refunds a card, wallet or bank payment, in full or in part | `refunds:write` |

Choose **Payments and refunds** when you create the key to give it `refunds:write`. Without it, `refund_payment` answers that the key lacks the permission. Refunds are marked destructive, so clients ask before running them.

Crypto payments settled into your own NEAR Intents account are refunded from **Crypto balance**, where your wallet signs; an assistant can't do that for you.

## Errors

A tool that fails returns `isError: true` with a code and an explanation, for example `PAYMENT_NOT_FOUND: We couldn't find that payment.` A missing or revoked key gets HTTP 401.
