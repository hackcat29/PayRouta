// x402 on NEAR (docs/x402.md): the `exact` scheme from the x402 v2 spec
// (specs/schemes/exact/scheme_exact_near.md in x402-foundation/x402).
//
// The buyer signs a NEP-366 SignedDelegateAction for one NEP-141 ft_transfer;
// PayRouta's relayer wraps it in a transaction and pays the gas, so the buyer
// needs no NEAR. Verification and settlement are the x402 Foundation's own
// implementation (@x402/near): signature, exact amount and recipient, the
// access-key nonce and expiry window, a full-access key, balance and storage
// checks, de-duplication, and success only once the inner ft_transfer
// receipt succeeded on chain.
//
// Relayers are configured per network:
//   X402_NEAR_MAINNET_RELAYER / X402_NEAR_MAINNET_RELAYER_KEY_REF
//   X402_NEAR_TESTNET_RELAYER / X402_NEAR_TESTNET_RELAYER_KEY_REF
// The key is a full-access key of the relayer account ("ed25519:…"), held in
// the secret store. Without one, that network isn't offered.
import { x402Facilitator } from "@x402/core/facilitator";
import type { PaymentPayload, PaymentRequirements, SettleResponse, SupportedResponse, VerifyResponse } from "@x402/core/types";
import { createFacilitatorNearSigner, createProviderFactory, type FacilitatorNearSigner } from "@x402/near";
import { ExactNearScheme } from "@x402/near/exact/facilitator";
import { KeyPairSigner } from "@near-js/signers";
import { actionCreators, createTransaction } from "@near-js/transactions";
import { baseDecode } from "@near-js/utils";
import { secretManager } from "../portal/adapters";
import { PortalError } from "../portal/domain";

export type NearNetwork = "near:mainnet" | "near:testnet";
export const networkFor = (environment: string): NearNetwork => (environment === "production" ? "near:mainnet" : "near:testnet");

// USDC issued by Circle on NEAR.
export const usdcOnNear = { "near:mainnet": "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1" } as const;
export const nearExplorer = (network: NearNetwork, tx: string) =>
  `https://${network === "near:testnet" ? "testnet." : ""}nearblocks.io/txns/${tx}`;

// NEP-145 registration, refunded by the token when the account is registered.
const storageDeposit = 1_250_000_000_000_000_000_000n;
const nearAccount = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

type Relayer = { accountId: string; secretKey: `ed25519:${string}` | `secp256k1:${string}` };
export async function relayerFor(network: NearNetwork, get = (ref: string) => secretManager.get(ref)): Promise<Relayer | null> {
  const prefix = network === "near:mainnet" ? "X402_NEAR_MAINNET_RELAYER" : "X402_NEAR_TESTNET_RELAYER";
  const accountId = process.env[prefix]?.trim();
  const ref = process.env[`${prefix}_KEY_REF`]?.trim();
  if (!accountId || !ref || !nearAccount.test(accountId)) return null;
  const secretKey = (await get(ref)).trim();
  if (!/^(ed25519|secp256k1):[1-9A-HJ-NP-Za-km-z]{40,140}$/.test(secretKey)) throw new PortalError("X402_RELAYER_KEY_INVALID", 503);
  return { accountId, secretKey: secretKey as Relayer["secretKey"] };
}

type Facilitator = { facilitator: x402Facilitator; signer: FacilitatorNearSigner; relayer: Relayer };
const facilitators = new Map<NearNetwork, Promise<Facilitator | null>>();

// One facilitator per network for the process: its settlement cache (spec
// §10) must see every settlement this process makes.
export function facilitatorFor(network: NearNetwork): Promise<Facilitator | null> {
  let f = facilitators.get(network);
  if (!f) {
    f = relayerFor(network).then((relayer) => {
      if (!relayer) return null;
      const rpcUrls = { [network]: process.env[network === "near:mainnet" ? "NEAR_RPC_URL" : "NEAR_TESTNET_RPC_URL"] || undefined };
      const signer = createFacilitatorNearSigner({ relayers: [relayer], ...(rpcUrls[network] ? { rpcUrls: rpcUrls as Record<string, string> } : {}) });
      const facilitator = new x402Facilitator().register(network, new ExactNearScheme(signer));
      return { facilitator, signer, relayer };
    });
    f.catch(() => facilitators.delete(network));
    facilitators.set(network, f);
  }
  return f;
}

export async function supported(networks: NearNetwork[]): Promise<SupportedResponse> {
  const kinds: SupportedResponse["kinds"] = [];
  const signers: SupportedResponse["signers"] = {};
  for (const network of networks) {
    const f = await facilitatorFor(network);
    if (!f) continue;
    kinds.push({ x402Version: 2, scheme: "exact", network });
    signers[network] = [f.relayer.accountId];
  }
  return { kinds, extensions: [], signers };
}

function nearRequirement(requirements: PaymentRequirements): NearNetwork {
  if (requirements.scheme !== "exact" || (requirements.network !== "near:mainnet" && requirements.network !== "near:testnet"))
    throw new PortalError("X402_SCHEME_NOT_SUPPORTED", 400);
  return requirements.network;
}

export async function verify(payload: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResponse> {
  const f = await facilitatorFor(nearRequirement(requirements));
  if (!f) throw new PortalError("X402_NETWORK_NOT_CONFIGURED", 503);
  return f.facilitator.verify(payload, requirements);
}

export async function settle(payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResponse> {
  const f = await facilitatorFor(nearRequirement(requirements));
  if (!f) throw new PortalError("X402_NETWORK_NOT_CONFIGURED", 503);
  return f.facilitator.settle(payload, requirements);
}

// Registers `accountId` with the token's storage (NEP-145) from the relayer,
// so a fresh NEAR Intents deposit address can receive it. No-op when it is
// registered already.
export async function ensureStorage(network: NearNetwork, token: string, accountId: string) {
  const f = await facilitatorFor(network);
  if (!f) throw new PortalError("X402_NETWORK_NOT_CONFIGURED", 503);
  const storage = await f.signer.storageBalanceOf({ network, token, accountId });
  if (!storage.supported || storage.registered) return null;
  const provider = createProviderFactory(
    process.env[network === "near:mainnet" ? "NEAR_RPC_URL" : "NEAR_TESTNET_RPC_URL"]
      ? { [network]: process.env[network === "near:mainnet" ? "NEAR_RPC_URL" : "NEAR_TESTNET_RPC_URL"]! }
      : undefined,
  )(network);
  const signer = KeyPairSigner.fromSecretKey(f.relayer.secretKey);
  const publicKey = await signer.getPublicKey();
  const [key, block] = await Promise.all([
    provider.viewAccessKey(f.relayer.accountId, publicKey, { finality: "final" }),
    provider.block({ finality: "final" }),
  ]);
  const tx = createTransaction(
    f.relayer.accountId,
    publicKey,
    token,
    BigInt(key.nonce) + 1n,
    [actionCreators.functionCall("storage_deposit", { account_id: accountId, registration_only: true }, 30_000_000_000_000n, storageDeposit)],
    baseDecode(block.header.hash),
  );
  const [, signed] = await signer.signTransaction(tx);
  const outcome = await provider.sendTransactionUntil(signed, "FINAL");
  const status = outcome.status as { SuccessValue?: string } | string;
  if (typeof status !== "object" || status.SuccessValue === undefined) throw new PortalError("X402_STORAGE_REGISTRATION_FAILED", 502);
  return outcome.transaction_outcome.id;
}
