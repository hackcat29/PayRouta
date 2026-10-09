import { z } from "zod";
import { merchantMember } from "./access";
import { stepUp, rateLimit } from "../portal/access";
import { createCryptoCheckout } from "../payments/crypto-checkout";
import { cryptoCheckoutInput } from "../payments/crypto-contracts";
import { PortalError } from "../portal/domain";
import { atomic, audit } from "../portal/service";
const dashboardInput = cryptoCheckoutInput
  .extend({
    key: z.string().regex(/^[\w-]{8,90}$/),
    environment: z.enum(["sandbox", "production"]),
  })
  .strict();
export async function createMerchantCryptoCheckout(
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
  await rateLimit(`crypto-checkout:${orgId}`, 30);
  const { key, environment, ...input } = dashboardInput.parse(raw);
  if (environment !== config.environment)
    throw new PortalError("ENVIRONMENT_MISMATCH", 403);
  const result = await createCryptoCheckout(orgId, environment, key, input);
  await atomic((tx) =>
    audit(
      tx,
      orgId,
      actor.user.id,
      "merchant.crypto.checkout.created",
      result.intentId,
      { environment, reference: input.reference },
    ),
  );
  return result;
}
