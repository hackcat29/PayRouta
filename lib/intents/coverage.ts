// How many tokens and chains customers can pay from through NEAR Intents,
// counted from 1Click's live token list for the marketing site (refreshed
// with the pages; see `revalidate` on app/page.tsx and app/[...path]).
// Falls back to the last count read when the list can't be reached.
import { tokens, type Http } from "./oneclick";

export const lastCounted = { tokens: 229, chains: 39 };

export async function nearIntentsCoverage(http?: Http) {
  try {
    const list = await tokens(http);
    const chains = new Set(list.map((t) => t.blockchain)).size;
    return list.length >= 50 && chains >= 10 ? { tokens: list.length, chains } : lastCounted;
  } catch {
    return lastCounted;
  }
}
