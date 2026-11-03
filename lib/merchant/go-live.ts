// Going live with crypto, without a review. A merchant taking crypto into its
// own NEAR Intents account and keeping it as crypto needs only a name, a
// country, the merchant terms and a clear sanctions check
// (lib/merchant/requirements.ts). PayRouta never holds those funds.
import { db } from "../portal/db";
import { atomic, audit } from "../portal/service";
import { PortalError } from "../portal/domain";
import type { Tx } from "../payments/service";
import { merchantMember } from "./access";
import { loadRequirements } from "./requirements";

export const cryptoMethods = ["stablecoin", "crypto-app"] as const;
export const isCryptoMethod = (method: string | null | undefined) =>
  (cryptoMethods as readonly string[]).includes(method ?? "");

// Why this merchant can't take live crypto payments; empty when it can.
export async function cryptoBlockers(client: typeof db | Tx, orgId: string, now = new Date()) {
  const org = await client.organization.findUniqueOrThrow({ where: { id: orgId } });
  if (org.fictional) return ["FICTIONAL_ORGANIZATION"];
  const r = await loadRequirements(client, orgId, "production", now);
  if (r.screening === "match") return ["MERCHANT_RESTRICTED"];
  const reasons = r.entries.some((e) => e.status === "due" && e.blocks.includes("crypto"))
    ? ["CRYPTO_REQUIREMENTS_DUE"]
    : [];
  if (r.screening !== "clear") reasons.push("MERCHANT_SCREENING_REQUIRED");
  return reasons;
}

export async function assertCryptoReady(client: typeof db | Tx, orgId: string, now = new Date()) {
  const [reason] = await cryptoBlockers(client, orgId, now);
  if (reason) throw new PortalError(reason, 409);
}

export async function goLiveWithCrypto(orgId: string, headers: Headers) {
  const { session, config } = await merchantMember(orgId, "configure", headers);
  if (config.environment === "production") return { environment: "production", unchanged: true };
  return atomic(async (tx) => {
    await assertCryptoReady(tx, orgId);
    await tx.merchantConfig.update({ where: { orgId }, data: { environment: "production" } });
    await audit(tx, orgId, session.user.id, "merchant.live.crypto", orgId, { from: config.environment }, true);
    return { environment: "production", unchanged: false };
  });
}
