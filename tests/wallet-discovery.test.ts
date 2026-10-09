import { test } from "node:test";
import assert from "node:assert/strict";
import {
  discoverEvmWallets,
  type DiscoveredWallet,
} from "../lib/blockchain/wallet-discovery";
const wallet = (flags = {}) => ({
  ...flags,
  request: async () => {
    throw new Error("Discovery must not connect accounts");
  },
});
const announce = (
  host: EventTarget,
  provider: unknown,
  name: string,
  uuid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
) =>
  host.dispatchEvent(
    new CustomEvent("eip6963:announceProvider", {
      detail: {
        provider,
        info: {
          name,
          uuid,
          rdns: "example.wallet",
          icon: "javascript:invalid",
        },
      },
    }),
  );
test("wallet discovery exposes independent providers without connecting and handles late announcements", async () => {
  const phantom = wallet({ isPhantom: true }),
    metamask = wallet({ isMetaMask: true });
  const host = Object.assign(new EventTarget(), { ethereum: phantom });
  let current: DiscoveredWallet[] = [];
  const stop = discoverEvmWallets(host, (choices) => {
    current = choices;
  });
  await Promise.resolve();
  assert.equal(current[0].name, "Phantom");
  announce(host, metamask, "MetaMask");
  announce(host, phantom, "Phantom", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
  announce(host, metamask, "MetaMask");
  assert.equal(current.length, 2);
  assert.equal(current.find((w) => w.name === "MetaMask")?.provider, metamask);
  assert.equal(current.find((w) => w.name === "Phantom")?.provider, phantom);
  const previous = current;
  stop();
  announce(host, wallet(), "New wallet");
  assert.equal(current, previous);
});
test("legacy multi-wallet injection excludes the ambiguous aggregate and ignores invalid announcements", async () => {
  const a = wallet({ isRabby: true }),
    b = wallet({ isCoinbaseWallet: true });
  const host = Object.assign(new EventTarget(), {
    ethereum: { ...wallet(), providers: [a, b, a] },
  });
  let current: DiscoveredWallet[] = [];
  const stop = discoverEvmWallets(host, (choices) => {
    current = choices;
  });
  announce(host, {}, "Invalid");
  announce(host, wallet(), "Invalid UUID", "bad");
  await Promise.resolve();
  assert.deepEqual(
    current.map((w) => w.name),
    ["Rabby", "Coinbase Wallet"],
  );
  stop();
});
