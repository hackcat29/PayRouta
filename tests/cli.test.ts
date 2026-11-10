// The PayRouta CLI (sdks/cli) against a stand-in MCP endpoint.
import { test } from "node:test";
import assert from "node:assert/strict";
import { keyLabel, parseArgv, run, type Io, type Tool } from "../sdks/cli/src/index";

const tools: Tool[] = [
  {
    name: "create_payment_link",
    description: "Create a reusable payment link",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        amount: { type: "string" },
        currency: { type: "string" },
        methods: { type: "array", items: { type: "string", enum: ["card", "bank-transfer"] } },
        crypto: { type: "boolean", default: false },
        country: { type: "string" },
      },
      required: ["title", "amount", "currency", "country"],
    },
  },
  {
    name: "list_payments",
    inputSchema: { type: "object", properties: { state: { type: "string" }, limit: { type: "integer" } } },
  },
  { name: "get_payment", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
];

function harness(opts: { isTTY?: boolean; key?: string; fail?: string } = {}) {
  const calls: { method: string; params?: { name?: string; arguments?: Record<string, unknown> }; auth: string | null }[] = [];
  const out: string[] = [];
  const err: string[] = [];
  let saved: { url: string; key: string } | null = null;
  const fetcher = (async (_url: URL, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    const auth = new Headers(init.headers).get("authorization");
    calls.push({ method: body.method, params: body.params, auth });
    if (!auth?.match(/^Bearer (pr_(sandbox|production)_|pra_)/))
      return Response.json({ jsonrpc: "2.0", id: body.id, error: { code: -32001, message: "Unauthorized" } }, { status: 401 });
    if (body.method === "initialize")
      return Response.json({ jsonrpc: "2.0", id: body.id, result: { serverInfo: { name: "payrouta", title: "PayRouta", version: "1.0.0" } } });
    if (body.method === "tools/list") return Response.json({ jsonrpc: "2.0", id: body.id, result: { tools } });
    if (opts.fail)
      return Response.json({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: opts.fail }], isError: true } });
    const result = { tool: body.params.name, args: body.params.arguments };
    return Response.json({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result } });
  }) as unknown as typeof fetch;
  const io: Io = {
    env: opts.key === undefined ? { PAYROUTA_API_KEY: "pr_sandbox_abcd1234" } : { PAYROUTA_API_KEY: opts.key || undefined },
    fetch: fetcher,
    out: (t) => out.push(t),
    err: (t) => err.push(t),
    isTTY: !!opts.isTTY,
    readConfig: async () => saved,
    writeConfig: async (c) => {
      saved = c;
      return "/tmp/payrouta/config.json";
    },
  };
  return { io, calls, out, err, saved: () => saved };
}

test("aliases run the tool with flags typed from its schema", async () => {
  const h = harness();
  const code = await run(
    ["links", "create", "--title", "Ankara dress", "--amount", "45.00", "--currency=USD", "--country", "NG", "--methods", "card,bank-transfer", "--crypto"],
    h.io,
  );
  assert.equal(code, 0, h.err.join("\n"));
  const call = h.calls.find((c) => c.method === "tools/call")!;
  assert.equal(call.params?.name, "create_payment_link");
  assert.deepEqual(call.params?.arguments, {
    title: "Ankara dress",
    amount: "45.00",
    currency: "USD",
    country: "NG",
    methods: ["card", "bank-transfer"],
    crypto: true,
  });
  assert.equal(call.auth, "Bearer pr_sandbox_abcd1234");
  // Piped output is JSON.
  assert.equal(JSON.parse(h.out[0]).tool, "create_payment_link");
});

test("numbers, negated booleans, repeated arrays, raw JSON and positional ids", async () => {
  const h = harness();
  assert.equal(await run(["payments", "list", "--limit", "10", "--state", "Confirmed"], h.io), 0);
  assert.deepEqual(h.calls.at(-1)!.params?.arguments, { limit: 10, state: "Confirmed" });
  assert.equal(await run(["create-payment-link", "--no-crypto", "--methods", "card", "--methods", "bank-transfer", "--json", '{"title":"T","amount":"1","currency":"USD","country":"NG"}'], h.io), 0);
  assert.deepEqual(h.calls.at(-1)!.params?.arguments, { title: "T", amount: "1", currency: "USD", country: "NG", crypto: false, methods: ["card", "bank-transfer"] });
  assert.equal(await run(["payments", "get", "pay_123"], h.io), 0);
  assert.deepEqual(h.calls.at(-1)!.params?.arguments, { id: "pay_123" });
});

test("usage errors exit 2 without calling the tool", async () => {
  const h = harness();
  assert.equal(await run(["payments", "list", "--limit", "ten"], h.io), 2);
  assert.equal(await run(["payments", "list", "--colour", "red"], h.io), 2);
  assert.equal(await run(["payments", "launch"], h.io), 2);
  assert.ok(!h.calls.some((c) => c.method === "tools/call"));
  assert.match(h.err.join("\n"), /must be a number/);
});

test("a refused key exits 3; a failed tool exits 1 with its message", async () => {
  const none = harness({ key: "" });
  assert.equal(await run(["payments", "list"], none.io), 3);
  assert.match(none.err[0], /No API key/);
  const bad = harness({ key: "sk_live_wrong" });
  assert.equal(await run(["payments", "list"], bad.io), 3);
  const failing = harness({ fail: "PAYMENT_NOT_FOUND: We couldn't find that payment." });
  assert.equal(await run(["payments", "get", "pay_x"], failing.io), 1);
  assert.match(failing.err[0], /couldn't find that payment/);
});

test("login checks the key before saving it, and never prints it whole", async () => {
  const h = harness({ key: "" });
  assert.equal(await run(["login", "--key", "not-a-key"], h.io), 2);
  assert.equal(h.saved(), null);
  assert.equal(await run(["login", "--key", "pr_production_secretvalue9876", "--url", "http://127.0.0.1:3000"], h.io), 0);
  assert.deepEqual(h.saved(), { url: "http://127.0.0.1:3000", key: "pr_production_secretvalue9876" });
  assert.ok(!h.out.join("").includes("secretvalue"));
  assert.equal(keyLabel("pra_abcdef1234"), "agent key …1234");
  // Plain http is refused except for loopback.
  assert.equal(await run(["whoami", "--url", "http://payrouta.example"], h.io), 2);
});

test("terminal output is readable text; help comes from the schema", async () => {
  const h = harness({ isTTY: true });
  assert.equal(await run(["payments", "get", "pay_9"], h.io), 0);
  assert.match(h.out[0], /tool\s+get_payment/);
  assert.equal(await run(["links", "create", "--help"], h.io), 0);
  assert.match(h.out.at(-1)!, /--methods <a,b>/);
  assert.match(h.out.at(-1)!, /one of: card, bank-transfer/);
  assert.equal(await run(["tools"], h.io), 0);
  assert.match(h.out.at(-1)!, /links create\s+Create a reusable payment link/);
});

test("argv parsing keeps values that start with a dash after --", () => {
  assert.deepEqual(parseArgv(["usage", "record", "--", "-5"]).words, ["usage", "record", "-5"]);
});
