// Stripe Connect on PayRouta's platform account ("Custom"-equivalent
// connected accounts). Merchants never see Stripe: PayRouta collects every
// requirement in its own onboarding and sends it by API (no Stripe-hosted
// pages, no Stripe Dashboard), records their acceptance of PayRouta's terms
// (which incorporate the Stripe Connected Account Agreement), pays Stripe's
// fees and bears negative balances. Payments are destination charges on
// behalf of the connected account, with PayRouta's fee as the application
// fee; payouts are manual so PayRouta's reserve and payout schedule apply.
//
// Verified with injected transports only; run it against Stripe test mode
// before qualifying the sandbox platform account.
import { z } from "zod";
import { PortalError } from "../../portal/domain";
import type { PartnerDeps } from "../../partners/contract";
import { assertPaymentHost, parseJson, providerFailure } from "../../partners/contract";
import { fromMinorUnits, toMinorUnits } from "../../partners/money";
import type { KybProfile } from "../../partners/kyb";
import { formEncode, stripeSnapshot, verifyStripeSignature } from "../../partners/adapters/stripe-connect";
import type { StatusSnapshot } from "../../partners/contract";
import type { VerificationDetails } from "../verification";
import type {
  DisputeSnapshot,
  PayoutState,
  PlatformAdapter,
  PlatformManifest,
  PlatformModule,
  RefundState,
} from "./contract";

export const stripeCustomManifest: PlatformManifest = {
  id: "stripe-custom",
  name: "Stripe",
  custody: "partner-held",
  holdsFunds: true,
  merchantBearsProcessingFee: false,
  feeCollection: "withheld",
  merchantCountries: null,
  // Apple Pay and Google Pay appear inside Stripe Checkout's card option.
  methods: ["card"],
  sharedFields: [
    "legalName",
    "tradingName",
    "businessType",
    "country",
    "website",
    "productDescription",
    "supportEmail",
    "address",
    "representative",
  ],
  paymentHosts: ["checkout.stripe.com"],
  documentation: "https://docs.stripe.com/connect/destination-charges",
};

const configSchema = z
  .object({
    environment: z.enum(["sandbox", "production"]),
    baseUrl: z.literal("https://api.stripe.com").default("https://api.stripe.com"),
    apiVersion: z.string().regex(/^\d{4}-\d{2}-\d{2}(\.\w+)?$/).default("2024-06-20"),
    secretKeyRef: z.string().max(100).optional(),
    // Stripe signs platform events and Connect (connected-account) events
    // with separate endpoint secrets.
    webhookSecretRef: z.string().max(100).optional(),
    connectWebhookSecretRef: z.string().max(100).optional(),
    timeoutMs: z.number().int().min(500).max(15000).default(8000),
  })
  .strict();

const accountId = /^acct_\w{1,64}$/;
const sessionId = /^cs_\w{1,200}$/;

// Stripe's requirement paths → what PayRouta asks the merchant for. Codes
// arrive normalised by stripeSnapshot (lowercase, [a-z0-9._-]).
export function payrouteRequirement(code: string) {
  if (code.includes("external_account")) return "payout-account";
  if (code.includes("tos_acceptance")) return "terms-acceptance";
  if (/verification\.(additional_)?document/.test(code))
    return code.startsWith("company.") ? "business-document" : "identity-document";
  if (/^(company|business_profile|business_type)/.test(code)) return "business-details";
  if (/^(individual|representative)/.test(code)) return "representative-details";
  if (/^(person_|owners)/.test(code)) return "owner-details";
  if (/^(directors|executives)/.test(code)) return "director-details";
  return "review";
}

export function payrouteSnapshot(account: Record<string, unknown>): StatusSnapshot {
  const s = stripeSnapshot(account);
  return { ...s, requirementsDue: [...new Set(s.requirementsDue.map(payrouteRequirement))] };
}

const businessType = {
  company: "company",
  partnership: "company",
  "sole-proprietor": "individual",
  "non-profit": "non_profit",
} as const;

function stripeAddress(a: VerificationDetails["representative"]["address"] | KybProfile["address"] | undefined) {
  return (
    a && {
      line1: a.line1,
      line2: a.line2,
      city: a.city,
      state: a.region,
      postal_code: a.postalCode,
      country: a.country,
    }
  );
}

function dob(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return { day, month, year };
}

type PersonInput = VerificationDetails["representative"] & { givenName: string; familyName: string };
export function stripePerson(p: PersonInput, relationship: Record<string, unknown>) {
  return {
    first_name: p.givenName,
    last_name: p.familyName,
    email: p.email,
    phone: p.phone,
    dob: dob(p.dateOfBirth),
    address: stripeAddress(p.address),
    id_number: p.idNumber,
    relationship,
  };
}

export function stripeCustomAccountBody(
  linkId: string,
  p: Partial<KybProfile>,
  d: VerificationDetails,
  agreement: { acceptedAt: Date; ip: string; userAgent: string },
) {
  const type = p.businessType ? businessType[p.businessType] : undefined;
  const rep = { ...d.representative, givenName: p.representative?.givenName ?? "", familyName: p.representative?.familyName ?? "" };
  return {
    controller: {
      stripe_dashboard: { type: "none" },
      fees: { payer: "application" },
      losses: { payments: "application" },
      requirement_collection: "application",
    },
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
    },
    country: p.country,
    email: p.representative?.email,
    business_type: type,
    business_profile: {
      name: p.tradingName ?? p.legalName,
      url: p.website,
      product_description: p.productDescription,
      support_email: p.supportEmail,
      support_phone: d.businessPhone,
    },
    ...(type === "individual"
      ? {
          individual: {
            ...stripePerson(rep, {}),
            email: rep.email ?? p.representative?.email,
            relationship: undefined,
          },
        }
      : {
          company: {
            name: p.legalName,
            tax_id: p.taxId ?? p.registrationNumber,
            registration_number: p.taxId ? p.registrationNumber : undefined,
            address: stripeAddress(p.address),
            phone: d.businessPhone,
          },
        }),
    external_account: {
      object: "bank_account",
      country: d.payoutAccount.country,
      currency: d.payoutAccount.currency.toLowerCase(),
      account_holder_name: d.payoutAccount.holderName,
      account_holder_type: d.payoutAccount.holderType,
      account_number: d.payoutAccount.accountNumber,
      routing_number: d.payoutAccount.routingNumber,
    },
    tos_acceptance: {
      date: Math.floor(agreement.acceptedAt.getTime() / 1000),
      ip: agreement.ip,
      user_agent: agreement.userAgent,
      service_agreement: "full",
    },
    settings: { payouts: { schedule: { interval: "manual" } } },
    metadata: { payrouta_link: linkId },
  };
}

export function stripeDestinationCheckout(input: {
  providerAccountId: string;
  attemptKey: string;
  currency: string;
  amountMinor: bigint;
  feeMinor: bigint;
  reference: string;
  returnUrl: string;
  cancelUrl: string;
  nowSeconds: number;
}) {
  return {
    mode: "payment",
    payment_method_types: ["card"],
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: input.currency.toLowerCase(),
          unit_amount: input.amountMinor.toString(),
          product_data: { name: `Payment ${input.reference}`.slice(0, 250) },
        },
      },
    ],
    success_url: input.returnUrl,
    cancel_url: input.cancelUrl,
    client_reference_id: input.attemptKey.slice(0, 200),
    expires_at: input.nowSeconds + 1860,
    metadata: { payrouta_attempt: input.attemptKey },
    payment_intent_data: {
      // The connected account is the settlement merchant (its name on the
      // customer's statement); PayRouta keeps the application fee.
      on_behalf_of: input.providerAccountId,
      transfer_data: { destination: input.providerAccountId },
      ...(input.feeMinor > 0n
        ? { application_fee_amount: input.feeMinor.toString() }
        : {}),
      metadata: { payrouta_attempt: input.attemptKey },
    },
  };
}

function create(raw: unknown, deps: PartnerDeps): PlatformAdapter {
  const c = configSchema.parse(raw);
  const now = () => deps.now?.() ?? new Date();
  async function key() {
    const secret = c.secretKeyRef ? await deps.credentials.get(c.secretKeyRef) : "";
    if (!secret) throw new PortalError("STRIPE_CREDENTIALS_NOT_CONFIGURED", 409);
    // A test key can never act on production merchants, or the reverse.
    const mode = c.environment === "production" ? "live" : "test";
    if (!new RegExp(`^(sk|rk)_${mode}_`).test(secret))
      throw new PortalError("STRIPE_KEY_ENVIRONMENT_MISMATCH", 409);
    return secret;
  }
  async function call(
    method: "GET" | "POST",
    path: string,
    form?: unknown,
    idempotencyKey?: string,
    account?: string,
  ) {
    const response = await deps.http(c.baseUrl, {
      method,
      path,
      headers: {
        Authorization: `Bearer ${await key()}`,
        "Stripe-Version": c.apiVersion,
        ...(account ? { "Stripe-Account": account } : {}),
        ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: form ? formEncode(form).join("&") : undefined,
      timeoutMs: c.timeoutMs,
    });
    if (response.status < 200 || response.status >= 300)
      providerFailure("STRIPE", response.status);
    return parseJson(response.body);
  }
  const connected = (id: string) => {
    if (!accountId.test(id)) throw new PortalError("PLATFORM_ACCOUNT_UNKNOWN", 404);
    return id;
  };
  async function session(reference: string) {
    if (!sessionId.test(reference)) return null;
    return call(
      "GET",
      `/v1/checkout/sessions/${reference}?expand[]=payment_intent.latest_charge`,
    );
  }
  return {
    async createAccount(input) {
      if (input.environment !== c.environment)
        throw new PortalError("PLATFORM_ENVIRONMENT_MISMATCH", 409);
      const key = `payrouta-platform-${input.linkId}`;
      const account = await call(
        "POST",
        "/v1/accounts",
        stripeCustomAccountBody(input.linkId, input.profile, input.details, input.agreement),
        key,
      );
      if (typeof account.id !== "string" || !accountId.test(account.id))
        throw new PortalError("PLATFORM_RESPONSE_INVALID", 502);
      if (account.business_type === "individual")
        return { providerAccountId: account.id, snapshot: payrouteSnapshot(account) };
      // Companies: the representative and every 25%+ owner as persons, then
      // confirm to Stripe that the lists are complete. Each call has its own
      // idempotency key so a retried job resumes without duplicates.
      const p = input.profile;
      const rep = p.representative!;
      await call(
        "POST",
        `/v1/accounts/${account.id}/persons`,
        stripePerson(
          { ...input.details.representative, email: input.details.representative.email ?? rep.email, givenName: rep.givenName, familyName: rep.familyName },
          { representative: true, executive: true, title: rep.title },
        ),
        `${key}-representative`,
      );
      for (const [i, owner] of (p.owners ?? []).entries())
        await call(
          "POST",
          `/v1/accounts/${account.id}/persons`,
          stripePerson(
            { ...input.details.owners[i], givenName: owner.givenName, familyName: owner.familyName },
            { owner: true, percent_ownership: owner.ownershipPercent },
          ),
          `${key}-owner-${i}`,
        );
      const done = await call(
        "POST",
        `/v1/accounts/${account.id}`,
        { company: { owners_provided: true, executives_provided: true } },
        `${key}-attested`,
      );
      return { providerAccountId: account.id, snapshot: payrouteSnapshot(done) };
    },
    async accountStatus(id) {
      return payrouteSnapshot(await call("GET", `/v1/accounts/${connected(id)}`));
    },
    async createPayment(input) {
      const minor = toMinorUnits(input.amount, input.precision, input.currency);
      if (minor === null || input.method !== "card" || input.feeMinor >= minor)
        return { state: "Rejected", reference: "" };
      const s = await call(
        "POST",
        "/v1/checkout/sessions",
        stripeDestinationCheckout({
          providerAccountId: connected(input.providerAccountId),
          attemptKey: input.attemptKey,
          currency: input.currency,
          amountMinor: minor,
          feeMinor: input.feeMinor,
          reference: input.reference,
          returnUrl: input.returnUrl,
          cancelUrl: input.cancelUrl,
          nowSeconds: Math.floor(now().getTime() / 1000),
        }),
        `payrouta-${input.attemptKey}`,
      );
      if (typeof s.id !== "string" || !sessionId.test(s.id) || typeof s.url !== "string")
        throw new PortalError("PLATFORM_RESPONSE_INVALID", 502);
      return {
        state: "Requires action",
        reference: s.id,
        actionUrl: assertPaymentHost(stripeCustomManifest.paymentHosts, s.url),
      };
    },
    async paymentStatus(input) {
      const s = await session(input.reference);
      if (!s) return null;
      const intent = (s.payment_intent ?? {}) as Record<string, unknown>;
      const destination = (intent.transfer_data as { destination?: unknown } | null)?.destination;
      // A session that pays anyone but this merchant is never our payment.
      if (s.payment_intent && destination !== connected(input.providerAccountId))
        throw new PortalError("PLATFORM_DESTINATION_MISMATCH", 409);
      const currency = typeof s.currency === "string" ? s.currency.toUpperCase() : "";
      const amount =
        typeof s.amount_total === "number" ? fromMinorUnits(s.amount_total, currency) : null;
      if (!amount) throw new PortalError("PLATFORM_RESPONSE_INVALID", 502);
      const state =
        s.status === "complete" && s.payment_status === "paid"
          ? "Confirmed"
          : s.status === "expired"
            ? "Rejected"
            : s.status === "complete"
              ? "Pending"
              : "Requires action";
      return { state, reference: input.reference, amount, currency };
    },
    async createPayout(input) {
      const p = await call(
        "POST",
        "/v1/payouts",
        {
          amount: input.amountMinor.toString(),
          currency: input.currency.toLowerCase(),
          // Merchants see PayRouta on their bank statement, never Stripe.
          statement_descriptor: "PAYROUTA",
          metadata: { payrouta_payout: input.payoutId },
        },
        `payrouta-payout-${input.payoutId}`,
        connected(input.providerAccountId),
      );
      if (typeof p.id !== "string" || !/^po_\w{1,100}$/.test(p.id)) throw new PortalError("PLATFORM_RESPONSE_INVALID", 502);
      return { reference: p.id, ...stripePayoutState(p) };
    },
    async payoutStatus(input) {
      if (!/^po_\w{1,100}$/.test(input.reference)) return null;
      return stripePayoutState(
        await call("GET", `/v1/payouts/${input.reference}`, undefined, undefined, connected(input.providerAccountId)),
      );
    },
    async verifyEvent({ rawBody, headers }) {
      const header = headers.get("stripe-signature") || "";
      let verified = false;
      for (const ref of [c.webhookSecretRef, c.connectWebhookSecretRef])
        if (ref && !verified) {
          const secret = await deps.credentials.get(ref);
          verified = Boolean(secret) && verifyStripeSignature(secret, rawBody, header, now());
        }
      if (!verified) return null;
      const event = parseJson(rawBody);
      const type = typeof event.type === "string" ? event.type.slice(0, 100) : "";
      if (typeof event.id !== "string" || !/^evt_\w{1,100}$/.test(event.id) || !type) return null;
      // Refuse events from the other mode.
      if ((event.livemode === true) !== (c.environment === "production")) return null;
      const object = ((event.data as { object?: Record<string, unknown> } | undefined)?.object ?? {}) as Record<string, unknown>;
      const id = typeof object.id === "string" ? object.id : undefined;
      const account = typeof event.account === "string" ? event.account : undefined;
      const kind = /^(account|capability|person)\./.test(type)
        ? "account"
        : type.startsWith("checkout.session.")
          ? "payment"
          : type.startsWith("payout.")
            ? "payout"
            : type.startsWith("charge.dispute.")
              ? "dispute"
              : type === "charge.refund.updated" || type.startsWith("refund.")
                ? "refund"
                : "other";
      return {
        eventId: event.id,
        type,
        kind,
        accountRef: account ?? (type.startsWith("account.") ? id : undefined),
        objectRef: kind === "account" || kind === "other" ? undefined : id,
      };
    },
    async createRefund(input) {
      // Prefer the charge; before its funds are available only the session
      // is known, so resolve its PaymentIntent.
      let target: Record<string, string>;
      if (input.paymentRef && /^(ch|py)_\w{1,100}$/.test(input.paymentRef)) target = { charge: input.paymentRef };
      else {
        const s = await session(input.reference);
        const intent = (s?.payment_intent ?? {}) as { id?: unknown };
        if (typeof intent.id !== "string") throw new PortalError("REFUND_PAYMENT_NOT_FOUND", 422);
        target = { payment_intent: intent.id };
      }
      const r = await call(
        "POST",
        "/v1/refunds",
        {
          ...target,
          amount: input.amountMinor.toString(),
          // Taken back from the merchant's connected account; PayRouta keeps
          // its application fee.
          reverse_transfer: true,
          refund_application_fee: false,
          metadata: { payrouta_refund: input.refundId },
        },
        `payrouta-refund-${input.refundId}`,
      );
      if (typeof r.id !== "string" || !/^re_\w{1,100}$/.test(r.id)) throw new PortalError("PLATFORM_RESPONSE_INVALID", 502);
      return { reference: r.id, ...stripeRefundState(r) };
    },
    async refundStatus(input) {
      if (!/^re_\w{1,100}$/.test(input.reference)) return null;
      return stripeRefundState(await call("GET", `/v1/refunds/${input.reference}`));
    },
    async disputeStatus(input) {
      if (!/^(du|dp)_\w{1,100}$/.test(input.reference)) return null;
      return stripeDispute(await call("GET", `/v1/disputes/${input.reference}`));
    },
    async submitDisputeEvidence(input) {
      if (!/^(du|dp)_\w{1,100}$/.test(input.reference)) throw new PortalError("DISPUTE_UNKNOWN", 404);
      const e = input.evidence;
      await call(
        "POST",
        `/v1/disputes/${input.reference}`,
        {
          evidence: {
            product_description: e.productDescription,
            customer_name: e.customerName,
            customer_email_address: e.customerEmail,
            service_date: e.serviceDate,
            shipping_carrier: e.shippingCarrier,
            shipping_tracking_number: e.shippingTrackingNumber,
            shipping_date: e.shippingDate,
            shipping_address: e.deliveryAddress,
            refund_policy_disclosure: e.refundPolicy,
            uncategorized_text: e.explanation,
          },
          // Submitting tells Stripe to send it to the card network now.
          submit: true,
          metadata: { payrouta_dispute: input.disputeId },
        },
        `payrouta-dispute-evidence-${input.disputeId}`,
      );
    },
    async holdDisputeFunds(input) {
      if (!/^tr_\w{1,100}$/.test(input.transferRef)) throw new PortalError("PLATFORM_TRANSFER_UNKNOWN", 409);
      await call(
        "POST",
        `/v1/transfers/${input.transferRef}/reversals`,
        { amount: input.amountMinor.toString(), metadata: { payrouta_dispute: input.disputeId } },
        `payrouta-dispute-hold-${input.disputeId}`,
      );
    },
    async releaseDisputeFunds(input) {
      await call(
        "POST",
        "/v1/transfers",
        {
          amount: input.amountMinor.toString(),
          currency: input.currency.toLowerCase(),
          destination: connected(input.providerAccountId),
          metadata: { payrouta_dispute: input.disputeId },
        },
        `payrouta-dispute-release-${input.disputeId}`,
      );
    },
    async accountBalance(id) {
      const b = await call("GET", "/v1/balance", undefined, undefined, connected(id));
      const out: Record<string, bigint> = {};
      for (const list of [b.available, b.pending])
        for (const x of Array.isArray(list) ? (list as { amount?: unknown; currency?: unknown }[]) : [])
          if (typeof x.amount === "number" && typeof x.currency === "string") {
            const cur = x.currency.toUpperCase();
            out[cur] = (out[cur] ?? 0n) + BigInt(x.amount);
          }
      return out;
    },
    async fundsAvailability(input) {
      const s = await session(input.reference);
      const charge = ((s?.payment_intent as Record<string, unknown> | undefined)
        ?.latest_charge ?? null) as Record<string, unknown> | null;
      if (!charge || typeof charge.id !== "string" || typeof charge.transfer !== "string")
        return null;
      const transfer = await call("GET", `/v1/transfers/${encodeURIComponent(charge.transfer)}`);
      const acct = connected(input.providerAccountId);
      if (transfer.destination !== acct || typeof transfer.destination_payment !== "string")
        throw new PortalError("PLATFORM_DESTINATION_MISMATCH", 409);
      // The merchant's share as it landed in the connected account.
      const payment = await call(
        "GET",
        `/v1/charges/${encodeURIComponent(transfer.destination_payment)}?expand[]=balance_transaction`,
        undefined,
        undefined,
        acct,
      );
      const balance = (payment.balance_transaction ?? {}) as Record<string, unknown>;
      if (typeof balance.available_on !== "number" || typeof transfer.amount !== "number")
        throw new PortalError("PLATFORM_RESPONSE_INVALID", 502);
      return {
        paymentRef: charge.id,
        transferRef: charge.transfer,
        netMinor: BigInt(transfer.amount),
        availableAt: new Date(balance.available_on * 1000),
      };
    },
  };
}

export function stripePayoutState(p: Record<string, unknown>): { state: PayoutState; failureCode?: string } {
  if (p.status === "paid") return { state: "Paid" };
  if (p.status === "failed" || p.status === "canceled")
    return { state: "Failed", failureCode: typeof p.failure_code === "string" ? p.failure_code : String(p.status) };
  return { state: "In transit" };
}

export function stripeRefundState(r: Record<string, unknown>): { state: RefundState; failureCode?: string } {
  if (r.status === "succeeded") return { state: "Succeeded" };
  if (r.status === "failed" || r.status === "canceled")
    return { state: "Failed", failureCode: typeof r.failure_reason === "string" ? r.failure_reason : String(r.status) };
  return { state: "Pending" };
}

export function stripeDispute(d: Record<string, unknown>): DisputeSnapshot {
  if (typeof d.id !== "string" || typeof d.amount !== "number" || typeof d.currency !== "string")
    throw new PortalError("PLATFORM_RESPONSE_INVALID", 502);
  // The fee Stripe charged when funds were withdrawn for the dispute.
  const fee = (Array.isArray(d.balance_transactions) ? (d.balance_transactions as { amount?: number; fee?: number }[]) : [])
    .filter((t) => (t.amount ?? 0) < 0)
    .reduce((n, t) => n + BigInt(t.fee ?? 0), 0n);
  const due = (d.evidence_details as { due_by?: unknown } | undefined)?.due_by;
  return {
    reference: d.id,
    // An inquiry closed without a chargeback costs the merchant nothing.
    state: d.status === "won" || d.status === "warning_closed" ? "Won" : d.status === "lost" ? "Lost" : "Open",
    amountMinor: BigInt(d.amount),
    currency: d.currency.toUpperCase(),
    feeMinor: fee,
    paymentRef: typeof d.charge === "string" ? d.charge : undefined,
    reason: typeof d.reason === "string" ? d.reason : undefined,
    evidenceDueBy: typeof due === "number" ? new Date(due * 1000) : undefined,
  };
}

export const stripeCustomPlatform: PlatformModule = {
  manifest: stripeCustomManifest,
  configSchema,
  create,
};
