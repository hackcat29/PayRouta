import { quoteAsset, onchainMethod } from "../blockchain/crypto-assets";
import { isTestnet } from "../blockchain/chains";
import { db } from "../portal/db";
import { json } from "../portal/service";
import { fingerprint } from "../portal/registry";
import { PortalError } from "../portal/domain";
import {
  coinGeckoPrices,
  cryptoPaymentTerms,
  quoteLifetimeMs,
} from "./crypto-prices";
import { createIntent } from "./service";
import { session } from "../merchant/service";
export { cryptoCheckoutInput } from "./crypto-contracts";
import { cryptoCheckoutInput } from "./crypto-contracts";
export type QuotedCryptoTerms = {
  input: unknown;
  options: ReturnType<typeof cryptoPaymentTerms>[];
  usdAmount: string;
  source: "CoinGecko";
};
export async function createCryptoCheckout(
  orgId: string,
  environment: string,
  key: string,
  raw: unknown,
  prices = coinGeckoPrices,
  // Universal checkout: the order's own return URL instead of the merchant's
  // home page (still checked against the merchant's return origin).
  extra: { returnUrl?: string } = {},
) {
  if (!/^[\w-]{8,90}$/.test(key))
    throw new PortalError("INVALID_IDEMPOTENCY_KEY", 400);
  const input = cryptoCheckoutInput.parse(raw),
    requestHash = fingerprint(input);
  const config = await db.merchantConfig.findUniqueOrThrow({
    where: { orgId },
  });
  if (config.environment !== environment)
    throw new PortalError("ENVIRONMENT_MISMATCH", 403);
  const assets = input.options.map((o) => {
    const asset = quoteAsset(o.network, o.identifier);
    if (!asset || isTestnet(o.network) !== (environment === "sandbox"))
      throw new PortalError("UNSUPPORTED_PAYMENT_ASSET", 409);
    return asset;
  });
  if (
    new Set(assets.map((a) => a.network + "|" + a.identifier)).size !==
    assets.length
  )
    throw new PortalError("DUPLICATE_PAYMENT_OPTION", 409);
  // Serialize by merchant+key. A stored quote is never repriced on a retry,
  // even if intent/session creation or the client's response was interrupted.
  const quote = await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`crypto-quote:${orgId}:${environment}:${key}`},0))`;
      const old = await tx.cryptoQuote.findUnique({
        where: { orgId_environment_key: { orgId, environment, key } },
      });
      if (old) {
        if (old.fingerprint !== requestHash)
          throw new PortalError("IDEMPOTENCY_CONFLICT", 409);
        return old;
      }
      const now = new Date(),
        market = await prices(assets, now);
      const expiresAt = new Date(Date.now() + quoteLifetimeMs(assets));
      const options = assets.map((a) =>
        cryptoPaymentTerms(
          a,
          input.usdAmount,
          market[a.coinGeckoId],
          environment,
          expiresAt,
        ),
      );
      const payment = options.map(({ price: _, feeSnapshot: __, ...o }) => {
        void _;
        void __;
        return o;
      });
      const terms: QuotedCryptoTerms = {
        input: {
          ...payment[0],
          reference: input.reference,
          payerCountry: input.payerCountry,
          methods: [
            ...new Set(
              assets.map((a) => onchainMethod(a.network, a.identifier)),
            ),
          ],
          returnUrl: extra.returnUrl ?? new URL("/", config.returnOrigin).href,
          ...(input.feeBearer ? { feeBearer: input.feeBearer } : {}),
          ...(payment.length > 1 ? { paymentOptions: payment.slice(1) } : {}),
        },
        options,
        usdAmount: input.usdAmount,
        source: "CoinGecko",
      };
      return tx.cryptoQuote.create({
        data: {
          orgId,
          environment,
          key,
          fingerprint: requestHash,
          request: json(input),
          terms: json(terms),
          expiresAt,
        },
      });
    },
    { timeout: 25000, maxWait: 10000 },
  );
  const terms = quote.terms as unknown as QuotedCryptoTerms;
  const intent = await createIntent(
    orgId,
    `crypto-${key}`,
    terms.input,
    new Date(),
    quote.id,
  );
  return session({ orgId, environment }, intent.id, `crypto-${key}`);
}
