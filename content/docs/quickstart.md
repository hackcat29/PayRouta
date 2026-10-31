# Quickstart

Create a sandbox payment, send a customer through hosted checkout, and verify the result. This guide uses real testnet stablecoin transfers; test tokens have no monetary value.

## 1. Create your workspace

1. Sign up, verify your email, and turn on an authenticator app under **Settings**.
2. Create a merchant workspace. Enter your business name and the origin customers return to after checkout (for example `https://shop.example`). New workspaces start in the **sandbox** environment.
3. Under **Payment methods**, configure fresh merchant-controlled USDC receive addresses on Base Sepolia.
4. Under **Developers → API keys**, verify your authenticator and create a sandbox key with payment-creation access. The secret (`pr_sandbox_…`) is shown once. Store it on your server only.

## 2. Install an SDK

Ask PayRouta for the TypeScript and Python SDKs. You can also call the HTTP API directly; see the [API reference](api-reference.md).

```ts
import { PayRouta } from "@payrouta/server";

const payrouta = new PayRouta({
  baseUrl: "https://<your PayRouta host>/api/v1",
  secretKey: process.env.PAYROUTA_SECRET_KEY!,
  environment: "sandbox",
});
```

## 3. Create a payment intent

Your server decides the amount. Never take it from the browser.

```ts
const asset = { kind: "blockchain", identifier: "erc20:0x036cbd53842c5426634e7929541ec2318f3dcf7e", network: "eip155:84532" } as const;
const intent = await payrouta.createIntent(
  {
    reference: "order_1042",
    amount: "1.000000",
    asset,
    precision: 6,
    methods: ["stablecoin"],
    settlement: asset,
    returnUrl: "https://shop.example/orders/1042",
  },
  "order_1042-intent", // idempotency key: reuse it when retrying this request
);
```

`returnUrl` must be on the return origin registered for your workspace.

## 4. Send the customer to checkout

```ts
const session = await payrouta.createCheckoutSession(intent.id, "order_1042-session");
const checkoutUrl = new URL(session.checkoutPath, "https://<your PayRouta host>").href;
// Redirect the customer to checkoutUrl.
```

The customer pays test USDC on the exact network shown. Other payment categories remain visible with Coming soon tags. Confirmation waits for chain finality.

## 5. Confirm the outcome on your server

Treat the customer's return to `returnUrl` as navigation only. Confirm the outcome from a verified webhook (see [Webhooks](webhooks.md)) or by reading the payment:

```ts
const payment = await payrouta.getPayment(intent.id);
if (payment.state === "Confirmed") {
  // Fulfil the order.
}
```

## 6. Test failure paths

Test wrong amounts, wrong networks and wallet cancellation with real testnet transfers. The stablecoin checkout does not accept simulated `scenario` outcomes.

## Going live

Live processing needs:

- merchant-owned production receive addresses and verified ownership evidence
- a reviewed live scope for your business
- current business screening, exact token/network approval, declared payer country and configured RPC/billing terms

The dashboard shows what is still outstanding.
