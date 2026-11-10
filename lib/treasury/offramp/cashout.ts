// Cash out: a merchant's crypto in their NEAR Intents account, paid to their
// bank or mobile money in local currency.
//
//   1. Funding. The merchant signs a payout of USDC on Base from their
//      NEAR Intents account (lib/intents/payouts.ts) to the partner:
//        Bridge       the merchant's own liquidation address, which converts
//                     and pays their bank (USD by ACH or wire, EUR by SEPA);
//        Yellow Card  PayRouta's Yellow Card top-up address.
//   2. Payout. Once the USDC has arrived (the payout's SUCCESS, with its
//      delivery transaction):
//        Bridge       the liquidation address's drain for that transaction
//                     is followed until Bridge reports the bank paid;
//        Yellow Card  PayRouta submits a send of that USD amount to the
//                     merchant's bank or mobile money, keyed to the cash out
//                     so it's never sent twice, and follows it until paid.
//
// A cash out that stops after its USDC has arrived is "Needs attention":
// the partner holds or returns the funds, and operations settle it.
import { z } from "zod";
import { db } from "../../portal/db";
import { atomic, audit } from "../../portal/service";
import { PortalError } from "../../portal/domain";
import { secretManager } from "../../portal/adapters";
import { merchantMember } from "../../merchant/access";
import { rateLimit } from "../../portal/access";
import { providerRequest } from "../../providers/adapters/http";
import { destinations, type Http } from "../../intents/oneclick";
import { payouts, quotePayout } from "../../intents/payouts";
import { bankInput, bridge, bridgeConfigured, drainPaid, drainStopped, drains, externalAccount, externalAccountBody, kycLink, liquidationAddress } from "./bridge";
import { destinationInput, networks, send, sendFailed, sendPaid, yellowCard, yellowCardConfigured, type Destination } from "./yellowcard";
import { alpha3 } from "./iso3";
import { loadRequirements } from "../../merchant/requirements";

type Deps = { http?: Http; now?: Date };
export const partners = ["bridge", "yellowcard"] as const;
export type Partner = (typeof partners)[number];

// Cash outs are funded in USDC on Base.
const usdcBase = () => {
  const d = destinations.find((x) => x.network === "eip155:8453" && x.symbol === "USDC");
  if (!d) throw new PortalError("CASHOUT_PARTNER_NOT_CONFIGURED", 503);
  return d;
};

async function business(orgId: string) {
  const profile = await db.merchantKybProfile.findFirst({ where: { orgId }, orderBy: { version: "desc" } });
  const p = (profile?.data ?? {}) as {
    legalName?: string;
    registrationNumber?: string;
    country?: string;
    supportEmail?: string;
    address?: { line1?: string; city?: string; postalCode?: string; country?: string; region?: string };
    representative?: { email?: string };
  };
  if (!p.legalName || !p.address?.line1 || !p.address.city || !p.address.country) throw new PortalError("CASHOUT_BUSINESS_DETAILS_REQUIRED", 409);
  return {
    legalName: p.legalName,
    registrationNumber: p.registrationNumber ?? "",
    country: p.address.country,
    email: p.representative?.email ?? p.supportEmail ?? "",
    address: { line1: p.address.line1, city: p.address.city, postalCode: p.address.postalCode ?? "", country: p.address.country, state: p.address.region },
  };
}

function presentAccount(a: {
  id: string;
  partner: string;
  status: string;
  country: string;
  currency: string;
  label: string;
  kycUrl: string | null;
  tosUrl: string | null;
  partnerCustomerId: string | null;
  liquidationAddress: string | null;
}) {
  return {
    id: a.id,
    partner: a.partner,
    status: a.status,
    country: a.country,
    currency: a.currency,
    label: a.label,
    // Bridge: the links the merchant completes to be verified.
    ...(a.status === "Verifying" && !a.partnerCustomerId ? { kycUrl: a.kycUrl, tosUrl: a.tosUrl } : {}),
    verified: a.partner === "yellowcard" || !!a.partnerCustomerId,
    // Bridge: USDC on Base sent here from anywhere is paid to the bank.
    ...(a.liquidationAddress ? { depositAddress: a.liquidationAddress } : {}),
  };
}

function presentCashOut(c: { id: string; partner: string; amountUsd: string; currency: string; status: string; localAmount: string | null; failure: string | null; createdAt: Date }) {
  return {
    id: c.id,
    partner: c.partner,
    amountUsd: c.amountUsd,
    currency: c.currency,
    localAmount: c.localAmount,
    status: c.status,
    failure: c.failure,
    createdAt: c.createdAt.toISOString(),
  };
}

// --- Bridge setup ---------------------------------------------------------------

// Who is acting: the dashboard member (the wrappers below), or a test.
type Actor = { orgId: string; environment: string; userId: string };
async function member(orgId: string, headers: Headers, permission: "configure" | "read" = "configure"): Promise<Actor> {
  const { session, config } = await merchantMember(orgId, permission, headers);
  if (permission === "configure") await rateLimit(`cashout-setup:${orgId}`, 10);
  return { orgId, environment: config.environment, userId: session.user.id };
}

// Starts (or resumes) Bridge verification of the business.
export const startBridge = async (orgId: string, raw: unknown, headers: Headers) => startBridgeAs(await member(orgId, headers), raw);
export async function startBridgeAs({ orgId, environment, userId }: Actor, raw: unknown, deps: Deps = {}) {
  const config = { environment };
  const session = { user: { id: userId } };
  const { currency } = z.object({ currency: z.enum(["usd", "eur"]) }).parse(raw);
  const existing = await db.fiatPayoutAccount.findUnique({ where: { orgId_environment_partner: { orgId, environment: config.environment, partner: "bridge" } } });
  if (existing) return { account: presentAccount(await refreshBridge(existing, deps)) };
  const b = await business(orgId);
  if (!b.email) throw new PortalError("CASHOUT_BUSINESS_DETAILS_REQUIRED", 409);
  const link = await bridge(
    config.environment,
    "POST",
    "/kyc_links",
    kycLink,
    { full_name: b.legalName, email: b.email, type: "business", ...(currency === "eur" ? { endorsements: ["sepa"] } : {}) },
    `payrouta-kyc-${orgId}-${config.environment}`,
    deps.http,
  );
  const account = await atomic(async (tx) => {
    const a = await tx.fiatPayoutAccount.create({
      data: {
        orgId,
        environment: config.environment,
        partner: "bridge",
        country: b.country,
        currency: currency.toUpperCase(),
        label: currency === "usd" ? "US bank account" : "SEPA bank account",
        kycLinkId: link.id,
        kycUrl: link.kyc_link,
        tosUrl: link.tos_link,
        createdBy: session.user.id,
      },
    });
    await audit(tx, orgId, session.user.id, "merchant.cashout.verification_started", a.id, { partner: "bridge" });
    return a;
  });
  return { account: presentAccount(account) };
}

async function refreshBridge<T extends { id: string; environment: string; kycLinkId: string | null; partnerCustomerId: string | null; status: string }>(a: T, deps: Deps) {
  if (a.partnerCustomerId || !a.kycLinkId || a.status === "Rejected") return a;
  const link = await bridge(a.environment, "GET", `/kyc_links/${encodeURIComponent(a.kycLinkId)}`, kycLink, undefined, undefined, deps.http);
  if (link.kyc_status === "approved" && link.tos_status === "approved" && link.customer_id)
    return (await db.fiatPayoutAccount.update({ where: { id: a.id }, data: { partnerCustomerId: link.customer_id } })) as unknown as T;
  if (link.kyc_status === "rejected" || link.kyc_status === "offboarded")
    return (await db.fiatPayoutAccount.update({ where: { id: a.id }, data: { status: "Rejected" } })) as unknown as T;
  return a;
}

// After verification: the bank account, and the liquidation address that
// pays it.
export const addBridgeBank = async (orgId: string, raw: unknown, headers: Headers) => addBridgeBankAs(await member(orgId, headers), raw);
export async function addBridgeBankAs({ orgId, environment, userId }: Actor, raw: unknown, deps: Deps = {}) {
  const config = { environment };
  const session = { user: { id: userId } };
  const bank = bankInput.parse(raw);
  const found = await db.fiatPayoutAccount.findUnique({ where: { orgId_environment_partner: { orgId, environment: config.environment, partner: "bridge" } } });
  if (!found) throw new PortalError("CASHOUT_ACCOUNT_NOT_FOUND", 404);
  const a = await refreshBridge(found, deps);
  if (!a.partnerCustomerId) throw new PortalError("CASHOUT_VERIFICATION_PENDING", 409);
  const b = await business(orgId);
  const country3 = alpha3[b.address.country];
  if (!country3) throw new PortalError("CASHOUT_BUSINESS_DETAILS_REQUIRED", 409);
  const customer = encodeURIComponent(a.partnerCustomerId);
  const ext = await bridge(
    config.environment,
    "POST",
    `/customers/${customer}/external_accounts`,
    externalAccount,
    externalAccountBody(bank, { legalName: b.legalName, address: { ...b.address, country3 } }),
    `payrouta-ea-${a.id}-${bank.currency === "usd" ? bank.accountNumber.slice(-4) : bank.iban.slice(-4)}`,
    deps.http,
  );
  const liq = await bridge(
    config.environment,
    "POST",
    `/customers/${customer}/liquidation_addresses`,
    liquidationAddress,
    {
      chain: "base",
      currency: "usdc",
      external_account_id: ext.id,
      destination_payment_rail: bank.rail,
      destination_currency: bank.currency,
      ...(bank.rail === "wire" ? { destination_wire_message: "PayRouta cash out" } : {}),
      ...(bank.rail === "sepa" ? { destination_sepa_reference: "PayRouta cash out" } : {}),
    },
    `payrouta-liq-${a.id}-${ext.id}`,
    deps.http,
  );
  if (liq.chain !== "base" || liq.currency !== "usdc" || !/^0x[0-9a-fA-F]{40}$/.test(liq.address)) throw new PortalError("CASHOUT_PARTNER_UNAVAILABLE", 503);
  const last4 = ext.last_4 ?? (bank.currency === "usd" ? bank.accountNumber.slice(-4) : bank.iban.slice(-4));
  const updated = await atomic(async (tx) => {
    const u = await tx.fiatPayoutAccount.update({
      where: { id: a.id },
      data: {
        status: "Ready",
        currency: bank.currency.toUpperCase(),
        label: `${bank.bankName} ···${last4} (${bank.currency.toUpperCase()}, ${bank.rail.toUpperCase()})`,
        externalAccountId: ext.id,
        liquidationAddressId: liq.id,
        liquidationAddress: liq.address,
      },
    });
    await audit(tx, orgId, session.user.id, "merchant.cashout.account_ready", u.id, { partner: "bridge", currency: bank.currency, rail: bank.rail });
    return u;
  });
  return { account: presentAccount(updated) };
}

// --- Yellow Card setup ------------------------------------------------------------

export const yellowCardNetworks = async (orgId: string, raw: unknown, headers: Headers) => yellowCardNetworksAs(await member(orgId, headers, "read"), raw);
export async function yellowCardNetworksAs({ environment }: Actor, raw: unknown, deps: Deps = {}) {
  const config = { environment };
  const { country } = z.object({ country: z.string().regex(/^[A-Z]{2}$/) }).parse(raw);
  const r = await yellowCard(config.environment, "GET", `/business/networks?country=${country}`, networks, undefined, deps.http);
  return {
    networks: r.networks
      .filter((n) => n.status === "active" && n.country === country && n.channelType)
      .map((n) => ({ id: n.id, name: n.name, channelType: n.channelType! }))
      .sort((a, b) => a.channelType.localeCompare(b.channelType) || a.name.localeCompare(b.name)),
  };
}

export const setYellowCard = async (orgId: string, raw: unknown, headers: Headers) => setYellowCardAs(await member(orgId, headers), raw);
export async function setYellowCardAs({ orgId, environment, userId }: Actor, raw: unknown) {
  const config = { environment };
  const session = { user: { id: userId } };
  const d = destinationInput.parse(raw);
  const destinationRef = await secretManager.put(JSON.stringify(d));
  const label = `${d.networkName} ···${d.accountNumber.replace(/\s/g, "").slice(-4)} (${d.currency})`;
  const account = await atomic(async (tx) => {
    const data = { status: "Ready", country: d.country, currency: d.currency, label, destinationRef };
    const a = await tx.fiatPayoutAccount.upsert({
      where: { orgId_environment_partner: { orgId, environment: config.environment, partner: "yellowcard" } },
      create: { orgId, environment: config.environment, partner: "yellowcard", createdBy: session.user.id, ...data },
      update: data,
    });
    await audit(tx, orgId, session.user.id, "merchant.cashout.account_ready", a.id, { partner: "yellowcard", country: d.country, currency: d.currency });
    return a;
  });
  return { account: presentAccount(account) };
}

// --- Cash out -------------------------------------------------------------------

export function fundingAddress(a: { partner: string; liquidationAddress: string | null }) {
  if (a.partner === "bridge") return a.liquidationAddress;
  const address = process.env.YELLOWCARD_TOPUP_ADDRESS;
  return address && /^0x[0-9a-fA-F]{40}$/.test(address) ? address : null;
}

// What arrives, in USD, rounded down to the cent: what the partner pays out.
export const centsDown = (usd: string) => {
  const [whole, fraction = ""] = usd.split(".");
  return `${BigInt(whole || "0")}.${fraction.padEnd(2, "0").slice(0, 2)}`;
};

// Quotes the funding payout for the merchant to sign (the dashboard signs
// it like any payout, then submits it with intents-payout-submit).
export async function quoteCashOut(orgId: string, raw: unknown, headers: Headers, deps: Deps = {}) {
  const { config } = await merchantMember(orgId, "configure", headers);
  const input = z
    .object({
      partner: z.enum(partners),
      originAsset: z.string().min(1).max(300),
      amount: z.string().regex(/^\d{1,12}(\.\d{1,18})?$/),
    })
    .strict()
    .parse(raw);
  if (config.environment !== "production") throw new PortalError("CROSS_CHAIN_LIVE_ONLY", 409);
  const account = await db.fiatPayoutAccount.findUnique({ where: { orgId_environment_partner: { orgId, environment: config.environment, partner: input.partner } } });
  if (!account || account.status !== "Ready") throw new PortalError("CASHOUT_ACCOUNT_NOT_READY", 409);
  // PayRouta sends Yellow Card payouts itself, so it must know who is paid.
  // Bridge verifies the business on its own.
  if (account.partner === "yellowcard" && !(await loadRequirements(db, orgId, config.environment)).ready["cash-out"])
    throw new PortalError("CASHOUT_IDENTITY_REQUIRED", 409);
  const recipient = fundingAddress(account);
  if (!recipient) throw new PortalError("CASHOUT_PARTNER_NOT_CONFIGURED", 503);
  const quoted = await quotePayout(
    orgId,
    { originAsset: input.originAsset, amount: input.amount, destinationAsset: usdcBase().assetId, recipient, note: `Cash out to ${account.label}` },
    headers,
    deps,
  );
  const amountUsd = centsDown(quoted.payout.receive.split(" ")[0]);
  const cashOut = await db.fiatPayout.create({
    data: { orgId, environment: config.environment, accountId: account.id, partner: account.partner, payoutId: quoted.payout.id, amountUsd, currency: account.currency },
  });
  return { ...quoted, cashOut: presentCashOut(cashOut) };
}

// Moves one cash out on: funding, then the partner's payout.
export async function advanceCashOut(id: string, deps: Deps = {}) {
  const http = deps.http ?? providerRequest;
  const now = deps.now ?? new Date();
  const c = await db.fiatPayout.findUniqueOrThrow({ where: { id } });
  if (["Paid", "Failed", "Needs attention"].includes(c.status)) return c;
  const payout = await db.intentsPayout.findUniqueOrThrow({ where: { id: c.payoutId } });
  const set = (data: Partial<{ status: string; partnerRef: string; localAmount: string; rate: string; failure: string }>) =>
    db.fiatPayout.update({ where: { id: c.id }, data });
  if (["EXPIRED", "REFUNDED", "FAILED"].includes(payout.status))
    return set({ status: "Failed", failure: payout.status === "EXPIRED" ? "Not signed in time" : "The USDC didn't reach the partner" });
  if (payout.status !== "SUCCESS") return payout.status === "AWAITING_SIGNATURE" ? c : c.status === "Funding" ? c : set({ status: "Funding" });

  const account = await db.fiatPayoutAccount.findUniqueOrThrow({ where: { id: c.accountId } });
  if (c.partner === "bridge") {
    // The drain of the USDC this payout delivered.
    const delivered = ((payout.details as { destinationChainTxHashes?: { hash: string }[] } | null)?.destinationChainTxHashes ?? []).map((t) => t.hash.toLowerCase());
    const list = await bridge(
      account.environment,
      "GET",
      `/customers/${encodeURIComponent(account.partnerCustomerId!)}/liquidation_addresses/${encodeURIComponent(account.liquidationAddressId!)}/drains`,
      drains,
      undefined,
      undefined,
      http,
    );
    const drain = list.find((d) => d.deposit_tx_hash && delivered.includes(d.deposit_tx_hash.toLowerCase()));
    if (!drain) return c.status === "Converting" ? c : set({ status: "Converting" });
    if (drainPaid.has(drain.state)) return set({ status: "Paid", partnerRef: drain.id, localAmount: drain.amount });
    if (drainStopped.has(drain.state)) return set({ status: "Needs attention", partnerRef: drain.id, failure: `Bridge: ${drain.state}` });
    return set({ status: "Converting", partnerRef: drain.id });
  }

  // Yellow Card: send once, keyed to this cash out, then follow it.
  let s: z.infer<typeof send> | null = null;
  try {
    s = await yellowCard(account.environment, "GET", `/business/send/sequence-id/${c.id}`, send, undefined, http, now);
  } catch (e) {
    if (!(e instanceof PortalError && e.message === "CASHOUT_PARTNER_NOT_FOUND")) throw e;
  }
  if (!s) {
    const d = JSON.parse(await secretManager.get(account.destinationRef!)) as Destination;
    const b = await business(c.orgId);
    s = await yellowCard(
      account.environment,
      "POST",
      "/business/send",
      send,
      {
        sequenceId: c.id,
        amount: Number(c.amountUsd),
        currency: d.currency,
        country: d.country,
        channelType: d.channelType,
        reason: "other",
        customerType: "institution",
        forceAccept: true,
        sender: {
          businessName: b.legalName,
          ...(b.registrationNumber ? { businessId: b.registrationNumber } : {}),
          country: b.country,
          address: [b.address.line1, b.address.city, b.address.postalCode].filter(Boolean).join(", "),
          ...(b.email ? { email: b.email } : {}),
        },
        destination: {
          accountNumber: d.accountNumber.replace(/\s/g, ""),
          accountName: d.accountName,
          accountType: d.channelType,
          networkId: d.networkId,
          networkName: d.networkName,
          country: d.country,
        },
      },
      http,
      now,
    );
  }
  const amounts = {
    partnerRef: s.id,
    ...(s.convertedAmount !== undefined ? { localAmount: String(s.convertedAmount) } : {}),
    ...(s.rate !== undefined ? { rate: String(s.rate) } : {}),
  };
  if (sendPaid.has(s.status)) return set({ status: "Paid", ...amounts });
  if (sendFailed.has(s.status)) return set({ status: "Needs attention", failure: `Yellow Card: ${s.errorCode ?? s.status}`, ...amounts });
  return set({ status: "Converting", ...amounts });
}

// Worker sweep: refresh funding payouts, then move every open cash out on.
export async function sweepCashOuts(deps: Deps = {}) {
  const open = await db.fiatPayout.findMany({ where: { status: { in: ["Awaiting signature", "Funding", "Converting"] } }, take: 100, orderBy: { updatedAt: "asc" } });
  for (const scope of new Map(open.map((c) => [`${c.orgId}|${c.environment}`, c])).values())
    await payouts(scope.orgId, scope.environment, deps).catch(() => []);
  for (const c of open) await advanceCashOut(c.id, deps).catch(() => null);
}

// The dashboard's view: accounts, and recent cash outs moved on.
export async function cashOutView(orgId: string, environment: string, deps: Deps = {}) {
  const accounts = await db.fiatPayoutAccount.findMany({ where: { orgId, environment } });
  const refreshed = await Promise.all(accounts.map((a) => (a.partner === "bridge" ? refreshBridge(a, deps).catch(() => a) : a)));
  const recent = await db.fiatPayout.findMany({ where: { orgId, environment }, orderBy: { createdAt: "desc" }, take: 20 });
  const moved = await Promise.all(recent.map((c) => advanceCashOut(c.id, deps).catch(() => c)));
  return {
    accounts: refreshed.map(presentAccount),
    cashOuts: moved.map(presentCashOut),
    yellowCardFunding: !!fundingAddress({ partner: "yellowcard", liquidationAddress: null }),
    // Which partners can take a cash out here; the dashboard marks the others "Not available".
    available: {
      bridge: bridgeConfigured(environment),
      yellowcard: yellowCardConfigured(environment) && !!fundingAddress({ partner: "yellowcard", liquidationAddress: null }),
    },
  };
}

export async function cashOutsFor(orgId: string, headers: Headers) {
  const { environment } = await member(orgId, headers, "read");
  return cashOutView(orgId, environment);
}
