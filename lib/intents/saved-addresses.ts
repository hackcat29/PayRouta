// Addresses a merchant sends to from their NEAR Intents wallet: their
// exchange or other wallets, any token on any chain 1Click lists. Saving
// one asks you to confirm it's you; every send is still signed in the
// merchant's own wallet (lib/intents/payouts.ts).
import { z } from "zod";
import { db } from "../portal/db";
import { atomic, audit } from "../portal/service";
import { PortalError } from "../portal/domain";
import { rateLimit, stepUp } from "../portal/access";
import { merchantMember } from "../merchant/access";
import { providerRequest } from "../providers/adapters/http";
import { chainNames, tokens, type Http } from "./oneclick";
import { addressFits } from "./settlement-address";
import { memoChains } from "./memo-chains";
import { settlementAddress } from "../providers/adapters/native/near-intents-address";


const addInput = z
  .object({
    label: z.string().trim().min(1).max(60),
    assetId: z.string().min(3).max(300),
    address: settlementAddress,
    confirm: z.string().trim().max(140),
  })
  .strict();

function present(a: { id: string; label: string; assetId: string; blockchain: string; symbol: string; address: string }) {
  return {
    id: a.id,
    label: a.label,
    assetId: a.assetId,
    chain: a.blockchain,
    chainName: chainNames[a.blockchain] ?? a.blockchain.toUpperCase(),
    symbol: a.symbol,
    address: a.address,
    memoChain: memoChains.has(a.blockchain),
  };
}
export type SavedAddressView = ReturnType<typeof present>;

export async function savedAddresses(orgId: string, environment: string) {
  const rows = await db.savedAddress.findMany({ where: { orgId, environment }, orderBy: { createdAt: "desc" }, take: 50 });
  return rows.map(present);
}

export async function addSavedAddress(orgId: string, raw: unknown, headers: Headers, http: Http = providerRequest) {
  const { session, config } = await merchantMember(orgId, "configure", headers);
  await stepUp(headers);
  await rateLimit(`saved-address:${orgId}`, 20);
  if (config.environment !== "production") throw new PortalError("CROSS_CHAIN_LIVE_ONLY", 409);
  const input = addInput.parse(raw);
  if (input.address !== input.confirm) throw new PortalError("SETTLEMENT_ADDRESS_MISMATCH", 400);
  const token = (await tokens(http, Date.now())).find((t) => t.assetId === input.assetId);
  if (!token) throw new PortalError("UNSUPPORTED_PAYMENT_ASSET", 409);
  if (!addressFits(token.blockchain, input.address)) throw new PortalError("SETTLEMENT_ADDRESS_INVALID", 400);
  if ((await db.savedAddress.count({ where: { orgId, environment: config.environment } })) >= 50) throw new PortalError("SAVED_ADDRESSES_FULL", 409);
  return atomic(async (tx) => {
    const saved = await tx.savedAddress.create({
      data: {
        orgId,
        environment: config.environment,
        label: input.label,
        assetId: token.assetId,
        blockchain: token.blockchain,
        symbol: token.symbol,
        address: input.address,
        createdBy: session.user.id,
      },
    });
    await audit(tx, orgId, session.user.id, "merchant.intents.address_saved", saved.id, { assetId: saved.assetId, address: saved.address });
    return { address: present(saved) };
  });
}

export async function removeSavedAddress(orgId: string, raw: unknown, headers: Headers) {
  const { session, config } = await merchantMember(orgId, "configure", headers);
  const { id } = z.object({ id: z.string().min(1).max(100) }).strict().parse(raw);
  return atomic(async (tx) => {
    const removed = await tx.savedAddress.deleteMany({ where: { id, orgId, environment: config.environment } });
    if (!removed.count) throw new PortalError("NOT_FOUND", 404);
    await audit(tx, orgId, session.user.id, "merchant.intents.address_removed", id, {});
    return { ok: true };
  });
}
