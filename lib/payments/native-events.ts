import { z } from "zod";
import { PortalError } from "../portal/domain";
import { hash, providerFact } from "./contracts";
import {
  adyenConfigSchema,
  verifyAdyenItem,
} from "../providers/adapters/native/adyen";
import {
  fiatAsset,
  minorAmount,
  object,
  parseConfig,
  textField,
} from "../providers/adapters/native/common";

export function adyenCaptureEvents(config: unknown, raw: string, key: string) {
  const c = parseConfig(adyenConfigSchema, config);
  const body = z
    .object({
      live: z.enum(["true", "false"]),
      notificationItems: z
        .array(
          z.object({
            NotificationRequestItem: z.record(z.string(), z.unknown()),
          }),
        )
        .min(1)
        .max(100),
    })
    .parse(JSON.parse(raw));
  if (body.live !== String(c.environment === "production"))
    throw new PortalError("PROVIDER_ENVIRONMENT_MISMATCH", 401);
  const events = [];
  // Verify the complete batch before callers persist any item.
  for (const entry of body.notificationItems) {
    const i = entry.NotificationRequestItem;
    if (i.merchantAccountCode !== c.merchantAccount || !verifyAdyenItem(i, key))
      throw new PortalError("INVALID_SIGNATURE", 401);
    if (i.eventCode !== "CAPTURE" || i.success !== "true") continue;
    const amount = object(i.amount),
      pspReference = textField(i.pspReference);
    const currency = textField(amount.currency, 3),
      attemptKey = textField(i.merchantReference);
    const fact = providerFact.parse({
      reference: pspReference,
      state: "Confirmed",
      amount: minorAmount(amount.value, currency),
      asset: fiatAsset(currency),
    });
    // Store only signed fields. Webhook dates, reason and paymentLinkId are
    // not HMAC-covered and cannot supply financial or routing evidence.
    const payload = {
      type: "native.capture",
      attemptKey,
      pspReference,
      originalReference: textField(i.originalReference),
      merchantAccount: c.merchantAccount,
      amount: fact.amount,
      asset: fact.asset,
      state: fact.state,
    };
    events.push({
      eventId: `adyen-capture-${hash(pspReference)}`,
      fingerprint: hash(JSON.stringify(payload)),
      payload,
    });
  }
  return events;
}
