# SDKs

TypeScript (`@payrouta/server`) and Python (`payrouta-server`) clients are private 0.1.0 releases, shared with early-access merchants. They wrap the [HTTP API](api-reference.md); anything they don't cover can be called directly.

Both SDKs:

- refuse non-HTTPS base URLs (except local loopback), and refuse a key whose prefix doesn't match the environment
- retry **reads only**, at most twice, honouring `Retry-After`
- never retry a write automatically. After a timeout or a `5xx`, retry yourself with the **same** idempotency key
- raise errors carrying `code`, `status`, `requestId` and an `uncertain` flag for writes whose outcome is unknown

## TypeScript

```ts
import { PayRouta, verifyWebhook } from "@payrouta/server";

const payrouta = new PayRouta({
  baseUrl: "https://<your PayRouta host>/api/v1",
  secretKey: process.env.PAYROUTA_SECRET_KEY!,
  environment: "sandbox",
  timeoutMs: 10000,
});

const intent = await payrouta.createIntent({ /* see API reference */ }, "order_1042-intent");
const session = await payrouta.createCheckoutSession(intent.id, "order_1042-session");
const payment = await payrouta.getPayment(intent.id);

for await (const p of payrouta.paginate("payments", { state: "Confirmed" })) {
  // …
}
```

## Python

```python
from payrouta import PayRouta, verify_webhook

payrouta = PayRouta("https://<your PayRouta host>/api/v1", secret_key, "sandbox")
intent = payrouta.create_intent({...}, "order_1042-intent")
session = payrouta.create_checkout_session(intent["id"], "order_1042-session")
payment = payrouta.get_payment(intent["id"])
```

## Keys

Keep API keys on your server. Never put them in browser code, URLs, logs or payment metadata. To rotate a key: create the new key, deploy it, then revoke the old one.
