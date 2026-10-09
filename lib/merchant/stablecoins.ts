import { chain } from "../blockchain/chains";
import { depositAdapterKind } from "../blockchain/deposit-config";
import { alchemyReader } from "../blockchain/alchemy-rpc";
import { providerRequest } from "../providers/adapters/http";
import {
  checkStellarNetwork,
  ensureStellarReceivable,
} from "../providers/adapters/native/stellar-deposit";
import { createHash } from "node:crypto";
import { z } from "zod";
import { db } from "../portal/db";
import { atomic, audit, json } from "../portal/service";
import { stepUp, rateLimit } from "../portal/access";
import { secretManager } from "../portal/adapters";
import { PortalError } from "../portal/domain";
import { merchantMember } from "./access";
import { stablecoinDepositConfig as depositConfigSchema } from "../blockchain/deposit-config";
import {
  paymentAsset as tokenAsset,
  cryptoAsset,
} from "../blockchain/crypto-assets";
export const stablecoinSetupInput = z
  .object({
    network: z.string(),
    identifier: z.string(),
    addresses: z.array(z.string()).min(1).max(1000),
    rpcKey: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,200}$/)
      .optional(),
  })
  .strict();
export async function configureStablecoins(
  orgId: string,
  raw: unknown,
  headers: Headers,
  crypto = false,
) {
  const { session, config } = await merchantMember(orgId, "configure", headers);
  await stepUp(headers);
  await rateLimit(`deposit-setup:${orgId}`, 10);
  const input = stablecoinSetupInput.parse(raw),
    publicTestnetRpc =
      config.environment === "sandbox" &&
      input.network === "eip155:84532" &&
      !input.rpcKey &&
      !process.env.ALCHEMY_RPC_KEY_REF;
  if (!!cryptoAsset(input.network, input.identifier) !== crypto)
    throw new PortalError("UNSUPPORTED_PAYMENT_ASSET", 409);
  // Validate the complete configuration before storing any credential.
  const checked = depositConfigSchema.parse({
    mode: "NATIVE",
    adapter: depositAdapterKind(input.network, input.identifier),
    environment: config.environment,
    network: input.network,
    identifier: input.identifier,
    addresses: input.addresses,
    publicRpc:
      process.env.PAYMENT_RPC_MODE === "public" ||
      (!input.rpcKey && !process.env.ALCHEMY_RPC_KEY_REF),
    ...(chain(input.network)?.family === "evm" &&
    !input.identifier.startsWith("native:")
      ? { publicTestnetRpc }
      : {}),
    ...((!publicTestnetRpc || input.identifier.startsWith("native:")) &&
    (input.rpcKey || process.env.ALCHEMY_RPC_KEY_REF)
      ? { rpcKeyRef: "pending" }
      : {}),
  });
  if (chain(input.network)?.family === "stellar") {
    const temporaryRef = input.rpcKey
      ? await secretManager.put(input.rpcKey)
      : process.env.ALCHEMY_RPC_KEY_REF!;
    try {
      const rpc = alchemyReader(
        { network: input.network, rpcKeyRef: temporaryRef },
        { http: providerRequest, credentials: secretManager },
      );
      await checkStellarNetwork(rpc, input.network);
      for (const address of checked.addresses)
        await ensureStellarReceivable(
          rpc,
          address,
          tokenAsset(input.network, input.identifier)!.contractAddress,
          "0",
          tokenAsset(input.network, input.identifier)!.symbol,
        );
    } finally {
      if (input.rpcKey) await secretManager.revoke(temporaryRef);
    }
  }
  const accountId = `wallet-pool-${createHash("sha256")
    .update(
      JSON.stringify([
        orgId,
        checked.network,
        checked.identifier,
        checked.addresses,
      ]),
    )
    .digest("hex")}`;
  const rpcKeyRef = input.rpcKey
    ? await secretManager.put(input.rpcKey)
    : process.env.ALCHEMY_RPC_KEY_REF;
  try {
    return await atomic(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`stablecoins:${orgId}:${config.environment}`},0))`;
      const latest = await tx.integration.findFirst({
        where: { orgId, environment: config.environment },
        orderBy: { version: "desc" },
      });
      const occupied = await tx.depositBinding.count({
        where: { network: checked.network, address: { in: checked.addresses } },
      });
      if (occupied) throw new PortalError("RECEIVE_ADDRESS_ALREADY_USED", 409);
      const integration = await tx.integration.create({
        data: {
          orgId,
          environment: config.environment,
          version: (latest?.version ?? 0) + 1,
          config: json({
            ...checked,
            accountId,
            ...(rpcKeyRef ? { rpcKeyRef } : {}),
          }),
        },
      });
      await audit(
        tx,
        orgId,
        session.user.id,
        crypto
          ? "merchant.crypto.configured"
          : "merchant.stablecoins.configured",
        integration.id,
        {
          environment: config.environment,
          network: checked.network,
          identifier: checked.identifier,
          addressCount: checked.addresses.length,
          accountId,
        },
      );
      return {
        id: integration.id,
        environment: config.environment,
        reviewRequired: config.environment === "production",
      };
    });
  } catch (e) {
    if (input.rpcKey && rpcKeyRef) await secretManager.revoke(rpcKeyRef);
    throw e;
  }
}
export async function stablecoinOverview(orgId: string, environment: string) {
  const integrations = await db.integration.findMany({
    where: { orgId, environment },
    orderBy: { version: "desc" },
  });
  const pools = new Map<
    string,
    {
      id: string;
      symbol: string;
      network: string;
      identifier: string;
      environment: string;
      accountReference: string;
      addresses: Set<string>;
    }
  >();
  for (const i of integrations) {
    const parsed = depositConfigSchema.safeParse(i.config);
    if (!parsed.success || parsed.data.environment !== environment) continue;
    const config = parsed.data,
      key = config.network + "|" + config.identifier;
    let pool = pools.get(key);
    if (!pool) {
      pool = {
        id: i.id,
        symbol: tokenAsset(config.network, config.identifier)!.symbol,
        network: config.network,
        identifier: config.identifier,
        environment,
        accountReference: config.accountId || "",
        addresses: new Set(),
      };
      pools.set(key, pool);
    }
    for (const address of config.addresses) pool.addresses.add(address);
  }
  return Promise.all(
    [...pools.values()].map(async ({ addresses, ...pool }) => {
      const used = await db.depositBinding.count({
        where: { network: pool.network, address: { in: [...addresses] } },
      });
      return { ...pool, remaining: addresses.size - used };
    }),
  );
}
