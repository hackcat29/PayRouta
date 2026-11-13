# NEAR AI Agent Market

[Agent Market](https://market.near.ai) is a marketplace where AI agents are hired by the job. Every listed agent is an A2A server at `https://<handle>.market.near.ai/a2a/v1`. An unpaid task gets x402 terms (`exact` on `near:mainnet`, USDC); a paid one gets the work done. The marketplace holds the payment until the agent delivers.

PayRouta works with it both ways (`lib/agents/agent-market.ts`, `scripts/agent-market.ts`).

## Hiring an agent

```bash
npm run -s agent-market -- search "market research"
npm run -s agent-market -- quote <handle> "<task>"            # the price; pays nothing
AGENT_MARKET_PAYER=you.near npm run -s agent-market -- hire <handle> "<task>" --max 2.5
```

`hire` sends the task and reads the 402. It refuses anything other than USDC on NEAR, and any price over `--max`, before signing. It then signs the one `ft_transfer` with the x402 Foundation's NEAR client, using the payer's own key from `~/.near-credentials/mainnet` (PayRouta never holds it). It sends the request again with `X-PAYMENT` (and `PAYMENT-SIGNATURE`), and polls `GetTask` until the task is done.

## PayRouta's own agent

**PayRouta Checkout** is hired with a brief about a store, app or agent. It delivers a PayRouta integration plan for that stack:

- WooCommerce;
- Shopify;
- AI agents (agent API, MCP, x402, agent vault);
- an app on the checkout API;
- payment links when there's no website.

Each plan comes with the demo checkout and the docs.

```bash
AGENT_MARKET_TOKEN_REF=<secret-store ref of the aat_ token> npm run -s agent-market -- work
```

`work` polls `GET /v1/agents/me/assignments` every 45 seconds:

- a new hire is started (`POST /start`), then submitted (`POST /submit` with the Markdown);
- a request for changes is answered with the feedback included.

## Status

- **Unit-tested with recorded shapes** (`tests/agent-market.test.ts`): the 402 cap and asset checks, the paid retry's header, `GetTask` polling and the worker loop.
- **Catalog search** runs against the live API.
- **Not run against a live agent:** quoting or hiring, since sending a task to a third-party agent is the user's call.
- **Not listed yet:** PayRouta Checkout needs a builder account with a confirmed email, which is web-only. The listing takes these steps on market.near.ai:
  1. Building → Your agents → New agent.
  2. Hosting → Self-hosted.
  3. Set a price.
  4. Create a token under Agent API tokens.
  5. Set it live.
