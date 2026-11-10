// Settle crypto checkouts straight to an address on any chain NEAR Intents
// delivers to (near-intents-address): the merchant picks a stablecoin and
// chain (USDT on Tron, USDC on Solana, USDT on TON...) and gives their
// address twice. Only one direct settlement is on at a time: turning this on
// turns settling to the bank off, and the other way round.
import { z } from "zod";
import { db } from "../portal/db";
import { atomic, audit, json } from "../portal/service";
import { PortalError } from "../portal/domain";
import { rateLimit, stepUp } from "../portal/access";
import { merchantMember } from "../merchant/access";
import { providerRequest } from "../providers/adapters/http";
import { addressConfigSchema, settlementAddress } from "../providers/adapters/native/near-intents-address";
import { usdcBase } from "../providers/adapters/native/near-intents-offramp";
import { chainNames, tokens, type Http } from "./oneclick";
import { solanaOwner } from "./near";

// The stablecoins NEAR Intents delivers, on every chain it lists them.
export async function settlementAssets(http: Http = providerRequest) {
  const list = await tokens(http, Date.now());
  return list
    .filter((t) => t.symbol === "USDC" || t.symbol === "USDT")
    .map((t) => ({
      assetId: t.assetId,
      blockchain: t.blockchain,
      chainName: chainNames[t.blockchain] ?? t.blockchain.toUpperCase(),
      symbol: t.symbol as "USDC" | "USDT",
      decimals: t.decimals,
      contract: t.contractAddress ?? null,
    }))
    .sort((a, b) => a.chainName.localeCompare(b.chainName) || a.symbol.localeCompare(b.symbol));
}

// A check of the address's shape where the chain's is well known; 1Click
// refuses any other mismatch when it quotes.
export function addressFits(blockchain: string, address: string) {
  if (!settlementAddress.safeParse(address).success) return false;
  const evm = ["eth", "base", "arb", "op", "pol", "avax", "bsc", "gnosis", "scroll", "bera", "xlayer", "abs"];
  if (evm.includes(blockchain)) return /^0x[0-9a-fA-F]{40}$/.test(address);
  if (blockchain === "sol") return !!solanaOwner(address);
  if (blockchain === "tron") return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address);
  if (blockchain === "stellar") return /^G[A-Z2-7]{55}$/.test(address);
  if (blockchain === "near") return /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(address) && address.length >= 2 && address.length <= 64;
  if (blockchain === "ton") return /^(?:[EU]Q[A-Za-z0-9_-]{46}|-?\d:[0-9a-fA-F]{64})$/.test(address);
  return true;
}

const setInput = z
  .object({ assetId: z.string().min(3).max(300), address: settlementAddress, confirm: z.string().trim().max(140) })
  .strict();

export async function setSettlementAddress(orgId: string, raw: unknown, headers: Headers, http: Http = providerRequest) {
  const { session, config } = await merchantMember(orgId, "configure", headers);
  await stepUp(headers);
  await rateLimit(`settlement-address:${orgId}`, 10);
  if (config.environment !== "production") throw new PortalError("CROSS_CHAIN_LIVE_ONLY", 409);
  const input = setInput.parse(raw);
  if (input.address !== input.confirm) throw new PortalError("SETTLEMENT_ADDRESS_MISMATCH", 400);
  const asset = (await settlementAssets(http)).find((a) => a.assetId === input.assetId);
  if (!asset) throw new PortalError("UNSUPPORTED_PAYMENT_ASSET", 409);
  if (!addressFits(asset.blockchain, input.address)) throw new PortalError("SETTLEMENT_ADDRESS_INVALID", 400);
  const environment = config.environment;
  return atomic(async (tx) => {
    const data = {
      assetId: asset.assetId,
      blockchain: asset.blockchain,
      symbol: asset.symbol,
      decimals: asset.decimals,
      contract: asset.contract,
      address: input.address,
      active: true,
      createdBy: session.user.id,
    };
    const saved = await tx.settlementAddress.upsert({
      where: { orgId_environment: { orgId, environment } },
      create: { orgId, environment, ...data },
      update: data,
    });
    // One direct settlement at a time.
    await tx.fiatPayoutAccount.updateMany({ where: { orgId, environment }, data: { settleCheckouts: false } });
    const integrations = await tx.integration.findMany({ where: { orgId, environment }, orderBy: { version: "desc" } });
    const exists = integrations.some((i) => {
      const c = addressConfigSchema.safeParse(i.config);
      return c.success && c.data.settlementAddressId === saved.id && c.data.address === saved.address && c.data.destination.assetId === saved.assetId;
    });
    if (!exists)
      await tx.integration.create({
        data: {
          orgId,
          environment,
          version: (integrations[0]?.version ?? 0) + 1,
          config: json(
            addressConfigSchema.parse({
              mode: "NATIVE",
              adapter: "near-intents-address",
              environment,
              ...usdcBase,
              settlementAddressId: saved.id,
              destination: { assetId: saved.assetId, blockchain: saved.blockchain, symbol: saved.symbol, decimals: saved.decimals, contract: saved.contract },
              address: saved.address,
              accountId: `address-${saved.id}`,
            }),
          ),
        },
      });
    await audit(tx, orgId, session.user.id, "merchant.settlement.address_set", saved.id, { assetId: saved.assetId, blockchain: saved.blockchain, address: saved.address });
    return { settlementAddress: present(saved) };
  });
}

export async function stopSettlementAddress(orgId: string, headers: Headers) {
  const { session, config } = await merchantMember(orgId, "configure", headers);
  await stepUp(headers);
  return atomic(async (tx) => {
    await tx.settlementAddress.updateMany({ where: { orgId, environment: config.environment }, data: { active: false } });
    await audit(tx, orgId, session.user.id, "merchant.settlement.address_stopped", orgId, {});
    return { settlementAddress: null };
  });
}

function present(s: { assetId: string; blockchain: string; symbol: string; address: string; active: boolean }) {
  return {
    assetId: s.assetId,
    symbol: s.symbol,
    chainName: chainNames[s.blockchain] ?? s.blockchain.toUpperCase(),
    address: s.address,
    active: s.active,
  };
}

export async function settlementAddressView(orgId: string, environment: string) {
  const s = await db.settlementAddress.findUnique({ where: { orgId_environment: { orgId, environment } } });
  return s ? present(s) : null;
}
