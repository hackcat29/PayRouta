// Universal checkout groups (lib/payments/universal.ts). One order can have a
// fiat intent (cards, digital wallets, bank transfer, mobile money, credit) and a crypto
// intent (stablecoins and crypto from any wallet), because the two are priced
// differently: a fiat amount, and a crypto quote with its own deadline. The
// customer sees one checkout and can switch between them until a payment
// starts. From then on the group is locked to that intent.
import { randomBytes } from "node:crypto";
import { db } from "../portal/db";
import { PortalError } from "../portal/domain";
import { activeStates, hash } from "./contracts";
import type { Prisma } from "../generated/prisma/client";

type Tx = Prisma.TransactionClient;
type Grouped = { id: string; orgId: string; environment: string; checkoutGroup: string | null };
export type CheckoutKind = "fiat" | "crypto";

export const kindOf = (asset: unknown): CheckoutKind =>
  (asset as { kind?: string } | null)?.kind === "fiat" ? "fiat" : "crypto";

const siblings = (client: Tx | typeof db, intent: Grouped) =>
  intent.checkoutGroup
    ? client.paymentIntent.findMany({
        where: {
          checkoutGroup: intent.checkoutGroup,
          orgId: intent.orgId,
          environment: intent.environment,
          id: { not: intent.id },
        },
      })
    : Promise.resolve([]);

// Called inside the transaction that starts a payment attempt. Serializable
// isolation (lib/portal/service atomic) makes two concurrent starts in one
// group conflict, so at most one wins.
export async function assertGroupFree(tx: Tx, intent: Grouped) {
  for (const other of await siblings(tx, intent)) {
    if (["Processing", "Confirmed"].includes(other.state)) throw new PortalError("PAYMENT_ALREADY_IN_PROGRESS", 409);
    if (await tx.paymentAttempt.count({ where: { intentId: other.id, state: { in: activeStates } } }))
      throw new PortalError("PAYMENT_ALREADY_IN_PROGRESS", 409);
  }
}

// The other ways to pay this order, as the checkout offers them.
export async function alternatives(intent: Grouped, now = new Date()) {
  return (await siblings(db, intent)).map((other) => ({
    kind: kindOf(other.asset),
    available: other.state === "Open" && other.expiresAt > now,
  }));
}

// Moves the customer to the order's other checkout: a new limited session for
// the sibling intent, like the wallet-browser handoff. Refused once a payment
// has started on either side.
export async function switchCheckout(intent: Grouped & { state: string }, to: CheckoutKind, now = new Date()) {
  if (intent.state !== "Open" || (await db.paymentAttempt.count({ where: { intentId: intent.id, state: { in: activeStates } } })))
    throw new PortalError("PAYMENT_ALREADY_IN_PROGRESS", 409);
  const target = (await siblings(db, intent)).find((o) => kindOf(o.asset) === to);
  if (!target) throw new PortalError("PAYMENT_OPTION_NOT_OFFERED", 409);
  if (target.state !== "Open" || target.expiresAt <= now) throw new PortalError("CHECKOUT_EXPIRED", 409);
  const token = randomBytes(32).toString("base64url");
  const session = await db.checkoutSession.create({
    data: { intentId: target.id, verifier: hash(token), expiresAt: target.expiresAt },
  });
  return { checkoutPath: `/checkout/${session.id}#${token}`, expiresAt: target.expiresAt.toISOString() };
}
