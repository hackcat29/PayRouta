// Partner module registry. To add a partner: write a module under ./adapters,
// add it to `modules` below, and make it pass tests/partners.test.ts
// conformance. This registry holds merchant-owned accounts (custody
// "merchant-owned") only, so it refuses any module whose programme would make
// PayRouta liable for the merchant. Aggregator programmes, where PayRouta
// holds the platform account, are PlatformAccounts in lib/treasury.
import { PortalError } from "../portal/domain";
import { sandboxSimulation } from "../portal/adapters";
import { merchantOwned, type PartnerManifest, type PartnerModule } from "./contract";
import { kybFields } from "./kyb";
import { sandboxPartner } from "./adapters/sandbox";
import { paypalPartner } from "./adapters/paypal";

export function validateManifest(m: PartnerManifest) {
  const problems: string[] = [];
  if (!/^[a-z][a-z0-9-]{1,40}$/.test(m.id)) problems.push("id");
  if (m.contractVersion !== 1) problems.push("contractVersion");
  if (!merchantOwned(m.ownership)) problems.push("ownership:not-merchant-owned");
  if (!m.sharedFields.length) problems.push("sharedFields:empty");
  if (m.sharedFields.some((f) => !kybFields.includes(f)))
    problems.push("sharedFields:unknown");
  if (new Set(m.sharedFields).size !== m.sharedFields.length)
    problems.push("sharedFields:duplicate");
  if (!m.linkHosts.length) problems.push("linkHosts:empty");
  if (m.linkHosts.some((h) => !/^[a-z0-9.-]+(:\d+)?$/.test(h)))
    problems.push("linkHosts:invalid");
  if (!m.sandboxOnly && m.linkHosts.some((h) => h.includes(":")))
    problems.push("linkHosts:port");
  if (!m.methods.length) problems.push("methods:empty");
  if (m.paymentMethods?.some((pm) => !m.methods.includes(pm)))
    problems.push("paymentMethods:not-declared-in-methods");
  return problems;
}

function build(modules: PartnerModule[]) {
  const map = new Map<string, PartnerModule>();
  for (const mod of modules) {
    const problems = validateManifest(mod.manifest);
    if (problems.length)
      throw new Error(`Partner ${mod.manifest.id} refused: ${problems.join(", ")}`);
    if (map.has(mod.manifest.id))
      throw new Error(`Duplicate partner ${mod.manifest.id}`);
    map.set(mod.manifest.id, mod);
  }
  return map;
}

const modules = build([sandboxPartner, paypalPartner]);

export function partnerModule(id: string): PartnerModule {
  const mod = modules.get(id);
  if (!mod) throw new PortalError("PARTNER_UNKNOWN", 404);
  if (mod.manifest.sandboxOnly && !sandboxSimulation())
    throw new PortalError("PARTNER_UNAVAILABLE", 404);
  return mod;
}

export function partnerManifests(): PartnerManifest[] {
  return [...modules.values()]
    .map((m) => m.manifest)
    .filter((m) => !m.sandboxOnly || sandboxSimulation());
}

// Exposed for tests of the registration rules.
export const buildRegistry = build;
