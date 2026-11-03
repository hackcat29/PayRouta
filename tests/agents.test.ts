// Agentic payments (docs/agents.md, docs/mcp.md): agent key limits and the
// MCP server's protocol handling, without a database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkPolicy, periodStart } from "../lib/agents/keys";
import { handleMcp, type McpContext } from "../lib/mcp/server";
import { PortalError } from "../lib/portal/domain";

test("agent budgets reset each UTC day, Monday-start week and month", () => {
  const now = new Date("2026-10-31T15:20:00Z"); // a Saturday
  assert.equal(periodStart("day", now).toISOString(), "2026-10-31T00:00:00.000Z");
  assert.equal(periodStart("week", now).toISOString(), "2026-10-26T00:00:00.000Z");
  assert.equal(periodStart("month", now).toISOString(), "2026-10-01T00:00:00.000Z");
  assert.equal(periodStart("week", new Date("2026-10-26T00:00:00Z")).toISOString(), "2026-10-26T00:00:00.000Z");
});

test("an agent key pays only within its limits", () => {
  const policy = { budgetMinor: 50000n, perPaymentMinor: 10000n, merchants: ["org_shop"], payer: "agent.near" };
  const ok = { merchant: "org_shop", amountMinor: 9000n, payer: "agent.near", spentMinor: 40000n };
  checkPolicy(policy, ok);
  assert.throws(() => checkPolicy(policy, { ...ok, merchant: "org_other" }), /AGENT_MERCHANT_NOT_ALLOWED/);
  assert.throws(() => checkPolicy(policy, { ...ok, payer: "someone.near" }), /AGENT_PAYER_NOT_ALLOWED/);
  assert.throws(() => checkPolicy(policy, { ...ok, amountMinor: 10001n }), /AGENT_PAYMENT_OVER_LIMIT/);
  assert.throws(() => checkPolicy(policy, { ...ok, spentMinor: 41001n }), /AGENT_BUDGET_EXCEEDED/);
  // No merchant list: any merchant.
  checkPolicy({ ...policy, merchants: [] }, { ...ok, merchant: "org_other" });
});

const ctx = (authorize: McpContext["authorize"] = async () => ({ orgId: "org", environment: "sandbox", keyId: "key" })): McpContext => ({
  authorize,
  origin: "https://payrouta.test",
});
const call = (method: string, params?: object) => ({ jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) });

test("MCP: initialize negotiates the protocol version; notifications get no answer", async () => {
  const init = (await handleMcp(call("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } }), ctx())) as {
    result: { protocolVersion: string; serverInfo: { name: string }; capabilities: object };
  };
  assert.equal(init.result.protocolVersion, "2025-03-26");
  assert.equal(init.result.serverInfo.name, "payrouta");
  assert.deepEqual(init.result.capabilities, { tools: { listChanged: false } });
  const latest = (await handleMcp(call("initialize", { protocolVersion: "1999-01-01" }), ctx())) as { result: { protocolVersion: string } };
  assert.equal(latest.result.protocolVersion, "2025-06-18");
  assert.equal(await handleMcp({ jsonrpc: "2.0", method: "notifications/initialized" }, ctx()), null);
  assert.deepEqual(await handleMcp(call("ping"), ctx()), { jsonrpc: "2.0", id: 1, result: {} });
  assert.equal(((await handleMcp(call("resources/list"), ctx())) as { error: { code: number } }).error.code, -32601);
  assert.equal(((await handleMcp({ hello: 1 }, ctx())) as { error: { code: number } }).error.code, -32600);
});

test("MCP: tools describe their input; refunds are marked destructive", async () => {
  const list = (await handleMcp(call("tools/list"), ctx())) as {
    result: { tools: { name: string; inputSchema: { type: string; properties: object }; annotations: { destructiveHint: boolean; readOnlyHint: boolean } }[] };
  };
  const names = list.result.tools.map((t) => t.name);
  assert.deepEqual(names, [
    "create_checkout",
    "create_payment_link",
    "list_payment_links",
    "list_payments",
    "get_payment",
    "refund_payment",
    "create_plan",
    "list_plans",
    "create_subscription",
    "list_subscriptions",
    "get_subscription",
    "record_usage",
    "cancel_subscription",
  ]);
  assert.equal(list.result.tools.find((t) => t.name === "cancel_subscription")!.annotations.destructiveHint, true);
  for (const t of list.result.tools) assert.equal(t.inputSchema.type, "object");
  assert.ok("amount" in list.result.tools[1].inputSchema.properties);
  assert.equal(list.result.tools.find((t) => t.name === "refund_payment")!.annotations.destructiveHint, true);
  assert.equal(list.result.tools.find((t) => t.name === "list_payments")!.annotations.readOnlyHint, true);
});

test("MCP: bad arguments and missing permissions come back as tool errors; no key is unauthorized", async () => {
  type Result = { result: { isError?: boolean; content: { text: string }[] } };
  const bad = (await handleMcp(call("tools/call", { name: "get_payment", arguments: {} }), ctx())) as Result;
  assert.equal(bad.result.isError, true);
  assert.match(bad.result.content[0].text, /Invalid arguments: id/);
  const forbidden = ctx(async (scope) => {
    if (scope === "refunds:write") throw new PortalError("FORBIDDEN", 403);
    return { orgId: "org", environment: "sandbox", keyId: "key" };
  });
  const refused = (await handleMcp(call("tools/call", { name: "refund_payment", arguments: { id: "pi_1" } }), forbidden)) as Result;
  assert.equal(refused.result.isError, true);
  assert.match(refused.result.content[0].text, /doesn't have the refunds:write permission/);
  const anonymous = ctx(async () => {
    throw new PortalError("UNAUTHORIZED", 401);
  });
  assert.equal(((await handleMcp(call("tools/list"), anonymous)) as { error: { code: number } }).error.code, -32001);
  assert.equal(((await handleMcp(call("tools/call", { name: "nope" }), ctx())) as { error: { code: number } }).error.code, -32602);
});
