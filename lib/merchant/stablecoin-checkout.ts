import { z } from "zod";
import { tokenAsset, validStablecoinAmount } from "../blockchain/assets";
import { isTestnet } from "../blockchain/chains";
import { createIntent } from "../payments/service";
import { rateLimit, stepUp } from "../portal/access";
import { atomic, audit } from "../portal/service";
import { PortalError } from "../portal/domain";
import { merchantMember } from "./access";
import { session } from "./service";

export const stablecoinCheckoutInput = z
  .object({
    environment: z.enum(["sandbox", "production"]),
    key: z.string().regex(/^[\w-]{8,90}$/),
    reference: z.string().trim().min(1).max(100),
    payerCountry: z.string().regex(/^[A-Z]{2}$/),
    options: z
      .array(
        z
          .object({
            network: z.string(),
            identifier: z.string(),
            amount: z.string().max(100),
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict();

export function stablecoinCheckoutTerms(raw: unknown, returnOrigin: string) {
  const input = stablecoinCheckoutInput.parse(raw);
  const options = input.options.map((option) => {
    const token = tokenAsset(option.network, option.identifier);
    if (
      !token ||
      isTestnet(option.network) !== (input.environment === "sandbox") ||
      !validStablecoinAmount(option.network, option.identifier, option.amount)
    )
      throw new PortalError("STABLECOIN_ASSET_OR_AMOUNT_NOT_SUPPORTED", 409);
    const asset = {
      kind: "blockchain",
      network: token.network,
      identifier: token.identifier,
    };
    return {
      asset,
      settlement: asset,
      amount: option.amount,
      precision: token.decimals,
    };
  });
  if (
    new Set(options.map((o) => o.asset.network + "|" + o.asset.identifier))
      .size !== options.length
  )
    throw new PortalError("DUPLICATE_PAYMENT_OPTION", 409);
  return {
    ...options[0],
    reference: input.reference,
    payerCountry: input.payerCountry,
    methods: ["stablecoin"],
    returnUrl: new URL("/", returnOrigin).href,
    ...(options.length > 1 ? { paymentOptions: options.slice(1) } : {}),
  };
}

export async function createStablecoinCheckout(
  orgId: string,
  raw: unknown,
  headers: Headers,
) {
  const { config, session: actor } = await merchantMember(
    orgId,
    "configure",
    headers,
  );
  await stepUp(headers);
  await rateLimit(`stablecoin-checkout:${orgId}`, 30);
  const input = stablecoinCheckoutInput.parse(raw);
  if (input.environment !== config.environment)
    throw new PortalError("ENVIRONMENT_MISMATCH", 403);
  const intent = await createIntent(
    orgId,
    `dashboard-${input.key}`,
    stablecoinCheckoutTerms(input, config.returnOrigin),
  );
  const checkout = await session(
    { orgId, environment: config.environment },
    intent.id,
    `dashboard-${input.key}`,
  );
  await atomic((tx) =>
    audit(
      tx,
      orgId,
      actor.user.id,
      "merchant.stablecoin.checkout.created",
      intent.id,
      { environment: config.environment, reference: intent.reference },
    ),
  );
  return checkout;
}
