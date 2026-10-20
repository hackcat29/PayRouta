// Universal checkout: POST /checkouts. One call for one order, one checkout
// link for the checkout button: the customer pays with any fiat method the
// merchant accepts (card, digital wallet, bank transfer, mobile money, USSD, credit from a
// licensed lender) or switches to stablecoins and crypto from any wallet.
//
// Under the hood an order has up to two intents in one checkout group
// (./checkout-group): a fiat intent in the order currency, and a crypto
// checkout quoted from the same amount. Crypto quotes are denominated in USD
// (docs/crypto-payments.md), so crypto is offered only for USD orders; it is
// never converted from another currency at an estimated rate.
import { db } from "../portal/db";
import { PortalError } from "../portal/domain";
import { currencyExponent } from "../partners/money";
import { session } from "../merchant/service";
import { hash } from "./contracts";
import { createIntent } from "./service";
import { createCryptoCheckout } from "./crypto-checkout";
import { coinGeckoPrices } from "./crypto-prices";
import { universalCheckoutInput } from "./universal-contracts";
export { universalCheckoutInput } from "./universal-contracts";

export async function createUniversalCheckout(
  orgId: string,
  environment: string,
  key: string,
  raw: unknown,
  prices = coinGeckoPrices,
) {
  if (!/^[\w-]{8,80}$/.test(key)) throw new PortalError("INVALID_IDEMPOTENCY_KEY", 400);
  const input = universalCheckoutInput.parse(raw);
  const precision = currencyExponent(input.currency);
  if (precision === null || precision === undefined) throw new PortalError("UNSUPPORTED_CURRENCY", 409);
  const fraction = input.amount.split(".")[1] ?? "";
  if (fraction.length > precision) throw new PortalError("INVALID_AMOUNT", 400);
  if (input.crypto && input.currency !== "USD") throw new PortalError("UNIVERSAL_CRYPTO_REQUIRES_USD", 409);
  const amount = precision ? `${input.amount.split(".")[0]}.${fraction.padEnd(precision, "0")}` : input.amount;
  const group = `grp_${hash(`${orgId}:${environment}:${key}`).slice(0, 24)}`;
  const scope = { orgId, environment };

  const checkouts: { kind: "fiat" | "crypto"; intentId: string; checkoutPath: string; expiresAt: Date }[] = [];
  if (input.methods.length) {
    const fiat = { kind: "fiat", identifier: input.currency, network: "" };
    const intent = await createIntent(orgId, `u-${key}-fiat`, {
      reference: input.reference,
      payerCountry: input.payerCountry,
      amount,
      asset: fiat,
      precision,
      methods: input.methods,
      settlement: fiat,
      returnUrl: input.returnUrl,
      ...(input.feeBearer ? { feeBearer: input.feeBearer } : {}),
      ...(input.metadata ? { metadata: input.metadata } : {}),
    });
    const s = await session(scope, intent.id, `u-${key}-fiat`);
    checkouts.push({ kind: "fiat", intentId: intent.id, checkoutPath: s.checkoutPath, expiresAt: new Date(s.expiresAt) });
  }
  if (input.crypto) {
    const s = await createCryptoCheckout(
      orgId,
      environment,
      `u-${key}-crypto`,
      {
        reference: input.reference,
        payerCountry: input.payerCountry,
        // A USD amount normalized to two decimals, as crypto quotes require.
        usdAmount: amount,
        options: input.crypto.options,
        ...(input.feeBearer ? { feeBearer: input.feeBearer } : {}),
      },
      prices,
      { returnUrl: input.returnUrl },
    );
    checkouts.push({ kind: "crypto", intentId: s.intentId, checkoutPath: s.checkoutPath, expiresAt: new Date(s.expiresAt) });
  }
  // Join the group. An intent already in another group means the key was
  // reused for a different order.
  const ids = checkouts.map((c) => c.intentId);
  const joined = await db.paymentIntent.updateMany({
    where: { id: { in: ids }, orgId, environment, OR: [{ checkoutGroup: null }, { checkoutGroup: group }] },
    data: { checkoutGroup: group },
  });
  if (joined.count !== ids.length) throw new PortalError("IDEMPOTENCY_CONFLICT", 409);
  // The checkout opens on the fiat side when there is one; the customer can
  // switch to crypto from there.
  const primary = checkouts[0];
  return {
    id: group,
    reference: input.reference,
    checkoutPath: primary.checkoutPath,
    expiresAt: new Date(Math.min(...checkouts.map((c) => c.expiresAt.getTime()))).toISOString(),
    intents: checkouts.map((c) => ({ kind: c.kind, intentId: c.intentId })),
  };
}

// The checkout link of a universal checkout, re-read from the secret vault
// (sessions are idempotent per key), for integrations that send a returning
// customer back to an unfinished checkout.
export async function universalCheckoutPath(orgId: string, environment: string, key: string) {
  const scope = { orgId, environment };
  const fiat = await db.paymentIntent.findFirst({ where: { ...scope, key: `u-${key}-fiat` } });
  if (fiat) return (await session(scope, fiat.id, `u-${key}-fiat`)).checkoutPath;
  const crypto = await db.paymentIntent.findFirst({ where: { ...scope, key: `crypto-u-${key}-crypto` } });
  if (crypto) return (await session(scope, crypto.id, `crypto-u-${key}-crypto`)).checkoutPath;
  return null;
}
