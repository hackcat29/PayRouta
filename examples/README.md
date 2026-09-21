# Local merchant examples

These are single-order, loopback-only development examples. They reuse hosted checkout. They do not collect cards, publish SDKs, or authorize a live transaction.

1. Run the local app, database, worker, and payment fixtures per `docs/PAYMENTS.md`.
2. Sign in as the merchant owner. Verify your authenticator in the existing account settings. At `/merchant/developers/api-keys`, create a sandbox key with payment creation access.
3. Set `PAYROUTA_SECRET_KEY` in your shell privately and `DEMO_ORDER_ID` to a stable order identifier (8–80 characters). Do not log the key or include it in a URL.
4. Node: `npm run build --prefix sdks/node`, then `node examples/merchant-node/server.mjs`.
5. Python alternative: `PYTHONPATH=sdks/python python3 examples/merchant-python/server.py`.
6. `POST http://127.0.0.1:55440/checkout`; open the returned URL in your browser. `GET /payment` retrieves trusted payment state. Both examples use the same port; run one at a time.

The fixed fixture return origin is `http://127.0.0.1:3000/`. The React component is an integration example to mount on your own merchant origin alongside its backend; update registered return origin and return URL together for a complete navigation loop. A return/cancel query parameter never determines payment state. Press Check payment status after returning. The small example backend keeps the current payment ID in memory; production merchants must persist their order/payment association and use their existing customer authentication and CSRF controls. Reusing DEMO_ORDER_ID recovers the same intent after a restart; expired sessions do not create a new charge. Choose a new order ID only for an intentionally new order.

Local package installation: Node `npm install /absolute/path/to/PayRouta/sdks/node` after build; Python `python3 -m pip install /absolute/path/to/PayRouta/sdks/python`. Versions are private 0.1.0. No registry publication is configured or performed.
