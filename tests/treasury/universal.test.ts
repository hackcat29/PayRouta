// Universal checkout (POST /checkouts) under the launch scope: one order, one
// checkout link, card and credit on the fiat side and USDC from a wallet on
// the crypto side. The customer can switch between them until a payment
// starts; then the other side is locked.
Object.assign(process.env, { NODE_ENV: "test" });
delete process.env.PAYMENT_TEST_LEGACY_METHODS;
import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { db } from "../../lib/portal/db";
import { json } from "../../lib/portal/service";
import { enforceLaunchScope } from "../../lib/payments/launch";
import { createUniversalCheckout } from "../../lib/payments/universal";
import { confirm, methods, progress, selectMethod, switchTo } from "../../lib/payments/service";
import { liveMerchant, sandboxEntity } from "../fixtures/live-merchant";

const usdcBaseSepolia = { network: "eip155:84532", identifier: "erc20:0x036cbd53842c5426634e7929541ec2318f3dcf7e" };
const prices = async () => ({ "usd-coin": { usd: "1.00", source: "CoinGecko" as const, updatedAt: new Date().toISOString() } });
let entityId: string;
let accounts: Record<string, string>;

before(async () => {
  if (!process.env.DATABASE_URL?.includes("127.0.0.1:55432/payrouta") || process.env.PORTAL_MODE !== "local")
    throw new Error("Requires isolated local fixtures");
  assert.equal(enforceLaunchScope(), true);
  ({ entityId, accounts } = await sandboxEntity("Universal", ["sandbox-platform", "sandbox-credit"]));
});
after(() => db.$disconnect());

async function merchant() {
  const orgId = await liveMerchant(entityId, [accounts["sandbox-platform"], accounts["sandbox-credit"]], "USD");
  // The merchant's own USDC receive addresses on Base Sepolia.
  await db.integration.create({
    data: {
      orgId,
      environment: "sandbox",
      version: (await db.integration.count({ where: { orgId, environment: "sandbox" } })) + 1,
      config: json({
        mode: "NATIVE",
        adapter: "erc20-deposit",
        environment: "sandbox",
        ...usdcBaseSepolia,
        publicRpc: true,
        addresses: Array.from({ length: 5 }, () => `0x${randomBytes(20).toString("hex")}`),
        accountId: "fictional-universal-usdc",
      }),
    },
  });
  return orgId;
}

const order = (extra: object = {}) => ({
  reference: `order-${randomUUID().slice(0, 8)}`,
  payerCountry: "GB",
  amount: "40",
  currency: "USD",
  methods: ["card", "bnpl"],
  crypto: { options: [usdcBaseSepolia] },
  returnUrl: "http://127.0.0.1:3000/orders/1",
  ...extra,
});
const token = (path: string) => path.split("#")[1];
const sessionId = (path: string) => path.split("/checkout/")[1].split("#")[0];

test("universal: one call creates a fiat and a crypto checkout for the same order", async () => {
  const orgId = await merchant();
  const key = `universal-${randomUUID()}`;
  const body = order();
  const checkout = await createUniversalCheckout(orgId, "sandbox", key, body, prices);
  assert.deepEqual(checkout.intents.map((i) => i.kind), ["fiat", "crypto"]);
  assert.match(checkout.id, /^grp_[a-f0-9]{24}$/);
  // Retries return the same checkout.
  const again = await createUniversalCheckout(orgId, "sandbox", key, body, prices);
  assert.deepEqual(again.intents, checkout.intents);
  const [fiat, crypto] = await Promise.all(checkout.intents.map((i) => db.paymentIntent.findUniqueOrThrow({ where: { id: i.intentId } })));
  assert.equal(fiat.amount, "40.00");
  assert.equal(fiat.checkoutGroup, checkout.id);
  assert.equal(crypto.checkoutGroup, checkout.id);
  assert.equal(crypto.returnUrl, body.returnUrl, "both sides return to the order");

  // The checkout opens on the fiat side and offers crypto as the alternative.
  const id = sessionId(checkout.checkoutPath);
  const t = token(checkout.checkoutPath);
  assert.deepEqual((await progress(id, t)).alternatives, [{ kind: "crypto", available: true }]);
  const moved = await switchTo(id, t, "crypto");
  const cryptoView = await progress(sessionId(moved.checkoutPath), token(moved.checkoutPath));
  assert.equal(cryptoView.reference, body.reference);
  assert.equal(cryptoView.paymentOptions[0].amount, "40.000000");
  assert.deepEqual(cryptoView.alternatives, [{ kind: "fiat", available: true }]);
});

test("universal: once a payment starts on one side, the other is locked", async () => {
  const orgId = await merchant();
  const checkout = await createUniversalCheckout(orgId, "sandbox", `universal-${randomUUID()}`, order(), prices);
  const id = sessionId(checkout.checkoutPath);
  const t = token(checkout.checkoutPath);
  const moved = await switchTo(id, t, "crypto");
  const cid = sessionId(moved.checkoutPath);
  const ct = token(moved.checkoutPath);

  await methods(id, t);
  const route = await selectMethod(id, t, "card");
  await confirm(id, t, route.routeId);
  assert.equal((await progress(cid, ct)).alternatives[0].available, false);
  await assert.rejects(switchTo(id, t, "crypto"), /PAYMENT_ALREADY_IN_PROGRESS/);
  await methods(cid, ct);
  const cryptoRoute = await selectMethod(cid, ct, "stablecoin");
  await assert.rejects(confirm(cid, ct, cryptoRoute.routeId), /PAYMENT_ALREADY_IN_PROGRESS/);
});

test("universal: crypto is offered only for USD orders, never at an estimated rate", async () => {
  const orgId = await merchant();
  await assert.rejects(
    createUniversalCheckout(orgId, "sandbox", `universal-${randomUUID()}`, order({ currency: "GBP" }), prices),
    /UNIVERSAL_CRYPTO_REQUIRES_USD/,
  );
  await assert.rejects(
    createUniversalCheckout(orgId, "sandbox", `universal-${randomUUID()}`, order({ amount: "40.001" }), prices),
    /INVALID_AMOUNT/,
  );
  const fiatOnly = await createUniversalCheckout(orgId, "sandbox", `universal-${randomUUID()}`, order({ currency: "USD", crypto: undefined }), prices);
  assert.deepEqual(fiatOnly.intents.map((i) => i.kind), ["fiat"]);
});
