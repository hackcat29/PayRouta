// The CoinGecko key is sent as a header. A stored key with a line break (a
// pasted second line) made Node refuse the price request, and every crypto
// checkout answered 503. An unusable key is now left out with a warning.
import { test } from "node:test";
import assert from "node:assert/strict";
import { coinGeckoKey } from "../lib/payments/crypto-prices";

const withRef = async (ref: string | undefined, run: () => Promise<void>) => {
  const old = process.env.COINGECKO_API_KEY_REF;
  if (ref === undefined) delete process.env.COINGECKO_API_KEY_REF;
  else process.env.COINGECKO_API_KEY_REF = ref;
  try {
    await run();
  } finally {
    if (old === undefined) delete process.env.COINGECKO_API_KEY_REF;
    else process.env.COINGECKO_API_KEY_REF = old;
  }
};
const quiet = async (run: () => Promise<void>) => {
  const error = console.error;
  console.error = () => {};
  try {
    await run();
  } finally {
    console.error = error;
  }
};

test("coingecko key: none configured means the keyless API", () =>
  withRef(undefined, async () => {
    assert.equal(await coinGeckoKey(async () => assert.fail("not read")), undefined);
  }));

test("coingecko key: surrounding whitespace is trimmed", () =>
  withRef("00000000-0000-0000-0000-000000000001", async () => {
    assert.equal(await coinGeckoKey(async () => "  CG-abc123\r\n"), "CG-abc123");
  }));

test("coingecko key: a key a header can't carry, or can't be read, is left out", () =>
  quiet(async () => {
    for (const [i, stored] of [
      "CG-abc\nCOINGECKO_API_PLAN=demo",
      "CG-abc 123",
      "CG-ab​c",
    ].entries())
      await withRef(`00000000-0000-0000-0000-00000000001${i}`, async () => {
        assert.equal(await coinGeckoKey(async () => stored), undefined, JSON.stringify(stored));
      });
    await withRef("00000000-0000-0000-0000-000000000020", async () => {
      assert.equal(await coinGeckoKey(async () => { throw new Error("Secret is unavailable or revoked"); }), undefined);
    });
  }));
