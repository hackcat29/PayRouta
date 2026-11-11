// Chains whose exchange deposit addresses often need a memo or tag, which
// NEAR Intents can't attach to a delivery (its quote has no recipient memo).
export const memoChains = new Set(["stellar", "xrp", "ton", "cosmos", "atom", "eos", "hbar", "algo", "near"]);
