import { isTestnet } from "../blockchain/chains";
export { enabledLaunchMethods, comingSoonMethods } from "./launch-catalog";
import { paymentAsset as tokenAsset } from "../blockchain/crypto-assets";
import { PortalError } from "../portal/domain";
// Legacy regression tests may exercise adapters in an isolated local test process.
// This switch cannot open methods in a Next development or production server.
export function enforceLaunchScope() {
  return !(
    process.env.NODE_ENV === "test" &&
    process.env.PORTAL_MODE === "local" &&
    process.env.PAYMENT_TEST_LEGACY_METHODS === "enabled"
  );
}
export function assertLaunchMethod(method: string) {
  if (enforceLaunchScope() && !["stablecoin", "crypto-app"].includes(method))
    throw new PortalError("PAYMENT_METHOD_COMING_SOON", 409);
}
export function assertLaunchAsset(
  asset: { kind: string; identifier: string; network: string },
  precision: number,
  environment: string,
) {
  if (!enforceLaunchScope()) return;
  const token = tokenAsset(asset.network, asset.identifier);
  const testnet = isTestnet(asset.network);
  if (
    asset.kind !== "blockchain" ||
    !token ||
    token.decimals !== precision ||
    testnet !== (environment === "sandbox")
  )
    throw new PortalError("STABLECOIN_ASSET_OR_NETWORK_NOT_SUPPORTED", 409);
}
