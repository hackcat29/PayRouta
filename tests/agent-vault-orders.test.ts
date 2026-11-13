// Orders PayRouta signs for agent vaults (lib/agents/vault.ts): the bytes the
// contract verifies, the assets a vault pays with, and amounts in base units.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ed25519 } from "@noble/curves/ed25519";
import bs58 from "bs58";
import { baseUnits, orderDomain, orderPublicKey, signOrder, vaultAsset } from "../lib/agents/vault";

const seed = "11".repeat(32);
const get = async () => seed;
const order = {
  id: "pay_1",
  merchant: "org_harbor",
  merchant_name: "Harbor Audio",
  network: "eip155:8453",
  token: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  pay_to: "0x041bc4514C6FE3D2Da21F1EC025cf4e764381287",
  amount: "20000000",
  expires_at_ms: "1789000000000",
};

test("vault orders: signed over the domain and the order's exact JSON", async () => {
  process.env.PAYROUTA_AGENT_ORDER_KEY_REF = "00000000-0000-0000-0000-000000000000";
  const signed = (await signOrder(order, get))!;
  assert.equal(signed.order, JSON.stringify(order));
  const key = (await orderPublicKey(get))!;
  assert.match(key, /^ed25519:[1-9A-HJ-NP-Za-km-z]{43,44}$/);
  const pub = bs58.decode(key.slice(8));
  assert.ok(ed25519.verify(Buffer.from(signed.signature, "hex"), Buffer.from(orderDomain + signed.order), pub));
  // Any change to the order breaks the signature, as the contract checks.
  const tampered = signed.order.replace("0x041bc4514C6FE3D2Da21F1EC025cf4e764381287", `0x${"66".repeat(20)}`);
  assert.ok(!ed25519.verify(Buffer.from(signed.signature, "hex"), Buffer.from(orderDomain + tampered), pub));
});

test("vault orders: no key configured means no order", async () => {
  delete process.env.PAYROUTA_AGENT_ORDER_KEY_REF;
  assert.equal(await signOrder(order, get), null);
  assert.equal(await orderPublicKey(get), null);
});

test("vault orders: a malformed key is refused", async () => {
  process.env.PAYROUTA_AGENT_ORDER_KEY_REF = "00000000-0000-0000-0000-000000000000";
  await assert.rejects(signOrder(order, async () => "not-hex"), /AGENT_ORDER_KEY_INVALID/);
  delete process.env.PAYROUTA_AGENT_ORDER_KEY_REF;
});

test("vault orders: the assets a vault pays with", () => {
  assert.deepEqual(vaultAsset({ originAsset: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1" }), {
    network: "near:mainnet",
    token: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
    decimals: 6,
  });
  assert.deepEqual(vaultAsset({ originAsset: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near" }), {
    network: "eip155:8453",
    token: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    decimals: 6,
  });
  assert.deepEqual(vaultAsset({ network: "eip155:84532", token: "erc20:0x036cbd53842c5426634e7929541ec2318f3dcf7e" }), {
    network: "eip155:84532",
    token: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
    decimals: 6,
  });
  // Solana isn't an EVM chain or NEAR: no vault order.
  assert.equal(vaultAsset({ originAsset: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near" }), null);
  assert.equal(vaultAsset({ network: "eip155:1", token: "erc20:0x514910771af9ca656af840dff83e8264ecf986ca" }), null);
});

test("vault orders: amounts in base units, never rounded", () => {
  assert.equal(baseUnits("20", 6), "20000000");
  assert.equal(baseUnits("2.000929", 6), "2000929");
  assert.equal(baseUnits("0.1", 6), "100000");
  assert.throws(() => baseUnits("1.0000001", 6), /AGENT_ORDER_AMOUNT_INVALID/);
  assert.throws(() => baseUnits("-1", 6), /AGENT_ORDER_AMOUNT_INVALID/);
});
