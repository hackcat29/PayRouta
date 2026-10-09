import { supportedPaymentMethodIds, labelOf } from "../providers/normalized";
export const enabledLaunchMethods = ["stablecoin", "crypto-app"] as const;
export const comingSoonMethods = supportedPaymentMethodIds
  .filter((m) => m !== "stablecoin" && m !== "crypto-app")
  .map((method) => ({
    method,
    label: labelOf(method),
    status: "COMING_SOON",
    explanation: "Coming soon",
  }));
