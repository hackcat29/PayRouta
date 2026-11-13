// x402 on NEAR (lib/x402/near.ts): relayer configuration and what the
// facilitator advertises. The end-to-end payment is npm run demo:x402-near.
import { test } from "node:test";
import assert from "node:assert/strict";
import { nearExplorer, networkFor, relayerFor, supported } from "../lib/x402/near";

const clear = () => {
  for (const k of ["X402_NEAR_MAINNET_RELAYER", "X402_NEAR_MAINNET_RELAYER_KEY_REF", "X402_NEAR_TESTNET_RELAYER", "X402_NEAR_TESTNET_RELAYER_KEY_REF"]) delete process.env[k];
};

test("x402 on NEAR: test-mode keys settle on testnet, live keys on mainnet", () => {
  assert.equal(networkFor("sandbox"), "near:testnet");
  assert.equal(networkFor("production"), "near:mainnet");
  assert.equal(nearExplorer("near:testnet", "abc"), "https://testnet.nearblocks.io/txns/abc");
  assert.equal(nearExplorer("near:mainnet", "abc"), "https://nearblocks.io/txns/abc");
});

test("x402 on NEAR: no relayer configured means the network isn't offered", async () => {
  clear();
  assert.equal(await relayerFor("near:mainnet", async () => "unused"), null);
  assert.deepEqual(await supported(["near:mainnet"]), { kinds: [], extensions: [], signers: {} });
});

test("x402 on NEAR: the relayer's key comes from the secret store and must be a NEAR key", async () => {
  clear();
  process.env.X402_NEAR_TESTNET_RELAYER = "payrouta-relayer.testnet";
  process.env.X402_NEAR_TESTNET_RELAYER_KEY_REF = "00000000-0000-0000-0000-000000000000";
  const key = `ed25519:${"3".repeat(88)}`;
  assert.deepEqual(await relayerFor("near:testnet", async () => `${key}\n`), { accountId: "payrouta-relayer.testnet", secretKey: key });
  await assert.rejects(relayerFor("near:testnet", async () => "0xdeadbeef"), /X402_RELAYER_KEY_INVALID/);
  process.env.X402_NEAR_TESTNET_RELAYER = "Not An Account";
  assert.equal(await relayerFor("near:testnet", async () => key), null);
  clear();
});
