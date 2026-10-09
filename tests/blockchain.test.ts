import test from "node:test";
import assert from "node:assert/strict";
import { chain } from "../lib/blockchain/chains";
import {
  tokenAsset,
  isSupportedToken,
  validTokenAmount,
  tokenMinor,
} from "../lib/blockchain/assets";
import {
  confirmationsForFinality,
  isFinal,
  reorgSafe,
  mapReceiptState,
} from "../lib/blockchain/finality";
import { JsonRpcHttpProvider, RpcFailoverProvider } from "../lib/blockchain/rpc";
import {
  validatePaymentAddress,
  validateTokenAmount,
  observePayment,
} from "../lib/blockchain/payments";

const baseUsdc = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

test("chain and asset registries are addressable and validated", () => {
  assert.equal(chain("eip155:8453")?.name, "Base");
  assert.equal(chain("eip155:1")?.confirmationsForFinality, 12);
  assert.equal(
    tokenAsset("eip155:8453", `erc20:${baseUsdc}`)?.symbol,
    "USDC",
  );
  assert.equal(isSupportedToken("eip155:8453", `erc20:${baseUsdc}`), true);
  assert.equal(isSupportedToken("eip155:999", "erc20:x"), false);
  assert.equal(validTokenAmount("1.5", 6), true);
  assert.equal(validTokenAmount("1.1234567", 6), false);
  assert.equal(tokenMinor("1.5", 6), 1500000n);
});

test("finality and reorg safety map on-chain receipts to the payment lifecycle", () => {
  assert.equal(confirmationsForFinality("eip155:8453"), 1);
  assert.equal(isFinal("eip155:8453", 1), true);
  assert.equal(isFinal("eip155:1", 1), false);
  assert.equal(reorgSafe("eip155:8453", 1), true);
  assert.equal(
    mapReceiptState("eip155:8453", {
      txHash: "0x1",
      blockNumber: 8,
      status: "success",
      confirmations: 9,
    }),
    "Confirmed",
  );
  assert.equal(
    mapReceiptState("eip155:1", {
      txHash: "0x1",
      blockNumber: 8,
      status: "success",
      confirmations: 9,
    }),
    "Pending",
  );
  assert.equal(mapReceiptState("eip155:8453", null), "Pending");
});

test("JSON-RPC provider parses hex and computes confirmations", async () => {
  const rpc = new JsonRpcHttpProvider(
    "test",
    () => "https://rpc.example.test",
    async (_url, options) => {
      const req = JSON.parse(options.body) as { id: number; method: string };
      const result =
        req.method === "eth_blockNumber"
          ? "0x10"
          : { blockNumber: "0x8", status: "0x1", transactionHash: "0xabc" };
      return {
        status: 200,
        headers: {},
        body: JSON.stringify({ jsonrpc: "2.0", id: req.id, result }),
      };
    },
  );
  assert.equal(await rpc.getBlockNumber("eip155:8453"), 16);
  const receipt = await rpc.getTransactionReceipt("eip155:8453", "0xabc");
  assert.equal(receipt?.status, "success");
  assert.equal(receipt?.confirmations, 9);
});

test("RPC failover uses the first healthy provider", async () => {
  const failing = new JsonRpcHttpProvider(
    "failing",
    () => "https://rpc-fail.example.test",
    async () => ({ status: 503, headers: {}, body: "{}" }),
  );
  const ok = new JsonRpcHttpProvider(
    "ok",
    () => "https://rpc-ok.example.test",
    async (_url, options) => {
      const req = JSON.parse(options.body) as { id: number };
      return {
        status: 200,
        headers: {},
        body: JSON.stringify({ jsonrpc: "2.0", id: req.id, result: "0x7" }),
      };
    },
  );
  const failover = new RpcFailoverProvider([failing, ok]);
  assert.equal(await failover.getBlockNumber("eip155:8453"), 7);
});

test("payment address and token amount validation are fail-closed", () => {
  assert.throws(() => validatePaymentAddress("eip155:8453", "not-an-address"));
  validatePaymentAddress("eip155:8453", `0x${"a".repeat(40)}`);
  assert.equal(
    validateTokenAmount("eip155:8453", `erc20:${baseUsdc}`, "1.5"),
    1500000n,
  );
  assert.throws(() =>
    validateTokenAmount("eip155:8453", "erc20:unknown", "1.5"),
  );
  assert.throws(() =>
    validateTokenAmount("eip155:8453", `erc20:${baseUsdc}`, "1.1234567"),
  );
});

test("observePayment maps an observed transaction into the normalized lifecycle", async () => {
  const rpc = {
    id: "mock",
    async getBlockNumber() {
      return 10;
    },
    async getTransactionReceipt() {
      return {
        txHash: "0xabc",
        blockNumber: 9,
        status: "success" as const,
        confirmations: 2,
      };
    },
  };
  const result = await observePayment(rpc, "eip155:8453", "0xabc");
  assert.equal(result.state, "Confirmed");
  assert.equal(result.final, true);
});

test("observePayment is final only at the chain's finality depth", async () => {
  const { observePayment } = await import("../lib/blockchain/payments");
  const rpc = (confirmations: number) =>
    ({
      async getTransactionReceipt() {
        return { status: "success", confirmations };
      },
    }) as never;
  const early = await observePayment(rpc(1), "eip155:1", "0xabc");
  assert.equal(early.final, false, "1 of 12 Ethereum confirmations is not final");
  assert.equal(early.state, "Pending");
  const done = await observePayment(rpc(12), "eip155:1", "0xabc");
  assert.equal(done.final, true);
  assert.equal((await observePayment(rpc(1), "eip155:8453", "0xabc")).final, true);
});
