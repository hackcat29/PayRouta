# PayRouta Python server SDK (private 0.1.0)

Python 3.10+, standard-library runtime. Install locally with `python3 -m pip install /absolute/path/to/PayRouta/sdks/python`. No package has been published.

```python
import os
from payrouta import PayRouta, PayRoutaError, verify_webhook
client = PayRouta('http://127.0.0.1:3000/api/v1/',
                 os.environ['PAYROUTA_SECRET_KEY'], 'sandbox', timeout=10)
for payment in client.paginate('payments', limit='25'):
    pass  # Amounts remain exact strings.
```

Use `create_intent(input, stable_order_key)`, `create_checkout_session(intent_id, stable_session_key)`, and `get_payment(id)`. Other resources use `request(method, relative_path, body=None, idempotency_key=None)`. See [API contract](../../docs/MERCHANT-API.md) and [working local servers](../../examples/README.md).

Only GET responses 429/502/503/504 retry, at most twice; Retry-After above 60 seconds returns RETRY_LATER. Writes never automatically retry. PayRoutaError carries code, status, request_id and uncertain. Keep the original idempotency key after an uncertain write and retrieve trusted state. Injectable transport and sleep support deterministic tests.

Call `verify_webhook(raw_bytes, headers, {key_id: secret})` before JSON parsing. Retain previous signing keys during rotation and persist processed event IDs. The default timestamp tolerance is five minutes. Do not put server keys into React.

Run `npm run test:sdk-python` from the repository root. Release checklist: align SDK/API versions, run unit and API contract tests, inspect the built distribution, and obtain authorization before registry publication.
