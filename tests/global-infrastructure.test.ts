import test from "node:test";
import assert from "node:assert/strict";
import { validatePostings } from "../lib/payments/journal";
import { localizeCheckoutMethods } from "../lib/payments/localization";
import {
  assertMerchantFulfillmentAllowed,
  createCreditIntent,
  finalizeCreditPaymentSuccess,
  recordCreditDecline,
  recordLenderDisbursal,
  resolveContinentalCreditRoute,
  submitCreditForApproval,
} from "../lib/payments/credit-intents";
import { adyenKlarnaBnplPlatform } from "../lib/treasury/platforms/adyen-klarna-bnpl";
import { mercadopagoBnplPlatform } from "../lib/treasury/platforms/mercadopago-bnpl";
import { migoBnplPlatform } from "../lib/treasury/platforms/migo-bnpl";
import { xenditBnplPlatform } from "../lib/treasury/platforms/xendit-bnpl";
import { platformModule } from "../lib/treasury/platforms/registry";
import { coverage, payouts, pillars } from "../content/claims";

test("Pillar 3: Localization-as-a-Service Checkout prioritizes regional payment rails by buyer country", () => {
  const allMethods = [
    { method: "card", status: "AVAILABLE" },
    { method: "bank-transfer", status: "AVAILABLE" },
    { method: "direct-debit", status: "AVAILABLE" },
    { method: "digital-wallet", status: "AVAILABLE" },
    { method: "mobile-money", status: "AVAILABLE" },
    { method: "ussd", status: "AVAILABLE" },
    { method: "bnpl", status: "AVAILABLE" },
  ];

  // Germany (DE): SEPA Direct Debit and Giropay (bank-transfer) must be prioritized first
  const deMethods = localizeCheckoutMethods(allMethods, { payerCountry: "DE", currency: "EUR" });
  assert.equal(deMethods[0]!.method, "direct-debit");
  assert.equal(deMethods[0]!.recommended, true);
  assert.match(deMethods[0]!.localizedLabel, /SEPA/);
  assert.equal(deMethods[1]!.method, "bank-transfer");
  assert.match(deMethods[1]!.localizedLabel, /Giropay/);

  // Indonesia (ID): QRIS & local e-wallets (GoPay, OVO) must be prioritized first
  const idMethods = localizeCheckoutMethods(allMethods, { payerCountry: "ID", currency: "IDR" });
  assert.equal(idMethods[0]!.method, "digital-wallet");
  assert.match(idMethods[0]!.localizedLabel, /QRIS.*GoPay.*OVO/);
  assert.deepEqual(idMethods[0]!.badges, ["QRIS", "GoPay", "OVO"]);
  assert.equal(idMethods[1]!.method, "bank-transfer");

  // United States (US): Apple Pay & Google Pay (digital-wallet) and Credit/Debit cards first
  const usMethods = localizeCheckoutMethods(allMethods, { payerCountry: "US", currency: "USD" });
  assert.equal(usMethods[0]!.method, "digital-wallet");
  assert.match(usMethods[0]!.localizedLabel, /Apple Pay & Google Pay/);
  assert.equal(usMethods[1]!.method, "card");

  // Nigeria (NG): NIBSS Instant Bank Transfer and USSD first
  const ngMethods = localizeCheckoutMethods(allMethods, { payerCountry: "NG", currency: "NGN" });
  assert.equal(ngMethods[0]!.method, "bank-transfer");
  assert.match(ngMethods[0]!.localizedLabel, /NIBSS/);
  assert.equal(ngMethods[1]!.method, "ussd");

  // Kenya (KE): M-Pesa Mobile Money first
  const keMethods = localizeCheckoutMethods(allMethods, { payerCountry: "KE", currency: "KES" });
  assert.equal(keMethods[0]!.method, "mobile-money");
  assert.match(keMethods[0]!.localizedLabel, /M-Pesa/);

  // Brazil (BR): Pix Instant Payment first
  const brMethods = localizeCheckoutMethods(allMethods, { payerCountry: "BR", currency: "BRL" });
  assert.equal(brMethods[0]!.method, "bank-transfer");
  assert.match(brMethods[0]!.localizedLabel, /Pix/);
});

test("Global BNPL Backdoor Switch: maps every continent to its self-serve BNPL switch and Open Banking / Card Scheme backdoor", () => {
  // North America has no BNPL switch since Stripe was removed.
  assert.throws(() => resolveContinentalCreditRoute("US"), /UNSUPPORTED_CREDIT_COUNTRY:US/);

  // 2. Europe (UK, DE, FR, NL, SE): Adyen / Klarna + Tink Open Banking PSD2 Overdraft
  const eu = resolveContinentalCreditRoute("DE");
  assert.equal(eu.continent, "EUROPE");
  assert.equal(eu.platformModuleId, "adyen-klarna-bnpl");
  assert.ok(eu.coreNetworks.includes("Klarna (Pay in 3 / Financing)"));
  assert.match(eu.openBankingOrCardBackdoor, /Tink/);

  // 3. Latin America (BR, MX, CO, AR): Mercado Pago Developers + Belvo Open Finance
  const latam = resolveContinentalCreditRoute("BR");
  assert.equal(latam.continent, "LATIN_AMERICA");
  assert.equal(latam.platformModuleId, "mercadopago-bnpl");
  assert.ok(latam.coreNetworks.includes("Mercado Crédito"));
  assert.match(latam.openBankingOrCardBackdoor, /Belvo/);

  // 4. Africa (NG, KE, GH, ZA): Migo Cloud Lending API + Mono Open Banking Wallet Relay
  const africa = resolveContinentalCreditRoute("NG");
  assert.equal(africa.continent, "AFRICA");
  assert.equal(africa.platformModuleId, "migo-bnpl");
  assert.ok(africa.coreNetworks.includes("Migo Credit"));
  assert.match(africa.openBankingOrCardBackdoor, /Mono/);

  // 5. Asia-Pacific (IN, SG, ID, MY, AU): Xendit BNPL Switch + Setu India UPI Credit Line
  const apac = resolveContinentalCreditRoute("ID");
  assert.equal(apac.continent, "ASIA_PACIFIC");
  assert.equal(apac.platformModuleId, "xendit-bnpl");
  assert.ok(apac.coreNetworks.includes("Kredivo"));
  assert.match(apac.openBankingOrCardBackdoor, /Setu/);
});

test("Global Credit Intent & 4-Stage Asynchronous Disbursal State Machine: blocks merchant fulfillment until lender disburses 100% of principal", () => {
  // Stage 1: [ checkout.initiated ]
  const initiated = createCreditIntent({
    amount: 250000,
    currency: "NGN",
    customer: {
      phone: "+2348031234567",
      bvn_hash: "22113344556",
      country: "NG",
    },
    credit_type: "bnpl",
  });

  assert.equal(initiated.state, "checkout.initiated");
  assert.equal(initiated.principalAmountMinor, "25000000"); // ₦250,000.00 in kobo
  assert.equal(initiated.route.platformModuleId, "migo-bnpl");
  assert.equal(initiated.customer.identityScheme, "BVN_HASH");
  assert.equal(initiated.fulfillmentAllowed, false);
  assert.throws(
    () => assertMerchantFulfillmentAllowed(initiated),
    /FULFILLMENT_BLOCKED_AWAITING_LENDER_DISBURSAL/,
  );

  // Stage 2: [ credit.pending_approval ]
  const pendingApproval = submitCreditForApproval(initiated, {
    offerId: "af-migo-30d",
    lenderApplicationRef: "migo_app_9001",
  });
  assert.equal(pendingApproval.state, "credit.pending_approval");
  assert.equal(pendingApproval.fulfillmentAllowed, false);
  assert.throws(
    () => assertMerchantFulfillmentAllowed(pendingApproval),
    /FULFILLMENT_BLOCKED_AWAITING_LENDER_DISBURSAL/,
  );

  // Partial disbursal from lender is strictly rejected
  assert.throws(
    () =>
      recordLenderDisbursal(pendingApproval, {
        lenderDisbursementRef: "migo_disb_bad",
        disbursedPrincipalMinor: 20_000_000n,
      }),
    /LENDER_PARTIAL_DISBURSAL_REJECTED/,
  );

  // Stage 3: [ credit.disbursed ] (Lender disburses 100% of principal)
  const disbursed = recordLenderDisbursal(pendingApproval, {
    lenderDisbursementRef: "migo_disb_9001",
    disbursedPrincipalMinor: 25_000_000n,
  });
  assert.equal(disbursed.state, "credit.disbursed");
  assert.equal(disbursed.fulfillmentAllowed, false, "still blocked until internal ledger books the settlement");

  // Stage 4: [ payment.succeeded ] (Internal ledger booked -> merchant shipping unlocked!)
  const succeeded = finalizeCreditPaymentSuccess(disbursed);
  assert.equal(succeeded.state, "payment.succeeded");
  assert.equal(succeeded.fulfillmentAllowed, true);
  assert.ok(succeeded.ledgerPostings);
  validatePostings(succeeded.ledgerPostings);

  const clearance = assertMerchantFulfillmentAllowed(succeeded);
  assert.equal(clearance.allowed, true);
  assert.equal(clearance.lenderDisbursementRef, "migo_disb_9001");
  assert.match(clearance.fulfillmentToken, /^ship_/);

  // Verify decline branch reopens fallback checkout
  const declined = recordCreditDecline(pendingApproval, { reason: "credit_score_below_threshold" });
  assert.equal(declined.state, "credit.declined");
  assert.equal(declined.fulfillmentAllowed, false);
  assert.equal(declined.fallbackCheckoutOpen, true);
});

test("Continental BNPL Platform Adapters: Adyen/Klarna, Mercado Pago, Migo, and Xendit quote plans and execute credit checkouts", async () => {
  // 2. Europe (Adyen Klarna + Tink Overdraft)
  const euAdapter = adyenKlarnaBnplPlatform.create(
    { environment: "sandbox", baseUrl: "https://checkout-test.adyen.com", merchantAccount: "PayRoutaEU", apiKeyRef: "k" },
    {
      credentials: { get: async () => "adyen_key_1" },
      http: async () => ({
        status: 200,
        headers: {},
        body: JSON.stringify({
          id: "CS_EU_1",
          url: "https://checkoutshopper-test.adyen.com/checkoutshopper/sessions/CS_EU_1",
          status: "completed",
          accountHolderId: "ah_eu1",
          amount: { value: 15000, currency: "EUR" },
        }),
      }),
    },
  );
  const euOffers = await euAdapter.creditOffers!({ amount: "150.00", precision: 2, currency: "EUR", payerCountry: "DE" });
  assert.ok(euOffers.some((o) => o.id === "eu-klarna-pay3"));
  assert.ok(euOffers.some((o) => o.id === "eu-tink-psd2-overdraft"));

  // 3. LatAm (Mercado Pago + Belvo Open Finance)
  const latamAdapter = mercadopagoBnplPlatform.create(
    { environment: "sandbox", baseUrl: "https://api.mercadopago.com", accessTokenRef: "k" },
    {
      credentials: { get: async () => "APP_USR_test" },
      http: async () => ({
        status: 200,
        headers: {},
        body: JSON.stringify({
          id: "pref_br_1",
          init_point: "https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=pref_br_1",
        }),
      }),
    },
  );
  const latamOffers = await latamAdapter.creditOffers!({ amount: "500.00", precision: 2, currency: "BRL", payerCountry: "BR" });
  assert.ok(latamOffers.some((o) => o.id === "latam-mp-credito-3"));
  assert.ok(latamOffers.some((o) => o.id === "latam-belvo-openfinance"));

  // 4. Africa (Migo Cloud Lending + Mono Open Banking Wallet Relay)
  const migoAdapter = migoBnplPlatform.create(
    { environment: "sandbox", baseUrl: "https://api.migo.money", apiKeyRef: "k" },
    {
      credentials: { get: async () => "migo_test_key" },
      http: async () => ({
        status: 200,
        headers: {},
        body: JSON.stringify({
          applicationId: "migo_app_1",
          approvalUrl: "https://checkout.migo.money/approve/migo_app_1",
          status: "disbursed",
          merchantId: "m_ng_1",
          amountMinor: "25000000",
          currency: "NGN",
        }),
      }),
    },
  );
  const afOffers = await migoAdapter.creditOffers!({ amount: "250000.00", precision: 2, currency: "NGN", payerCountry: "NG" });
  assert.ok(afOffers.some((o) => o.id === "af-migo-30d"));
  assert.ok(afOffers.some((o) => o.id === "af-mono-wallet-relay"));

  // 5. Asia-Pacific (Xendit BNPL Switch + Setu India UPI Credit Line)
  const apacAdapter = xenditBnplPlatform.create(
    { environment: "sandbox", baseUrl: "https://api.xendit.co", secretKeyRef: "k" },
    {
      credentials: { get: async () => "xnd_development_1" },
      http: async () => ({
        status: 200,
        headers: {},
        body: JSON.stringify({
          id: "pl_id_1",
          checkout_url: "https://checkout.xendit.co/paylater/pl_id_1",
        }),
      }),
    },
  );
  const idOffers = await apacAdapter.creditOffers!({ amount: "500000.00", precision: 2, currency: "IDR", payerCountry: "ID" });
  assert.ok(idOffers.some((o) => o.id === "apac-kredivo-akulaku-30d"));
  const inOffers = await apacAdapter.creditOffers!({ amount: "5000.00", precision: 2, currency: "INR", payerCountry: "IN" });
  assert.ok(inOffers.some((o) => o.id === "apac-setu-upi-credit-30d"));
});

test("Marketing Claims, Ops Platform Registry & UI/UX State Consistency", () => {
  // 1. All coverage regions report credit as "testing" (not "planned")
  for (const row of coverage) {
    assert.equal(row.cells.credit, "testing", `Expected ${row.region} credit state to be testing`);
  }

  // 2. Stablecoin settlement from card and bank payments is promoted to "testing"
  const stablePayout = payouts.find((p) => p.destination === "Stablecoins from card and bank payments");
  assert.ok(stablePayout);
  assert.equal(stablePayout.availability, "testing");

  // 3. Credit pillar is promoted to "testing"
  const creditPillar = pillars.find((p) => p.id === "credit");
  assert.ok(creditPillar);
  assert.equal(creditPillar.availability, "testing");

  // 4. All 11 production Ops Treasury platform modules resolve cleanly (including the 4 continental BNPL switches)
  const opsProviderIds = [
    "paystack-split",
    "flutterwave-split",
    "monnify-split",
    "bridge-split",
    "yellowcard-split",
    "dlocal",
    "tink",
    "adyen-klarna-bnpl",
    "mercadopago-bnpl",
    "migo-bnpl",
    "xendit-bnpl",
  ];
  for (const id of opsProviderIds) {
    const mod = platformModule(id);
    assert.equal(mod.manifest.id, id);
    assert.ok(mod.manifest.name.length > 0);
  }
});
