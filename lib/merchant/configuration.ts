import { snapshotFees } from "../payments/pricing";
import { stablecoinOverview } from "./stablecoins";
import { intentsSettlementAssets } from "../intents/account";
import { isTestnet } from "../blockchain/chains";
import { tokenAssets } from "../blockchain/assets";
import { cryptoAssets, onchainMethod } from "../blockchain/crypto-assets";
import { db } from "../portal/db";
import { enabledLaunchMethods, comingSoonMethods } from "../payments/launch";
import { stablecoinCandidates } from "../payments/stablecoin-routes";
import { PortalError } from "../portal/domain";
import { storedLiveScope, scopeReviewCurrent } from "./live-scope";
import { cryptoBlockers, cryptoMethods } from "./go-live";
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
  // Live crypto needs no review (lib/merchant/go-live.ts).
  const cryptoReasons =
    environment === "production" ? await cryptoBlockers(db, orgId) : [];
  const methods =
    environment === "sandbox"
      ? [...enabledLaunchMethods]
      : cryptoReasons.length
        ? []
        : [...cryptoMethods];
  const [candidates, pools, intents] = await Promise.all([
    stablecoinCandidates(orgId, environment),
    stablecoinOverview(orgId, environment),
    intentsSettlementAssets(orgId, environment),
  ]);
  let commonReason: string | null = policy.paused ? "PROCESSING_PAUSED" : null;
  if (environment === "production" && !commonReason && cryptoReasons.length)
    commonReason = cryptoReasons[0];
  const allAssets = [...tokenAssets, ...cryptoAssets]
    .filter((token) => isTestnet(token.network) === (environment === "sandbox"))
    .map((token) => {
      const matching = pools.filter(
        (p) => p.network === token.network && p.identifier === token.identifier,
      );
      // A receive-address pool, or settlement into the connected NEAR
      // Intents account.
      const configured =
        matching.length > 0 ||
        intents.has(`${token.network}|${token.identifier}`);
      const eligible = candidates.some(
        (c) =>
          c.asset.network === token.network &&
          c.asset.identifier === token.identifier,
      );
      let reason =
        (policy.blockedMethods.includes(
          onchainMethod(token.network, token.identifier),
        )
          ? "METHOD_BLOCKED"
          : commonReason) ??
        (!configured
          ? "RECEIVE_ADDRESSES_REQUIRED"
          : !eligible
            ? "RECEIVE_POOL_OR_SCOPE_UNAVAILABLE"
            : null);
      // A receive-address pool needs a fee schedule for the asset. Settlement
      // into a NEAR Intents account doesn't: each crypto quote values its own
      // fee (lib/payments/crypto-prices.ts) and 1Click withholds it at source.
      if (
        !reason &&
        environment === "production" &&
        onchainMethod(token.network, token.identifier) === "stablecoin" &&
        !intents.has(`${token.network}|${token.identifier}`)
      ) {
        try {
          snapshotFees(
            {
              orgId,
              environment,
              asset: {
                kind: "blockchain",
                network: token.network,
                identifier: token.identifier,
              },
              precision: token.decimals,
            },
            new Date(),
          );
        } catch {
          reason = "ASSET_FEE_VALUATION_REQUIRED";
        }
      }
      return {
        network: token.network,
        identifier: token.identifier,
        symbol: token.symbol,
        decimals: token.decimals,
        configured,
        executionEnabled: !reason,
        reason,
      };
    });
  const stablecoinAssets = allAssets.filter(
    (a) => onchainMethod(a.network, a.identifier) === "stablecoin",
  );
  const cryptoPaymentAssets = allAssets.filter(
    (a) => onchainMethod(a.network, a.identifier) === "crypto-app",
  );
  const liveExecutionEnabled =
    environment === "production" && allAssets.some((a) => a.executionEnabled);
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
          additionalAssets: scope.data.input.additionalAssets,
          settlementAsset: scope.data.input.settlementAsset,
          maximumMinor: scope.data.input.maximumMinor,
          dailyMaximumMinor: scope.data.input.dailyMaximumMinor,
          nextReviewAt: scope.data.input.nextReviewAt,
        }
      : null,
    comingSoonMethods,
    stablecoinAssets,
    cryptoAssets: cryptoPaymentAssets,
    liveExecutionEnabled,
  };
}
