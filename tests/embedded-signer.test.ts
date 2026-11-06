import { test } from "node:test";
import assert from "node:assert/strict";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import {
  embeddedEvmSigner,
  type EmbeddedWallet,
} from "../lib/blockchain/embedded-signer";
import { signText } from "../app/merchant/[[...path]]/intents-wallet";
import { erc191Signer } from "../lib/intents/verify";
import { secp256k1Signature } from "../lib/intents/signing";

const address = `0x${"a".repeat(40)}`;
function wallet(overrides: Partial<EmbeddedWallet> = {}): EmbeddedWallet {
  return {
    address,
    walletClientType: "privy-v2",
    getEthereumProvider: async () => ({ request: async () => [address] }),
    ...overrides,
  };
}

test("embedded signer requires a current authenticated session and the exact saved wallet", async () => {
  const never = wallet({
    getEthereumProvider: async () => {
      throw new Error("must not access a provider");
    },
  });
  assert.equal(await embeddedEvmSigner(false, true, [never], address), null);
  assert.equal(await embeddedEvmSigner(true, false, [never], address), null);
  assert.equal(
    await embeddedEvmSigner(true, true, [never], `0x${"b".repeat(40)}`),
    null,
  );
  assert.equal(await embeddedEvmSigner(true, true, [never], "shop.near"), null);
  assert.equal(
    await embeddedEvmSigner(
      true,
      true,
      [wallet({ walletClientType: "metamask" })],
      address,
    ),
    null,
  );
  const result = await embeddedEvmSigner(
    true,
    true,
    [
      never,
      wallet({
        address: `0x${"b".repeat(40)}`,
        getEthereumProvider: async () => ({
          request: async () => [`0x${"b".repeat(40)}`],
        }),
      }),
    ],
    `0x${"B".repeat(40)}`,
  );
  assert.equal(result?.accountId, `0x${"b".repeat(40)}`);
});

test("embedded signer rejects provider/account changes and signing cancellations propagate", async () => {
  await assert.rejects(
    embeddedEvmSigner(
      true,
      true,
      [
        wallet({
          getEthereumProvider: async () => ({
            request: async () => [`0x${"b".repeat(40)}`],
          }),
        }),
      ],
      address,
    ),
    /wallet changed/,
  );
  const signer = await embeddedEvmSigner(
    true,
    true,
    [
      wallet({
        getEthereumProvider: async () => ({
          request: async ({ method }) => {
            if (method === "eth_requestAccounts") return [address];
            throw new Error("User rejected signature");
          },
        }),
      }),
    ],
    address,
  );
  await assert.rejects(
    signText(signer!, "challenge", { nonce: "", recipient: "" }),
    /User rejected/,
  );
  assert.equal(await embeddedEvmSigner(false, true, [wallet()], address), null);
});

test("Privy-style personal_sign works with PayRouta's server ownership verifier", async () => {
  const secret = secp256k1.utils.randomPrivateKey();
  const address = `0x${Buffer.from(keccak_256(secp256k1.getPublicKey(secret, false).slice(1)).slice(-20)).toString("hex")}`;
  const message =
    "PayRouta: settle crypto payments for Test Business.\nNonce: unique-challenge";
  const signer = await embeddedEvmSigner(
    true,
    true,
    [
      wallet({
        address,
        getEthereumProvider: async () => ({
          request: async ({ method, params }) => {
            if (method === "eth_requestAccounts") return [address];
            assert.equal(method, "personal_sign");
            assert.equal(params?.[1], address);
            const body = Buffer.from(String(params![0]).slice(2), "hex");
            assert.equal(body.toString(), message);
            const digest = keccak_256(
              Buffer.concat([
                Buffer.from(`\x19Ethereum Signed Message:\n${body.length}`),
                body,
              ]),
            );
            const signed = secp256k1.sign(digest, secret);
            return `0x${signed.toCompactHex()}${(signed.recovery + 27).toString(16)}`;
          },
        }),
      }),
    ],
    address,
  );
  const proof = await signText(signer!, message, { nonce: "", recipient: "" });
  assert.equal(
    erc191Signer(message, secp256k1Signature(proof.signature)),
    address,
  );
  assert.notEqual(
    erc191Signer(`${message} changed`, secp256k1Signature(proof.signature)),
    address,
  );
});
