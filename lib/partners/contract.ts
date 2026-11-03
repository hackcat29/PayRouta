// Partner onboarding contract.
//
// A "partner" is a payment provider with a programme that lets PayRouta create
// or pre-fill an account that the MERCHANT owns (PayPal Partner Referrals,
// Mollie Client Links, ...).
// PayRouta never becomes the provider's merchant of record on these accounts:
// the manifest's ownership attestation is checked when a module is registered,
// and a module that would make PayRouta a payment facilitator is refused here.
// Aggregator programmes are PlatformAccounts instead (lib/treasury).
//
// Adding a partner means one module under ./adapters implementing
// PartnerModule, one line in ./registry, and passing ./conformance.
import { z } from "zod";
import { supportedPaymentMethodIds } from "../providers/normalized";
import type { PaymentMethodId } from "../providers/normalized";
import type { ProviderHttpOptions } from "../providers/adapters/http";
import type { KybField } from "./kyb";
import { PortalError } from "../portal/domain";

// The five questions a partner programme must answer "yes" to for the account
// to be merchant-owned. Recorded in each manifest and shown to reviewers.
export interface OwnershipAttestation {
  merchantContractsDirectly: boolean;
  merchantHasOwnLogin: boolean;
  lossesBorneBy: "merchant" | "provider" | "platform";
  settlesToMerchant: boolean;
  portableOnExit: boolean;
}

export function merchantOwned(o: OwnershipAttestation) {
  return (
    o.merchantContractsDirectly &&
    o.merchantHasOwnLogin &&
    o.lossesBorneBy !== "platform" &&
    o.settlesToMerchant &&
    o.portableOnExit
  );
}

export interface PartnerManifest {
  id: string;
  name: string;
  contractVersion: 1;
  ownership: OwnershipAttestation;
  // How the merchant completes onboarding at the provider.
  onboarding: "api-prefill" | "hosted-link" | "oauth";
  methods: readonly PaymentMethodId[];
  // null: the provider decides eligibility during its own onboarding.
  merchantCountries: readonly string[] | null;
  // Exactly the KYB fields this module may send. Consent is collected for this
  // list and the profile is projected onto it before any request is built.
  sharedFields: readonly KybField[];
  // Hosts a returned onboarding link may point to. Anything else is refused,
  // so a compromised or misconfigured response can never redirect a merchant
  // to an arbitrary site.
  linkHosts: readonly string[];
  // Programmes that require PayRouta to be an approved partner first.
  requiresPartnerApproval: boolean;
  documentation: string;
  // Sandbox-only modules never run outside local mode.
  sandboxOnly?: boolean;
  // Checkout methods this module can execute on the merchant's account.
  // Omitted when the module only onboards (no payment execution yet).
  paymentMethods?: readonly ExecutableMethod[];
}

export const partnerStates = [
  "Queued",
  "Pending provider",
  "Action required",
  "Under review",
  "Approved",
  "Restricted",
  "Rejected",
  "Disconnected",
  "Failed",
] as const;
export type PartnerState = (typeof partnerStates)[number];

// Normalized provider view of a merchant account. Adapters map provider
// fields into this shape; nothing provider-specific leaves the adapter.
export const statusSnapshot = z
  .object({
    state: z.enum([
      "Pending provider",
      "Action required",
      "Under review",
      "Approved",
      "Restricted",
      "Rejected",
    ]),
    providerAccountId: z.string().min(1).max(200).optional(),
    // Normalized, bounded requirement codes (never raw provider messages).
    requirementsDue: z
      .array(z.string().regex(/^[a-z0-9][a-z0-9._-]{0,79}$/))
      .max(50),
    paymentsEnabled: z.boolean(),
    payoutsEnabled: z.boolean(),
    reason: z.string().max(200).optional(),
  })
  .strict();
export type StatusSnapshot = z.infer<typeof statusSnapshot>;

// A verified provider event. Events are only a prompt to re-read status from
// the provider's authenticated API; their payload never changes state itself.
export interface PartnerEvent {
  eventId: string;
  type: string;
  accountRef?: string;
  providerAccountId?: string;
  // Provider object the event concerns (e.g. a checkout session or order).
  objectRef?: string;
}

export interface CreateAccountInput {
  applicationId: string;
  environment: "sandbox" | "production";
  // Already projected onto manifest.sharedFields.
  profile: Record<string, unknown>;
  returnUrl: string;
  refreshUrl: string;
}

// Payments on the merchant's own account at the partner. Amounts are exact
// decimal strings in major units; adapters convert with ./money and refuse
// any precision that does not match the currency.
export const executableMethods = supportedPaymentMethodIds;
export type ExecutableMethod = (typeof executableMethods)[number];

export interface PaymentAccount {
  accountRef: string;
  providerAccountId?: string;
}

export interface PartnerPayments {
  methods: readonly ExecutableMethod[];
  // Hosts a customer may be redirected to for payment.
  paymentHosts: readonly string[];
  // Must be idempotent on attemptKey: repeating it returns the same payment.
  create(input: {
    account: PaymentAccount;
    attemptKey: string;
    amount: string;
    precision: number;
    currency: string;
    method: ExecutableMethod;
    paymentHint?: string;
    customerReference?: string;
    reference: string;
    returnUrl: string;
    cancelUrl: string;
  }): Promise<{
    state: "Requires action" | "Pending" | "Rejected";
    reference: string;
    actionUrl?: string;
  }>;
  status(input: {
    account: PaymentAccount;
    reference: string;
  }): Promise<{
    state: "Requires action" | "Pending" | "Confirmed" | "Rejected";
    reference: string;
    amount: string;
    currency: string;
  } | null>;
}

export interface PartnerAdapter {
  manifest: PartnerManifest;
  payments?: PartnerPayments;
  createAccount(input: CreateAccountInput): Promise<{
    accountRef: string;
    snapshot: StatusSnapshot;
  }>;
  onboardingLink(input: {
    accountRef: string;
    applicationId: string;
    returnUrl: string;
    refreshUrl: string;
  }): Promise<{ url: string; expiresAt?: Date }>;
  status(input: {
    accountRef: string;
    providerAccountId?: string;
  }): Promise<StatusSnapshot>;
  // Returns null for anything that fails verification.
  verifyEvent(input: {
    rawBody: string;
    headers: Headers;
  }): Promise<PartnerEvent | null>;
}

export type PartnerHttp = (
  baseUrl: string,
  options: ProviderHttpOptions,
) => Promise<{ status: number; headers: Record<string, string>; body: string }>;

export interface PartnerDeps {
  http: PartnerHttp;
  credentials: { get(ref: string): Promise<string> };
  now?: () => Date;
}

export interface PartnerModule {
  manifest: PartnerManifest;
  // Non-secret configuration plus secret-manager references. Validated before
  // an adapter is built; secrets are resolved only at call time.
  configSchema: z.ZodType;
  create(config: unknown, deps: PartnerDeps): PartnerAdapter;
}

// Provider rejections of a well-formed request (4xx other than timeouts,
// conflicts and rate limits) are terminal and never retried; everything else
// is retryable by the worker.
export function providerFailure(prefix: string, status: number): never {
  if (status >= 400 && status < 500 && ![408, 409, 429].includes(status))
    throw new PortalError(`${prefix}_REQUEST_REJECTED`, 422);
  throw new PortalError(`${prefix}_UNAVAILABLE`, 503);
}

export function parseJson(body: string): Record<string, unknown> {
  try {
    const value = JSON.parse(body || "{}");
    return value && typeof value === "object" ? value : {};
  } catch {
    throw new PortalError("PARTNER_RESPONSE_INVALID", 502);
  }
}

// Payment redirects must stay on the partner's declared payment hosts.
export function assertPaymentHost(hosts: readonly string[], raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new PortalError("PARTNER_LINK_INVALID", 502);
  }
  if (url.protocol !== "https:" || url.username || url.password || !hosts.includes(url.host))
    throw new PortalError("PARTNER_LINK_HOST_NOT_ALLOWED", 502);
  return url.toString();
}

// Shared guard for every adapter-returned onboarding link.
export function assertLinkHost(
  manifest: Pick<PartnerManifest, "linkHosts" | "sandboxOnly">,
  raw: string,
) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new PortalError("PARTNER_LINK_INVALID", 502);
  }
  const loopback = manifest.sandboxOnly && url.hostname === "127.0.0.1";
  // The fictional sandbox partner "onboards" on PayRouta's own origin.
  let portalHost = "";
  try {
    portalHost = new URL(process.env.BETTER_AUTH_URL ?? "").host;
  } catch {}
  const hostAllowed =
    manifest.linkHosts.includes(url.host) ||
    (manifest.sandboxOnly === true && !!portalHost && url.host === portalHost);
  if (
    (url.protocol !== "https:" && !loopback) ||
    url.username ||
    url.password ||
    !hostAllowed
  )
    throw new PortalError("PARTNER_LINK_HOST_NOT_ALLOWED", 502);
  return url.toString();
}
