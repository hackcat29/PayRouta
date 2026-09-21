import { db } from "../portal/db";
import { PortalError, methodRails } from "../portal/domain";
import { storedLiveScope, scopeReviewCurrent } from "./live-scope";
import { riskPolicySchema } from "./policy";
export async function merchantConfiguration(
  orgId: string,
  environment: string,
) {
  const config = await db.merchantConfig.findUniqueOrThrow({
    where: { orgId },
  });
  if (config.environment !== environment)
    throw new PortalError("ENVIRONMENT_MISMATCH", 403);
  const policy = riskPolicySchema.parse(config.riskPolicy);
  const scope = storedLiveScope.safeParse(config.liveScope);
  const reviewed = scope.success && scopeReviewCurrent(config.liveScope);
  const methods =
    environment === "sandbox"
      ? Object.keys(methodRails)
      : reviewed
        ? scope.data.input.methods
        : [];
  return {
    environment: config.environment,
    country: config.country,
    returnOrigin: config.returnOrigin,
    applicationState: config.applicationState,
    executionPaused: policy.paused,
    permittedMethods: methods.filter((m) => !policy.blockedMethods.includes(m)),
    limits: policy.limits.map((l) => ({
      asset: l.asset,
      maximumMinor: l.maximum,
      dailyMaximumMinor: l.dailyMaximum,
    })),
    liveScope: scope.success
      ? {
          status: scope.data.status,
          reviewCurrent: !!reviewed,
          merchantCountry: scope.data.input.merchantCountry,
          payerCountries: scope.data.input.payerCountries,
          methods: scope.data.input.methods,
          asset: scope.data.input.asset,
          settlementAsset: scope.data.input.settlementAsset,
          maximumMinor: scope.data.input.maximumMinor,
          dailyMaximumMinor: scope.data.input.dailyMaximumMinor,
          nextReviewAt: scope.data.input.nextReviewAt,
        }
      : null,
    liveExecutionEnabled: false,
  };
}
