// Execution through a PayRouta platform account on behalf of a Live merchant.
// The provider collects the payment into the merchant's sub-account and
// PayRouta's fee is withheld at source; PayRouta never sees card details.
import { db } from "../portal/db";
import { PortalError } from "../portal/domain";
import type { ExecutionAdapter } from "../payments/execution";
import type { PaymentIntent } from "../generated/prisma/client";
import { calculateFee } from "../payments/pricing";
import type { ExecutableMethod } from "../partners/contract";
import { currencyExponent } from "../partners/money";
import { requireFundsAccess } from "./merchant-account";
import { platformAdapter, platformModule } from "./platforms/registry";
import { readVerificationDetails } from "./verification";

type Binding = { adapter?: string; mode?: string; platformAccountId?: string; linkId?: string };

function origin() {
  const value = process.env.BETTER_AUTH_URL;
  if (!value) throw new PortalError("PORTAL_ORIGIN_NOT_CONFIGURED", 503);
  return new URL(value).origin;
}

// PayRouta's fee for this payment, in the payment's own minor units. A fee
// that cannot be withheld in the payment currency is refused, never
// converted.
export function withheldFee(intent: Pick<PaymentIntent, "feeSnapshot" | "selectedMethod" | "amount" | "precision" | "asset">) {
  const currency = (intent.asset as { identifier?: string }).identifier ?? "";
  const fee = calculateFee(intent.feeSnapshot, intent.selectedMethod!, intent.amount, intent.precision);
  if (fee.amountMinor === "0") return 0n;
  if (fee.currency !== currency || fee.precision !== currencyExponent(currency))
    throw new PortalError("PLATFORM_FEE_CURRENCY_MISMATCH", 409);
  return BigInt(fee.amountMinor);
}

export function platformExecutionAdapter(integration: {
  orgId: string;
  environment: string;
  config: unknown;
}): ExecutionAdapter {
  const binding = (integration.config ?? {}) as Binding;
  if (binding.mode !== "PLATFORM" || !binding.adapter || !binding.platformAccountId || !binding.linkId)
    throw new PortalError("EXECUTION_ADAPTER_NOT_QUALIFIED", 409);

  async function context(operation: "pay-in" | "refund" = "pay-in") {
    const link = await db.merchantPlatformLink.findUnique({ where: { id: binding.linkId } });
    if (
      !link ||
      link.orgId !== integration.orgId ||
      link.environment !== integration.environment ||
      link.platformAccountId !== binding.platformAccountId ||
      link.state !== "Approved" ||
      !link.paymentsEnabled ||
      !link.providerAccountId
    )
      throw new PortalError("PLATFORM_SUB_ACCOUNT_NOT_APPROVED", 409);
    const { platform } = await requireFundsAccess(db, {
      orgId: integration.orgId,
      environment: integration.environment,
      platformAccountId: link.platformAccountId,
      operation,
    });
    if (platform.provider !== binding.adapter)
      throw new PortalError("EXECUTION_INTEGRATION_SCOPE_MISMATCH", 409);
    return {
      adapter: platformAdapter(platform),
      manifest: platformModule(platform.provider).manifest,
      providerAccountId: link.providerAccountId,
      link,
    };
  }

  async function create(attempt: { key: string }, intent: PaymentIntent) {
    const asset = intent.asset as { kind?: string; identifier?: string };
    if (asset.kind !== "fiat" || !asset.identifier || !intent.selectedMethod)
      return { state: "Rejected", reference: "" };
    const { adapter, manifest, providerAccountId, link } = await context();
    const trusted = await db.availabilityContext.findUnique({ where: { id: intent.contextId } });
    const countries = (trusted?.context ?? {}) as { payerCountry?: string; merchantCountry?: string };
    // Pay-by-bank names the merchant's own verified account as recipient.
    let recipient;
    if (manifest.needsPayoutAccount) {
      const details = link.detailsVersion
        ? await db.merchantVerificationDetails.findUnique({
            where: { orgId_version: { orgId: link.orgId, version: link.detailsVersion } },
          })
        : null;
      if (!details) throw new PortalError("VERIFICATION_DETAILS_REQUIRED", 409);
      const bank = (await readVerificationDetails(details.secretRef)).payoutAccount;
      recipient = {
        name: bank.holderName,
        accountNumber: bank.accountNumber,
        routingNumber: bank.routingNumber,
        country: bank.country,
      };
    }
    if (!manifest.methods.includes(intent.selectedMethod as ExecutableMethod))
      return { state: "Rejected", reference: "" };
    const session = await db.checkoutSession.findFirst({
      where: { intentId: intent.id, revokedAt: null },
      orderBy: { expiresAt: "desc" },
    });
    const back = new URL(session ? `/checkout/${session.id}` : "/checkout", origin());
    const returnUrl = new URL(back);
    returnUrl.searchParams.set("returned", "1");
    const result = await adapter
      .createPayment({
        providerAccountId,
        attemptKey: attempt.key,
        amount: intent.amount,
        precision: intent.precision,
        currency: asset.identifier,
        method: intent.selectedMethod as ExecutableMethod,
        // Pay-by-bank rails pay the merchant in full; the fee is invoiced.
        feeMinor: manifest.feeCollection === "withheld" ? withheldFee(intent) : 0n,
        reference: intent.reference,
        payerCountry: countries.payerCountry,
        merchantCountry: countries.merchantCountry,
        recipient,
        payerEmail: (() => {
          const email = (intent.metadata as Record<string, unknown> | null)?.payer_email;
          return typeof email === "string" ? email : undefined;
        })(),
        returnUrl: returnUrl.toString(),
        cancelUrl: back.toString(),
      })
      .catch((error) => {
        // A refusal before any obligation exists lets the next route be tried.
        if (error instanceof PortalError && error.status === 422)
          return { state: "Rejected" as const, reference: "" };
        throw error;
      });
    return {
      state: result.state,
      reference: result.reference,
      ...(result.state === "Requires action"
        ? {
            action: result.actionUrl
              ? { kind: "redirect", url: result.actionUrl, provider: "PayRouta", text: "Continue to secure card payment." }
              : manifest.sandboxOnly && integration.environment === "sandbox"
                ? { kind: "sandbox", provider: manifest.name, text: `Fictional ${manifest.name} payment. Complete the sandbox authorization below.` }
                : (() => { throw new PortalError("PROVIDER_CUSTOMER_ACTION_REQUIRED", 502); })(),
          }
        : {}),
    };
  }

  return {
    operations: ["create-payment", "payment-status"],
    create: (attempt, intent) => create(attempt, intent),
    async status(attempt) {
      let reference = attempt.providerReference;
      if (!reference) {
        // Replaying creation with the same idempotency key returns the
        // original provider payment.
        const intent = await db.paymentIntent.findUniqueOrThrow({ where: { id: attempt.intentId } });
        const replay = await create(attempt, intent);
        if (!replay.reference) return null;
        reference = replay.reference;
      }
      // Status reads stay possible for restricted merchants so in-flight
      // payments still resolve.
      const { adapter, providerAccountId } = await context("refund");
      const s = await adapter.paymentStatus({ reference, providerAccountId });
      if (!s) return null;
      return {
        state: s.state,
        reference: s.reference,
        amount: s.amount,
        asset: { kind: "fiat", identifier: s.currency, network: "" },
      };
    },
  };
}
