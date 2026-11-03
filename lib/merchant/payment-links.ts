// Payment links: PayRouta checkout for merchants with no website or store.
// The merchant creates a link once (title, amount, ways to pay) and shares it
// anywhere: WhatsApp, Instagram, SMS, an invoice, a QR code. Each customer
// who presses Pay on the link's page gets their own universal checkout
// (lib/payments/universal.ts), so one link takes any number of payments.
// Opening the page creates nothing, so link previews in chat apps are safe.
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "../portal/db";
import { atomic, audit } from "../portal/service";
import { PortalError } from "../portal/domain";
import { rateLimit } from "../portal/access";
import { currencyExponent } from "../partners/money";
import { fiatPaymentMethodIds } from "../providers/normalized";
import { createUniversalCheckout } from "../payments/universal";
import { merchantMember } from "./access";
import { merchantConfiguration } from "./configuration";
import { platformCandidates } from "../treasury/routes";

// Fiat methods that are on for this merchant (its approved platform rails).
export async function linkMethodsOn(orgId: string, environment: string) {
  return new Set((await platformCandidates(orgId, environment)).map((c) => c.method as string));
}

export const paymentLinkInput = z
  .object({
    title: z.string().trim().min(1).max(80),
    description: z.string().trim().max(240).optional(),
    amount: z.string().regex(/^(0|[1-9]\d{0,12})(\.\d{1,8})?$/),
    currency: z.string().regex(/^[A-Z]{3}$/),
    methods: z
      .array(z.enum(fiatPaymentMethodIds))
      .max(fiatPaymentMethodIds.length)
      .refine((m) => new Set(m).size === m.length, "Duplicate payment method")
      .default([]),
    crypto: z.boolean().default(false),
    country: z.string().regex(/^[A-Z]{2}$/),
  })
  .strict()
  .refine((v) => v.methods.length || v.crypto, "Offer at least one way to pay");

const alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function newSlug(length = 10) {
  const bytes = randomBytes(length);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

// The amount in the currency's own precision, e.g. "150000" NGN -> "150000.00".
export function linkAmount(amount: string, currency: string) {
  const exp = currencyExponent(currency);
  if (exp === null || exp === undefined) throw new PortalError("UNSUPPORTED_CURRENCY", 409);
  const [whole, fraction = ""] = amount.split(".");
  if (fraction.length > exp) throw new PortalError("INVALID_AMOUNT", 400);
  if (/^0+$/.test(whole + fraction)) throw new PortalError("INVALID_AMOUNT", 400);
  return exp ? `${whole}.${fraction.padEnd(exp, "0")}` : whole;
}

// Stablecoins the merchant can receive right now in this environment.
export async function cryptoOptions(orgId: string, environment: string) {
  const config = await merchantConfiguration(orgId, environment);
  return config.stablecoinAssets
    .filter((a) => a.configured && a.executionEnabled)
    .map((a) => ({ network: a.network, identifier: a.identifier }))
    .slice(0, 20);
}

export async function createPaymentLink(orgId: string, raw: unknown, headers: Headers) {
  const { config, session } = await merchantMember(orgId, "configure", headers);
  return insertPaymentLink(orgId, config.environment, raw, session.user.id);
}

// Shared by the dashboard and API keys (the MCP server, lib/mcp).
export async function insertPaymentLink(orgId: string, environment: string, raw: unknown, actor: string) {
  await rateLimit(`payment-link:${orgId}`, 30);
  const input = paymentLinkInput.parse(raw);
  const amount = linkAmount(input.amount, input.currency);
  // A link must be payable: only methods that are on for this account.
  const on = await linkMethodsOn(orgId, environment);
  if (input.methods.some((m) => !on.has(m))) throw new PortalError("PAYMENT_LINK_METHOD_NOT_ON", 409);
  if (input.crypto) {
    if (input.currency !== "USD") throw new PortalError("PAYMENT_LINK_CRYPTO_REQUIRES_USD", 409);
    if (!(await cryptoOptions(orgId, environment)).length)
      throw new PortalError("PAYMENT_LINK_CRYPTO_NOT_CONFIGURED", 409);
  }
  return atomic(async (tx) => {
    const link = await tx.paymentLink.create({
      data: {
        orgId,
        environment,
        slug: newSlug(),
        title: input.title,
        description: input.description || null,
        amount,
        currency: input.currency,
        methods: input.methods,
        crypto: input.crypto,
        country: input.country,
        createdBy: actor,
      },
    });
    await audit(tx, orgId, actor, "merchant.payment_link.created", link.id, {
      environment: link.environment,
      amount,
      currency: input.currency,
    });
    return { id: link.id, slug: link.slug, path: `/pay/${link.slug}` };
  });
}

export async function listPaymentLinks(orgId: string, environment: string) {
  const links = await db.paymentLink.findMany({ where: { orgId, environment }, orderBy: { createdAt: "desc" }, take: 100 });
  return links.map((l) => ({
    id: l.id,
    slug: l.slug,
    path: `/pay/${l.slug}`,
    title: l.title,
    amount: l.amount,
    currency: l.currency,
    methods: l.methods as string[],
    crypto: l.crypto,
    active: l.active,
    checkouts: l.checkouts,
    createdAt: l.createdAt.toISOString(),
  }));
}

export async function setPaymentLinkActive(orgId: string, id: string, active: boolean, headers: Headers) {
  const { session } = await merchantMember(orgId, "configure", headers);
  return atomic(async (tx) => {
    const link = await tx.paymentLink.findFirst({ where: { id, orgId } });
    if (!link) throw new PortalError("NOT_FOUND", 404);
    await tx.paymentLink.update({ where: { id }, data: { active } });
    await audit(tx, orgId, session.user.id, active ? "merchant.payment_link.enabled" : "merchant.payment_link.disabled", id, {});
    return { id, active };
  });
}

// What the public page shows. Null when the link doesn't exist or is off.
export async function publicPaymentLink(slug: string) {
  if (!/^[A-Za-z0-9]{6,20}$/.test(slug)) return null;
  const link = await db.paymentLink.findUnique({ where: { slug } });
  if (!link || !link.active) return null;
  const org = await db.organization.findUnique({ where: { id: link.orgId }, select: { name: true } });
  return { ...link, merchant: org?.name ?? "Merchant", methods: link.methods as string[] };
}

function origin() {
  const value = process.env.BETTER_AUTH_URL;
  if (!value) throw new PortalError("PORTAL_ORIGIN_NOT_CONFIGURED", 503);
  return new URL(value).origin;
}

// A customer pressed Pay: open their own checkout for this link.
export async function startPaymentLinkCheckout(slug: string, visitor: { ip: string; country?: string | null }) {
  const link = await publicPaymentLink(slug);
  if (!link) throw new PortalError("PAYMENT_LINK_UNAVAILABLE", 404);
  await rateLimit(`payment-link-pay:${slug}:${visitor.ip}`, 20);
  const payerCountry = visitor.country && /^[A-Z]{2}$/.test(visitor.country) && visitor.country !== "XX" ? visitor.country : link.country;
  const crypto = link.crypto && link.currency === "USD" ? await cryptoOptions(link.orgId, link.environment) : [];
  const checkout = await createUniversalCheckout(link.orgId, link.environment, `link-${link.id}-${randomUUID().slice(0, 12)}`, {
    reference: `${link.title} (${link.slug})`.slice(0, 100),
    payerCountry,
    amount: link.amount,
    currency: link.currency,
    methods: link.methods,
    ...(crypto.length ? { crypto: { options: crypto } } : {}),
    returnUrl: `${origin()}/pay/${link.slug}/done`,
    metadata: { payment_link: link.id },
  });
  await db.paymentLink.update({ where: { id: link.id }, data: { checkouts: { increment: 1 } } });
  return `${origin()}${checkout.checkoutPath}`;
}
