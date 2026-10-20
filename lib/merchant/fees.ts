// The merchant's default for who pays fees (lib/payments/fee-bearer.ts).
// Each payment can still override it with `feeBearer`.
import { z } from "zod";
import { atomic, audit } from "../portal/service";
import { PortalError } from "../portal/domain";
import { feeBearers } from "../payments/fee-bearer";

const input = z.object({ feeBearer: z.enum(feeBearers) }).strict();

export async function setFeeBearer(scope: { orgId: string; environment: string }, actor: string, raw: unknown) {
  const { feeBearer } = input.parse(raw);
  return atomic(async (tx) => {
    const updated = await tx.merchantConfig.updateMany({ where: scope, data: { feeBearer } });
    if (!updated.count) throw new PortalError("NOT_FOUND", 404);
    await audit(tx, scope.orgId, actor, "merchant.fee-bearer.updated", scope.orgId, {
      environment: scope.environment,
      feeBearer,
    });
    return { feeBearer };
  });
}
