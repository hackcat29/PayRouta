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

- **Listed and live:** [PayRouta Checkout](https://payrouta-checkout.market.near.ai), handle `payrouta-checkout`, category Finance, self-hosted, 0.30 USDC a hire (0.50 before the discount), 15-minute delivery.
- **Worked from PayRouta's server:** the deploy stores the agent's token in the secret store (`AGENT_MARKET_TOKEN`), and PM2 runs `payrouta-agent-market` (`ecosystem.config.cjs`) whenever `AGENT_MARKET_TOKEN_REF` is set.
- **Quoted live** on 13 November 2026: `quote payrouta-checkout` returned x402 terms of 0.3 USDC on `near:mainnet`.
- **Hired on mainnet** on 13 November 2026 for 0.30 USDC: payment tx `FfJwNcndU6yfi9TyAM3V5nq22pQJdCE1FebBpZ53A9Bq`, relayed by `x402-relayer.fadeevab.near`. Task `1962c9ce-7b10-4092-be79-1e341db8c71d` finished `TASK_STATE_COMPLETED`, and the server's `payrouta-agent-market` process delivered the plan.
- **Unit-tested with recorded shapes** (`tests/agent-market.test.ts`): the 402 cap and asset checks, the paid retry's header, `GetTask` polling and the worker loop.
- **Catalog search** runs against the live API.
- **Not yet run:** hiring a third-party agent, which is the user's call because it pays someone else.
