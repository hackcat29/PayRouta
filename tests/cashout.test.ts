import { test } from "node:test";
import assert from "node:assert/strict";
import { ycSignature, destinationInput } from "../lib/treasury/offramp/yellowcard";
import { bankInput, externalAccountBody } from "../lib/treasury/offramp/bridge";
import { centsDown, fundingAddress } from "../lib/treasury/offramp/cashout";
import { alpha3 } from "../lib/treasury/offramp/iso3";

test("Yellow Card signatures: HMAC-SHA256 over timestamp, path, method, and the body's hash for POST", () => {
  // Vectors computed independently (Python hmac).
  assert.equal(ycSignature("yc-secret", "2026-11-02T10:00:00.000Z", "/business/send", "POST", '{"a":1}'), "aHXAjOY3QcX+rLkIshUYlEpjSQGgqPxNl5I6UrgE8sQ=");
  assert.equal(ycSignature("yc-secret", "2026-11-02T10:00:00.000Z", "/business/networks", "GET"), "v+d16c7s+Lmr9/i166iqGNjHLzGr394plYJ25tF0NE4=");
});

test("Bridge bank accounts: US or SEPA, owned by the business, with a three-letter country", () => {
  const us = bankInput.parse({ currency: "usd", rail: "ach", bankName: "Lead Bank", accountName: "Operating", routingNumber: "101019644", accountNumber: "215268129123", checkingOrSavings: "checking" });
  const body = externalAccountBody(us, { legalName: "Harbor Goods Ltd", address: { line1: "1 Dock Street", city: "London", postalCode: "E1 1AA", country3: alpha3.GB } }) as Record<string, unknown>;
  assert.equal(body.account_type, "us");
  assert.equal(body.account_owner_type, "business");
  assert.equal(body.business_name, "Harbor Goods Ltd");
  assert.deepEqual(body.account, { routing_number: "101019644", account_number: "215268129123", checking_or_savings: "checking" });
  assert.equal((body.address as { country: string }).country, "GBR");
  const eu = bankInput.parse({ currency: "eur", rail: "sepa", bankName: "Modulr", accountName: "Ops", iban: "IE26MODR99035507970528", bic: "MODRIE22XXX", ibanCountry: "IRL" });
  assert.equal((externalAccountBody(eu, { legalName: "H", address: { line1: "1", city: "D", postalCode: "D1", country3: "IRL" } }) as Record<string, unknown>).account_type, "iban");
  assert.throws(() => bankInput.parse({ ...us, routingNumber: "12" }));
  assert.throws(() => bankInput.parse({ ...eu, rail: "ach" }));
});

test("cash outs: amounts round down to the cent; Yellow Card needs PayRouta's top-up address", () => {
  assert.equal(centsDown("40.189999"), "40.18");
  assert.equal(centsDown("7"), "7.00");
  assert.equal(fundingAddress({ partner: "bridge", liquidationAddress: `0x${"1".repeat(40)}` }), `0x${"1".repeat(40)}`);
  delete process.env.YELLOWCARD_TOPUP_ADDRESS;
  assert.equal(fundingAddress({ partner: "yellowcard", liquidationAddress: null }), null);
  process.env.YELLOWCARD_TOPUP_ADDRESS = `0x${"2".repeat(40)}`;
  assert.equal(fundingAddress({ partner: "yellowcard", liquidationAddress: null }), `0x${"2".repeat(40)}`);
  assert.throws(() => destinationInput.parse({ country: "NG", currency: "NGN", channelType: "momo", networkId: "n", networkName: "MTN", accountNumber: "x", accountName: "A" }));
});
