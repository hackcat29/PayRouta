// Fake provider transports for partner conformance. They model only the
// behaviour the adapters depend on; they are not recordings of real APIs.
import type { CapturedRequest, HarnessSetup, PartnerHarness } from "../../lib/partners/conformance";
import { signature } from "../../lib/payments/contracts";
import { sandboxPartner } from "../../lib/partners/adapters/sandbox";
import { paypalPartner } from "../../lib/partners/adapters/paypal";
import type { ProviderHttpOptions } from "../../lib/providers/adapters/http";

const NOW = new Date("2026-09-28T12:00:00Z");
const reply = (status: number, body: unknown) => ({
  status,
  headers: {},
  body: typeof body === "string" ? body : JSON.stringify(body),
});

function recorder(requests: CapturedRequest[], options: ProviderHttpOptions) {
  requests.push({
    method: options.method,
    path: options.path,
    headers: options.headers ?? {},
    body: options.body,
  });
}

export const sandboxHarness: PartnerHarness = {
  module: sandboxPartner,
  environment: "sandbox",
  config: { webhookSecretRef: "wh" },
  secrets: { wh: "sandbox-webhook-secret" },
  scenarios: ["approved", "action-required", "rejected"],
  setup(): HarnessSetup {
    const requests: CapturedRequest[] = [];
    return {
      requests,
      now: () => NOW,
      accounts: () => 0,
      async http() {
        throw new Error("The sandbox partner must never use the network");
      },
    };
  },
  profile: (scenario, base) =>
    scenario === "rejected" ? { ...base, legalName: `${base.legalName} [reject]` } : base,
  statusDelayMs: (scenario) => (scenario === "action-required" ? 0 : 120000),
  event(s, accountRef, tampered) {
    const rawBody = JSON.stringify({ type: "account.updated", accountRef });
    const ts = String(Math.floor(s.now().getTime() / 1000));
    const sig = signature("sandbox-webhook-secret", ts, "evt_sbx_1", rawBody);
    return {
      rawBody: tampered ? rawBody.replace("updated", "deleted") : rawBody,
      headers: new Headers({
        "payrouta-event-id": "evt_sbx_1",
        "payrouta-timestamp": ts,
        "payrouta-signature": sig,
      }),
    };
  },
};

export const paypalHarness: PartnerHarness = {
  module: paypalPartner,
  environment: "sandbox",
  config: {
    environment: "sandbox",
    clientIdRef: "cid",
    clientSecretRef: "cs",
    partnerMerchantId: "PARTNER123",
    webhookId: "WH-1234567890",
  },
  secrets: { cid: "client-id-conformance", cs: "client-secret-conformance" },
  paymentAccount: { accountRef: "app_1", providerAccountId: "MERCHANT1234" },
  scenarios: ["approved", "action-required", "garbled", "evil-link", "request-rejected", "unavailable"],
  paymentScenarios: ["approved", "action-required", "rejected"],
  setup(scenario): HarnessSetup {
    const requests: CapturedRequest[] = [];
    const referrals = new Set<string>();
    const orders = new Map<string, { id: string; value: string; currency: string }>();
    return {
      requests,
      now: () => NOW,
      accounts: () => referrals.size,
      async http(baseUrl, options) {
        recorder(requests, options);
        if (baseUrl !== "https://api-m.sandbox.paypal.com") return reply(404, {});
        if (scenario === "unavailable") return reply(503, {});
        if (options.path === "/v1/oauth2/token") return reply(200, { access_token: "A21-token", expires_in: 3600 });
        if (options.headers?.Authorization !== "Bearer A21-token") return reply(401, {});
        if (options.path === "/v2/customer/partner-referrals") {
          if (scenario === "request-rejected") return reply(400, { name: "INVALID_REQUEST" });
          referrals.add(JSON.parse(options.body ?? "{}").tracking_id);
          return reply(201, {
            links: [
              { rel: "self", href: "https://api-m.sandbox.paypal.com/v2/customer/partner-referrals/x" },
              {
                rel: "action_url",
                href: scenario === "evil-link" ? "https://paypal.evil.example/signup" : "https://www.sandbox.paypal.com/bizsignup/partner/entry?referralToken=x",
              },
            ],
          });
        }
        if (options.path.startsWith("/v1/customer/partners/PARTNER123/merchant-integrations?"))
          return scenario === "action-required" ? reply(404, {}) : reply(200, { merchant_id: "MERCHANT1234", tracking_id: "app" });
        if (options.path === "/v1/customer/partners/PARTNER123/merchant-integrations/MERCHANT1234")
          return scenario === "garbled"
            ? reply(200, { merchant_id: "MERCHANT1234" })
            : reply(200, {
                merchant_id: "MERCHANT1234",
                payments_receivable: true,
                primary_email_confirmed: true,
                oauth_integrations: [{ integration_type: "OAUTH_THIRD_PARTY" }],
              });
        if (options.path.startsWith("/v2/checkout/orders")) {
          const assertion = options.headers?.["PayPal-Auth-Assertion"] ?? "";
          const payload = JSON.parse(Buffer.from(assertion.split(".")[1] ?? "", "base64url").toString() || "{}");
          if (payload.payer_id !== "MERCHANT1234" || payload.iss !== "client-id-conformance") return reply(401, {});
          if (options.method === "POST" && options.path === "/v2/checkout/orders") {
            const key = options.headers?.["PayPal-Request-Id"] ?? String(Math.random());
            const body = JSON.parse(options.body ?? "{}");
            if (!orders.has(key))
              orders.set(key, {
                id: `ORDER${String(orders.size + 1).padStart(8, "0")}`,
                value: body.purchase_units[0].amount.value,
                currency: body.purchase_units[0].amount.currency_code,
              });
            const o = orders.get(key)!;
            return reply(201, {
              id: o.id,
              status: "PAYER_ACTION_REQUIRED",
              links: [{ rel: "payer-action", href: `https://www.sandbox.paypal.com/checkoutnow?token=${o.id}` }],
            });
          }
          const o = [...orders.values()].find((x) => options.path.includes(`/${x.id}`));
          if (!o) return reply(404, {});
          const unit = (captures?: { status: string }[]) => [
            { amount: { currency_code: o.currency, value: o.value }, ...(captures ? { payments: { captures } } : {}) },
          ];
          if (options.path.endsWith("/capture"))
            return scenario === "rejected"
              ? reply(422, { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "INSTRUMENT_DECLINED" }] })
              : reply(201, { id: o.id, status: "COMPLETED", purchase_units: unit([{ status: "COMPLETED" }]) });
          return reply(200, {
            id: o.id,
            status: scenario === "action-required" ? "PAYER_ACTION_REQUIRED" : "APPROVED",
            purchase_units: unit(),
          });
        }
        if (options.path === "/v1/notifications/verify-webhook-signature")
          return reply(200, {
            verification_status: JSON.parse(options.body ?? "{}").transmission_sig === "valid-sig" ? "SUCCESS" : "FAILURE",
          });
        return reply(404, {});
      },
    };
  },
  event(s, accountRef, tampered) {
    return {
      rawBody: JSON.stringify({
        id: "WH-EVENT-1",
        event_type: "MERCHANT.ONBOARDING.COMPLETED",
        resource: { tracking_id: accountRef, merchant_id: "MERCHANT1234" },
      }),
      headers: new Headers({
        "paypal-auth-algo": "SHA256withRSA",
        "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT",
        "paypal-transmission-id": "tx-1",
        "paypal-transmission-sig": tampered ? "forged" : "valid-sig",
        "paypal-transmission-time": s.now().toISOString(),
      }),
    };
  },
};

export const partnerHarnesses = [sandboxHarness, paypalHarness];
