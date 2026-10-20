// Platform modules by PlatformAccount.provider. To add one: write a module
// next to this file implementing PlatformModule and list it below.
import { PortalError } from "../../portal/domain";
import { sandboxSimulation, secretManager } from "../../portal/adapters";
import { providerRequest } from "../../providers/adapters/http";
import type { PlatformAdapter, PlatformModule } from "./contract";
import { splitPlatformConfig } from "../partner-fees";
import { sandboxPlatform, sandboxSplitPlatform } from "./sandbox";
import { sandboxCreditPlatform } from "./sandbox-credit";
import { stripeCustomPlatform } from "./stripe-custom";
import { paystackSplitPlatform } from "./paystack-split";
import { flutterwaveSplitPlatform } from "./flutterwave-split";
import { dlocalPlatform } from "./dlocal";
import { tinkPlatform } from "./tink";

const modules = new Map<string, PlatformModule>(
  [
    sandboxPlatform,
    sandboxSplitPlatform,
    sandboxCreditPlatform,
    stripeCustomPlatform,
    paystackSplitPlatform,
    flutterwaveSplitPlatform,
    dlocalPlatform,
    tinkPlatform,
  ].map((m) => [m.manifest.id, m]),
);

export function platformModule(id: string): PlatformModule {
  const mod = modules.get(id);
  if (!mod) throw new PortalError("PLATFORM_UNKNOWN", 404);
  if (mod.manifest.sandboxOnly && !sandboxSimulation())
    throw new PortalError("PLATFORM_UNAVAILABLE", 404);
  return mod;
}

// The adapter for one PayRouta platform account, configured from its stored
// (non-secret) config plus secret references.
export function platformAdapter(account: {
  provider: string;
  environment: string;
  config: unknown;
}): PlatformAdapter {
  const mod = platformModule(account.provider);
  if (mod.manifest.sandboxOnly && account.environment !== "sandbox")
    throw new PortalError("SANDBOX_PLATFORM_ONLY", 409);
  const parsed = mod.configSchema.safeParse({
    ...splitPlatformConfig(account.config).moduleConfig,
    environment: account.environment,
  });
  if (!parsed.success) throw new PortalError("PLATFORM_ACCOUNT_CONFIG_INVALID", 409);
  return mod.create(parsed.data, { http: providerRequest, credentials: secretManager });
}
