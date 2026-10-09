import { tokenMinor, validTokenAmount } from "./assets";
import { onchainMethod } from "./crypto-assets";
import { db } from "../portal/db";
import { PortalError } from "../portal/domain";
import type { DepositStore, DepositBinding } from "./deposit-types";

// Addresses are consumed forever, even for expired/failed checkouts. Reusing
// one would let a late transfer pay an unrelated customer's invoice.
export function databaseDepositStore(integrationId: string): DepositStore {
  return {
    async claimed(b) {
      const stored = await db.depositBinding.findUniqueOrThrow({
        where: { attemptId: b.attemptId },
      });
      if (
        stored.integrationId !== integrationId ||
        b.integrationId !== integrationId ||
        stored.network !== b.network ||
        stored.address !== b.address ||
        stored.identifier !== b.identifier ||
        stored.attemptKey !== b.attemptKey
      )
        throw new PortalError("DEPOSIT_BINDING_MISMATCH", 409);
      return db.depositClaim.findUnique({ where: { attemptId: b.attemptId } });
    },
    async checkpoint(b) {
      if (b.integrationId !== integrationId)
        throw new PortalError("DEPOSIT_BINDING_MISMATCH", 409);
      const c = await db.depositScan.findUnique({
        where: { attemptId: b.attemptId },
      });
      return {
        nextBlock: c?.nextBlock ?? b.startBlock,
        cursor: c?.cursor ?? null,
      };
    },
    async advanceCheckpoint(b, nextBlock, cursor, expected) {
      if (b.integrationId !== integrationId || nextBlock < b.startBlock)
        throw new PortalError("DEPOSIT_BINDING_MISMATCH", 409);
      await db.depositScan.upsert({
        where: { attemptId: b.attemptId },
        create: {
          attemptId: b.attemptId,
          nextBlock: expected.nextBlock,
          cursor: expected.cursor,
        },
        update: {},
      });
      await db.depositScan.updateMany({
        where: {
          attemptId: b.attemptId,
          nextBlock: expected.nextBlock,
          cursor: expected.cursor,
        },
        data: { nextBlock, cursor },
      });
    },
    async scanStart(b) {
      const stored = await db.depositBinding.findUniqueOrThrow({
        where: { attemptId: b.attemptId },
      });
      if (stored.integrationId !== integrationId)
        throw new PortalError("DEPOSIT_BINDING_MISMATCH", 409);
      return (
        (await db.depositScan.findUnique({ where: { attemptId: b.attemptId } }))
          ?.nextBlock ?? stored.startBlock
      );
    },
    async advanceScan(b, nextBlock) {
      if (b.integrationId !== integrationId || nextBlock < b.startBlock)
        throw new PortalError("DEPOSIT_BINDING_MISMATCH", 409);
      await db.depositScan.upsert({
        where: { attemptId: b.attemptId },
        create: { attemptId: b.attemptId, nextBlock },
        update: {},
      });
      // Concurrent readers can only move the empty finalized checkpoint forward.
      await db.depositScan.updateMany({
        where: { attemptId: b.attemptId, nextBlock: { lt: nextBlock } },
        data: { nextBlock },
      });
    },
    async allocate(input) {
      return db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`deposit:${input.network}`},0))`;
        const attempt = await tx.paymentAttempt.findUniqueOrThrow({
          where: { id: input.attemptId },
          include: { intent: true },
        });
        const integration = await tx.integration.findUniqueOrThrow({
          where: { id: integrationId },
        });
        const asset = attempt.intent.asset as {
          kind?: string;
          network?: string;
          identifier?: string;
        };
        if (
          attempt.integrationId !== integrationId ||
          attempt.key !== input.attemptKey ||
          attempt.environment !== input.environment ||
          integration.environment !== input.environment ||
          integration.orgId !== attempt.providerOrgId ||
          attempt.intent.selectedMethod !==
            onchainMethod(input.network, input.identifier) ||
          asset.kind !== "blockchain" ||
          asset.network !== input.network ||
          asset.identifier !== input.identifier ||
          attempt.intent.amount !== input.amount ||
          attempt.intent.precision !== input.precision
        )
          throw new PortalError("DEPOSIT_BINDING_MISMATCH", 409);
        const old = await tx.depositBinding.findUnique({
          where: { attemptId: input.attemptId },
        });
        if (old) return old;
        const used = await tx.depositBinding.findMany({
          where: { network: input.network, address: { in: input.addresses } },
          select: { address: true },
        });
        const occupied = new Set(used.map((v) => v.address));
        const address = input.addresses.find((v) => !occupied.has(v));
        if (!address)
          throw new PortalError("DEPOSIT_ADDRESS_POOL_EXHAUSTED", 409);
        const { addresses: _, ...data } = input;
        void _;
        return tx.depositBinding.create({
          data: {
            ...data,
            integrationId,
            address,
            acceptBefore:
              onchainMethod(input.network, input.identifier) === "crypto-app"
                ? attempt.intent.expiresAt
                : null,
          },
        });
      });
    },
    async find(attemptId) {
      const b = await db.depositBinding.findUnique({ where: { attemptId } });
      if (b && b.integrationId !== integrationId)
        throw new PortalError("DEPOSIT_BINDING_MISMATCH", 409);
      return b;
    },
    async claim(b: DepositBinding, evidence) {
      if (
        !validTokenAmount(evidence.amount, b.precision) ||
        b.integrationId !== integrationId
      )
        throw new PortalError("DEPOSIT_BINDING_MISMATCH", 409);
      const stored = await db.depositBinding.findUniqueOrThrow({
        where: { attemptId: b.attemptId },
      });
      if (
        stored.integrationId !== integrationId ||
        stored.network !== b.network ||
        stored.identifier !== b.identifier ||
        stored.address !== b.address ||
        stored.attemptKey !== b.attemptKey ||
        tokenMinor(stored.amount, stored.precision) !==
          tokenMinor(evidence.amount, stored.precision)
      )
        throw new PortalError("DEPOSIT_BINDING_MISMATCH", 409);
      const identity = {
        network: b.network,
        txHash: evidence.txHash,
        logIndex: evidence.logIndex,
      };
      const claim = await db.depositClaim.upsert({
        where: { network_txHash_logIndex: identity },
        create: {
          ...identity,
          attemptId: b.attemptId,
          blockHash: evidence.blockHash,
          amount: evidence.amount,
        },
        update: {},
      });
      if (
        claim.attemptId !== b.attemptId ||
        claim.blockHash !== evidence.blockHash ||
        claim.amount !== evidence.amount
      )
        throw new PortalError("DEPOSIT_ALREADY_CLAIMED", 409);
    },
  };
}
