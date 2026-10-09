// Execution through a merchant-owned partner account. The integration is the
// binding created when the merchant's partner application was approved; the
// payment runs on the merchant's own account at the partner, which collects
// and settles the funds. PayRouta only creates the payment, redirects the
// customer, and reads status back.
import { db } from "../portal/db";
import { PortalError } from "../portal/domain";
import { adapterFor } from "../partners/service";
import type { ExecutableMethod } from "../partners/contract";
import type { ExecutionAdapter } from "./execution";

type Binding = {
  adapter?: string;
  mode?: string;
  partnerApplicationId?: string;
};

function origin() {
  const value = process.env.BETTER_AUTH_URL;
  if (!value) throw new PortalError("PORTAL_ORIGIN_NOT_CONFIGURED", 503);
  return new URL(value).origin;
}

export function partnerExecutionAdapter(integration: {
  orgId: string;
  environment: string;
  config: unknown;
}): ExecutionAdapter {
  const binding = (integration.config ?? {}) as Binding;
  if (binding.mode !== "PARTNER" || !binding.adapter || !binding.partnerApplicationId)
    throw new PortalError("EXECUTION_ADAPTER_NOT_QUALIFIED", 409);

  async function account() {
    const app = await db.partnerApplication.findUnique({
      where: { id: binding.partnerApplicationId },
    });
    if (
      !app ||
      app.orgId !== integration.orgId ||
      app.environment !== integration.environment ||
      app.partnerId !== binding.adapter ||
      app.state !== "Approved" ||
      !app.paymentsEnabled ||
      !app.accountRef
    )
      throw new PortalError("PARTNER_ACCOUNT_NOT_APPROVED", 409);
    const adapter = await adapterFor(app.partnerId, integration.environment as "sandbox" | "production");
    if (!adapter.payments) throw new PortalError("EXECUTION_ADAPTER_NOT_QUALIFIED", 409);
    return {
      payments: adapter.payments,
      name: adapter.manifest.name,
      account: { accountRef: app.accountRef, providerAccountId: app.providerAccountId ?? undefined },
    };
  }

  async function create(attempt: { key: string; environment: string; intentId: string }, intent: {
    id: string;
    reference: string;
    amount: string;
    precision: number;
    asset: unknown;
    selectedMethod: string | null;
    metadata?: unknown;
  }) {
    const asset = intent.asset as { kind?: string; identifier?: string };
    if (asset.kind !== "fiat" || !asset.identifier || !intent.selectedMethod)
      return { state: "Rejected", reference: "" };
    const { payments, name, account: acct } = await account();
    if (!payments.methods.includes(intent.selectedMethod as ExecutableMethod))
      return { state: "Rejected", reference: "" };
    // The customer returns to the PayRouta checkout page for this intent.
    const session = await db.checkoutSession.findFirst({
      where: { intentId: intent.id, revokedAt: null },
      orderBy: { expiresAt: "desc" },
    });
    const back = new URL(session ? `/checkout/${session.id}` : "/checkout", origin());
    const returnUrl = new URL(back);
    returnUrl.searchParams.set("returned", "1");
    const result = await payments
      .create({
        account: acct,
        attemptKey: attempt.key,
        amount: intent.amount,
        precision: intent.precision,
        currency: asset.identifier,
        method: intent.selectedMethod as ExecutableMethod,
        customerReference: typeof (intent.metadata as Record<string, unknown> | null)?.stripe_customer_id === "string" ? (intent.metadata as Record<string, string>).stripe_customer_id : undefined,
        paymentHint: (() => {
          const m = intent.metadata as Record<string, unknown> | null;
          const hint = m?.preferred_wallet ?? m?.payment_rail;
          return typeof hint === "string" ? hint : undefined;
        })(),
        reference: intent.reference,
        returnUrl: returnUrl.toString(),
        cancelUrl: back.toString(),
      })
      .catch((error) => {
        // A provider refusing a well-formed request before any obligation
        // exists is a definite rejection; the next account may be tried.
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
              ? { kind: "redirect", url: result.actionUrl, provider: name, text: `Continue to ${name} to pay.` }
              : binding.adapter === "sandbox" && integration.environment === "sandbox"
                ? { kind: "sandbox", provider: name, text: `Fictional ${name} payment. Complete the sandbox authorization below.` }
                : (() => { throw new PortalError("PROVIDER_CUSTOMER_ACTION_REQUIRED", 502); })(),
          }
        : {}),
    };
  }

  return {
    operations: ["create-payment", "payment-status"],
    create: (attempt, intent) => create({ ...attempt, intentId: intent.id }, intent),
    async status(attempt) {
      let reference = attempt.providerReference;
      if (!reference) {
        // Recover the reference by replaying creation with the same
        // idempotency key: the partner returns the original payment.
        const intent = await db.paymentIntent.findUniqueOrThrow({ where: { id: attempt.intentId } });
        const replay = await create({ ...attempt, intentId: intent.id }, intent);
        if (!replay.reference) return null;
        reference = replay.reference;
      }
      const { payments, account: acct } = await account();
      const s = await payments.status({ account: acct, reference });
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
