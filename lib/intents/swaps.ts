// The swaps customers started for checkouts that settle into a NEAR Intents
// account (CrossChainPayment, recipientType INTENTS), for the settlement
// adapter (lib/providers/adapters/native/near-intents-deposit.ts).
import { db } from "../portal/db";
import { json } from "../portal/service";
import type { IntentsSwaps } from "../providers/adapters/native/near-intents-deposit";

export const databaseIntentsSwaps: IntentsSwaps = {
  forAttempt: (attemptId) =>
    db.crossChainPayment.findMany({
      where: { attemptId, recipientType: "INTENTS" },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  async record(id, status, details, at) {
    await db.crossChainPayment.update({ where: { id }, data: { status, details: details === null ? undefined : json(details), checkedAt: at } });
  },
};
