// The PayRouta command line. It is a client of PayRouta's MCP endpoint
// (/api/mcp, docs/mcp.md), so the CLI, an AI assistant and the dashboard all
// run the same operations with the same permissions:
//
// - A merchant API key (pr_sandbox_… / pr_production_…) gets the merchant
//   tools: checkouts, payment links, payments, refunds, plans,
//   subscriptions and usage.
// - An agent key (pra_…) gets the buyer tools: read what a link or invoice
//   costs, open its checkout and pay within the key's limits.
//
// Commands come from the server's tool list, so a new tool works here the
// day it ships. Flags are typed from each tool's input schema. Output is
// JSON when piped (for scripts and agents) and readable text in a terminal.

export const VERSION = "0.1.0";

export type JsonSchema = {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  description?: string;
  default?: unknown;
  anyOf?: JsonSchema[];
};
export type Tool = { name: string; title?: string; description?: string; inputSchema: JsonSchema };

export class CliError extends Error {
  constructor(
    message: string,
    public exitCode = 1,
  ) {
    super(message);
  }
}

// Short commands for the tools people use most. Any tool also runs by its
// own name, with dashes or underscores: `payrouta create-payment-link`.
export const aliases: Record<string, string> = {
  "checkout create": "create_checkout",
  "links create": "create_payment_link",
  "links list": "list_payment_links",
  "payments list": "list_payments",
  "payments get": "get_payment",
  "payments refund": "refund_payment",
  "plans create": "create_plan",
  "plans list": "list_plans",
  "subscriptions create": "create_subscription",
  "subscriptions list": "list_subscriptions",
  "subscriptions get": "get_subscription",
  "subscriptions cancel": "cancel_subscription",
  "usage record": "record_usage",
  // Agent keys.
  "pay terms": "get_payment_terms",
  "pay open": "open_checkout",
  "pay checkout": "pay_checkout",
  "pay submit": "submit_signed_intent",
  "pay status": "get_checkout_status",
  "pay spending": "get_spending",
};

export type Config = { url: string; key: string };

export type Io = {
  env: Record<string, string | undefined>;
  fetch: typeof fetch;
  out(text: string): void;
  err(text: string): void;
  isTTY: boolean;
  readConfig(): Promise<Partial<Config> | null>;
  writeConfig(config: Config): Promise<string>;
};

// --- MCP client -------------------------------------------------------------

export class Client {
  private id = 0;
  constructor(
    private url: string,
    private key: string,
    private fetcher: typeof fetch,
  ) {}

  private async rpc(method: string, params?: Record<string, unknown>) {
    let response: Response;
    try {
      response = await this.fetcher(new URL("/api/mcp", this.url), {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(30000),
        headers: { Authorization: `Bearer ${this.key}`, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++this.id, method, ...(params ? { params } : {}) }),
      });
    } catch (e) {
      throw new CliError(`Couldn't reach ${this.url}: ${(e as Error).message}`);
    }
    let body: { result?: unknown; error?: { code: number; message: string } };
    try {
      body = await response.json();
    } catch {
      throw new CliError(`Unexpected response from ${this.url} (HTTP ${response.status})`);
    }
    if (body.error) throw new CliError(body.error.message, body.error.code === -32001 ? 3 : 1);
    return body.result;
  }

  async initialize() {
    return (await this.rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "payrouta-cli", version: VERSION },
    })) as { serverInfo?: { name?: string; title?: string; version?: string }; protocolVersion?: string };
  }

  async tools() {
    return ((await this.rpc("tools/list")) as { tools: Tool[] }).tools;
  }

  async call(name: string, args: Record<string, unknown>) {
    const result = (await this.rpc("tools/call", { name, arguments: args })) as {
      content?: { type: string; text?: string }[];
      structuredContent?: unknown;
      isError?: boolean;
    };
    const text = result.content?.map((c) => c.text ?? "").join("\n") ?? "";
    if (result.isError) throw new CliError(text || "The tool failed");
    return result.structuredContent ?? (text ? JSON.parse(text) : null);
  }
}

// --- Arguments --------------------------------------------------------------

type Parsed = { words: string[]; flags: Record<string, string[]>; bools: Set<string> };

export function parseArgv(argv: string[]): Parsed {
  const words: string[] = [];
  const flags: Record<string, string[]> = {};
  const bools = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") {
      words.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      const name = (eq > 0 ? a.slice(2, eq) : a.slice(2)).trim();
      if (!name) throw new CliError(`Invalid flag: ${a}`, 2);
      if (eq > 0) (flags[name] ??= []).push(a.slice(eq + 1));
      else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) (flags[name] ??= []).push(argv[++i]);
      else bools.add(name);
    } else if (a === "-h") bools.add("help");
    else words.push(a);
  }
  return { words, flags, bools };
}

const camel = (s: string) => s.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const typeOf = (s: JsonSchema): string => {
  const t = Array.isArray(s.type) ? s.type.find((x) => x !== "null") : s.type;
  return t ?? s.anyOf?.map(typeOf).find((x) => x && x !== "null") ?? "string";
};

// Flags become the tool's arguments, typed from its input schema:
// --amount 25.00, --crypto (true), --no-crypto (false), --methods card,bank-transfer
// or --methods card --methods bank-transfer, and --json '{…}' for anything else.
export function toolArgs(tool: Tool, parsed: Parsed, positional: string[]) {
  const props = tool.inputSchema.properties ?? {};
  const args: Record<string, unknown> = {};
  if (parsed.flags.json) {
    try {
      Object.assign(args, JSON.parse(parsed.flags.json.at(-1)!));
    } catch {
      throw new CliError("--json must be a JSON object", 2);
    }
  }
  const reserved = new Set(["json", "url", "key", "output", "help"]);
  for (const name of [...parsed.bools]) {
    if (reserved.has(name)) continue;
    const negated = name.startsWith("no-") && props[camel(name.slice(3))];
    const key = negated ? camel(name.slice(3)) : camel(name);
    if (!props[key]) throw new CliError(`Unknown flag --${name} for ${tool.name}. See: payrouta ${tool.name} --help`, 2);
    if (typeOf(props[key]) !== "boolean") throw new CliError(`--${kebab(key)} needs a value`, 2);
    args[key] = !negated;
  }
  for (const [name, values] of Object.entries(parsed.flags)) {
    if (reserved.has(name)) continue;
    const key = camel(name);
    const schema = props[key];
    if (!schema) throw new CliError(`Unknown flag --${name} for ${tool.name}. See: payrouta ${tool.name} --help`, 2);
    const type = typeOf(schema);
    const last = values.at(-1)!;
    if (type === "array") args[key] = values.flatMap((v) => v.split(",")).map((v) => v.trim()).filter(Boolean);
    else if (type === "boolean") args[key] = !["false", "0", "no"].includes(last.toLowerCase());
    else if (type === "integer" || type === "number") {
      const n = Number(last);
      if (!Number.isFinite(n)) throw new CliError(`--${name} must be a number`, 2);
      args[key] = n;
    } else if (type === "object") {
      try {
        args[key] = JSON.parse(last);
      } catch {
        throw new CliError(`--${name} must be JSON`, 2);
      }
    } else args[key] = last;
  }
  // `payrouta payments get pay_123`: a lone word fills the one required field.
  if (positional.length) {
    const required = (tool.inputSchema.required ?? []).filter((r) => args[r] === undefined);
    const target = required[0] ?? (props.id ? "id" : undefined);
    if (positional.length > 1 || !target) throw new CliError(`Unexpected argument: ${positional.join(" ")}`, 2);
    args[target] = positional[0];
  }
  return args;
}

// --- Output -----------------------------------------------------------------

function human(value: unknown, indent = ""): string {
  if (value === null || value === undefined) return `${indent}—`;
  if (Array.isArray(value)) {
    if (!value.length) return `${indent}(none)`;
    return value.map((v) => (typeof v === "object" ? human(v, indent) : `${indent}- ${String(v)}`)).join(`\n${indent}\n`);
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    const width = Math.max(...entries.map(([k]) => k.length));
    return entries
      .map(([k, v]) =>
        v !== null && typeof v === "object"
          ? `${indent}${k}:\n${human(v, indent + "  ")}`
          : `${indent}${k.padEnd(width)}  ${v === undefined || v === null ? "—" : String(v)}`,
      )
      .join("\n");
  }
  return `${indent}${String(value)}`;
}

function toolHelp(tool: Tool) {
  const props = tool.inputSchema.properties ?? {};
  const required = new Set(tool.inputSchema.required ?? []);
  const alias = Object.entries(aliases).find(([, t]) => t === tool.name)?.[0];
  const lines = [
    `${tool.title ?? tool.name}`,
    tool.description ?? "",
    "",
    `Usage: payrouta ${alias ?? tool.name.replaceAll("_", "-")} [flags]`,
    "",
  ];
  for (const [k, s] of Object.entries(props)) {
    const type = typeOf(s);
    const values = s.enum ?? s.items?.enum;
    lines.push(
      `  --${kebab(k)}${type === "boolean" ? "" : ` <${type === "array" ? "a,b" : type}>`}${required.has(k) ? "  (required)" : ""}`,
    );
    const note = [s.description, values ? `one of: ${values.join(", ")}` : "", s.default !== undefined ? `default ${JSON.stringify(s.default)}` : ""]
      .filter(Boolean)
      .join(" · ");
    if (note) lines.push(`      ${note}`);
  }
  return lines.join("\n");
}

const usage = `PayRouta ${VERSION}

Usage: payrouta <command> [flags]

Account
  login --key <key> [--url <url>]   Save an API key or agent key
  logout                            Forget the saved key
  whoami                            The server, environment and key in use
  tools                             Every command this key can run

Merchant keys (pr_sandbox_… / pr_production_…)
  checkout create          links create | list
  payments list | get | refund
  plans create | list      subscriptions create | list | get | cancel
  usage record

Agent keys (pra_…)
  pay terms | open | checkout | submit | status | spending

Any command: --help for its flags, --json '{…}' for raw arguments,
--output json|text to choose the output (json when piped).
Settings: PAYROUTA_API_KEY and PAYROUTA_URL override the saved login.`;

// --- Commands ---------------------------------------------------------------

export async function run(argv: string[], io: Io): Promise<number> {
  try {
    const parsed = parseArgv(argv);
    const asJson = parsed.flags.output?.at(-1) ? parsed.flags.output.at(-1) === "json" : !io.isTTY;
    const print = (value: unknown) => io.out(asJson ? JSON.stringify(value, null, 2) : human(value));
    const [first, second] = parsed.words;

    if (parsed.bools.has("version") || first === "version") {
      io.out(VERSION);
      return 0;
    }
    if (!first || first === "help" || (parsed.bools.has("help") && !first)) {
      io.out(usage);
      return 0;
    }

    const saved = (await io.readConfig()) ?? {};
    const url = (parsed.flags.url?.at(-1) ?? io.env.PAYROUTA_URL ?? saved.url ?? "https://payrouta.com").replace(/\/+$/, "");
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(parsedUrl.hostname))
      throw new CliError("Use an https:// URL (http is allowed only for localhost)", 2);

    if (first === "login") {
      const key = parsed.flags.key?.at(-1);
      if (!key || !/^(pr_(sandbox|production)_|pra_)\S+$/.test(key))
        throw new CliError("Pass --key with a PayRouta API key (pr_sandbox_…, pr_production_…) or agent key (pra_…)", 2);
      const client = new Client(url, key, io.fetch);
      await client.initialize();
      const where = await io.writeConfig({ url, key });
      io.out(`Signed in to ${url} with ${keyLabel(key)}. Saved to ${where}.`);
      return 0;
    }
    if (first === "logout") {
      await io.writeConfig({ url, key: "" });
      io.out("Signed out.");
      return 0;
    }

    const key = parsed.flags.key?.at(-1) ?? io.env.PAYROUTA_API_KEY ?? saved.key;
    if (!key) throw new CliError("No API key. Run: payrouta login --key <key>, or set PAYROUTA_API_KEY", 3);
    const client = new Client(url, key, io.fetch);

    if (first === "whoami") {
      const info = await client.initialize();
      print({ url, key: keyLabel(key), server: `${info.serverInfo?.title ?? info.serverInfo?.name ?? "payrouta"} ${info.serverInfo?.version ?? ""}`.trim() });
      return 0;
    }

    const tools = await client.tools();
    if (first === "tools") {
      if (asJson) print(tools);
      else
        io.out(
          tools
            .map((t) => {
              const alias = Object.entries(aliases).find(([, n]) => n === t.name)?.[0];
              return `${(alias ?? t.name.replaceAll("_", "-")).padEnd(24)}${t.description ?? ""}`;
            })
            .join("\n"),
        );
      return 0;
    }

    const alias = second ? aliases[`${first} ${second}`] : undefined;
    const name = alias ?? first.replaceAll("-", "_");
    const positional = parsed.words.slice(alias ? 2 : 1);
    const tool = tools.find((t) => t.name === name);
    if (!tool) {
      const known = tools.some((t) => Object.entries(aliases).some(([a, n]) => n === t.name && a.startsWith(`${first} `)));
      throw new CliError(
        known || !tools.length
          ? `Unknown command: ${parsed.words.join(" ")}. Run payrouta tools.`
          : `This key can't run "${parsed.words.join(" ")}". Run payrouta tools to see what it can.`,
        2,
      );
    }
    if (parsed.bools.has("help")) {
      io.out(toolHelp(tool));
      return 0;
    }
    print(await client.call(tool.name, toolArgs(tool, parsed, positional)));
    return 0;
  } catch (e) {
    if (e instanceof CliError) {
      io.err(`Error: ${e.message}`);
      return e.exitCode;
    }
    io.err(`Error: ${(e as Error).message}`);
    return 1;
  }
}

// Never print a whole key.
export const keyLabel = (key: string) => {
  const kind = key.startsWith("pra_") ? "agent key" : key.startsWith("pr_production_") ? "live key" : "test key";
  return `${kind} …${key.slice(-4)}`;
};
