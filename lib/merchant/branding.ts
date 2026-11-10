// What customers see of the merchant at checkout, on payment links and on
// invoices: the name, the logo, the verified tick, and where to reach them
// (the website and support email from their business details).
//
// Logos are PNG, JPEG or WebP up to 256 KB, checked by their bytes, never by
// the name or type the browser sends. SVG is refused: it can carry script.
// Each is served at /api/brand/{key}, a random key per upload.
import { randomBytes } from "node:crypto";
import { db } from "../portal/db";
import { atomic, audit } from "../portal/service";
import { PortalError } from "../portal/domain";
import { rateLimit } from "../portal/access";
import { merchantMember } from "./access";
import { kybProfileSchema } from "../partners/kyb";
import { identityVerified, loadRequirements } from "./requirements";

export const logoMaxBytes = 256 * 1024;

// The image type its bytes say it is, or null.
export function logoType(bytes: Uint8Array): "image/png" | "image/jpeg" | "image/webp" | null {
  const at = (i: number, ...b: number[]) => b.every((x, k) => bytes[i + k] === x);
  if (bytes.length < 12) return null;
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
  return null;
}

export const logoUrl = (key: string) => `/api/brand/${key}`;

export async function saveLogo(orgId: string, bytes: Uint8Array, headers: Headers) {
  const { session } = await merchantMember(orgId, "configure", headers);
  await rateLimit(`logo:${orgId}`, 10);
  if (bytes.length > logoMaxBytes) throw new PortalError("LOGO_TOO_LARGE", 413);
  const mime = logoType(bytes);
  if (!mime) throw new PortalError("LOGO_TYPE_UNSUPPORTED", 400);
  const key = randomBytes(16).toString("hex");
  await atomic(async (tx) => {
    const data = { key, mime, bytes: Buffer.from(bytes), updatedBy: session.user.id };
    await tx.merchantLogo.upsert({ where: { orgId }, create: { orgId, ...data }, update: data });
    await audit(tx, orgId, session.user.id, "merchant.branding.logo_set", orgId, { mime, size: bytes.length });
  });
  forgetBrand(orgId);
  return { logo: logoUrl(key) };
}

export async function removeLogo(orgId: string, headers: Headers) {
  const { session } = await merchantMember(orgId, "configure", headers);
  await atomic(async (tx) => {
    await tx.merchantLogo.deleteMany({ where: { orgId } });
    await audit(tx, orgId, session.user.id, "merchant.branding.logo_removed", orgId, {});
  });
  forgetBrand(orgId);
  return { logo: null };
}

export async function logoByKey(key: string) {
  if (!/^[0-9a-f]{32}$/.test(key)) return null;
  return db.merchantLogo.findUnique({ where: { key }, select: { mime: true, bytes: true } });
}

export type Brand = {
  // PayRouta has verified who the merchant is (requirements.ts identityVerified).
  verified: boolean;
  logo: string | null;
  website: string | null;
  supportEmail: string | null;
};

// Checkouts poll often; the brand changes rarely. An upload here clears it.
const cache = new Map<string, { brand: Brand; at: number }>();
const forgetBrand = (orgId: string) => cache.delete(orgId);

export async function merchantBrand(orgId: string, now = Date.now()): Promise<Brand> {
  const hit = cache.get(orgId);
  if (hit && now - hit.at < 5 * 60000) return hit.brand;
  const [logo, profileRow] = await Promise.all([
    db.merchantLogo.findUnique({ where: { orgId }, select: { key: true } }),
    db.merchantKybProfile.findFirst({ where: { orgId }, orderBy: { version: "desc" } }),
  ]);
  const profile = profileRow ? kybProfileSchema.safeParse(profileRow.data) : null;
  let verified = false;
  try {
    verified = identityVerified(await loadRequirements(db, orgId, "production"));
  } catch {
    verified = false;
  }
  const website = profile?.success ? profile.data.website : undefined;
  const brand: Brand = {
    verified,
    logo: logo ? logoUrl(logo.key) : null,
    // Only an https website is ever stored (kybProfileSchema).
    website: website && website.startsWith("https://") ? website : null,
    supportEmail: profile?.success ? (profile.data.supportEmail ?? null) : null,
  };
  if (cache.size > 5000) cache.clear();
  cache.set(orgId, { brand, at: now });
  return brand;
}
