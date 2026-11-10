"use client";
// The front page's developer window: the same checkout from a button, Node,
// Python, the command line or an assistant over MCP. Snippets mirror
// content/docs (quickstart, sdks, api-reference POST /checkouts, cli, mcp).
import { Fragment, useState } from "react";
import { Check, Copy } from "lucide-react";

type Lang = "html" | "ts" | "py" | "json" | "sh";
type Snippet = { id: string; label: string; file: string; lang: Lang; code: (origin: string) => string };

const snippets: Snippet[] = [
  {
    id: "button",
    label: "Button",
    file: "index.html",
    lang: "html",
    code: (o) => `<script src="${o}/js/v1/payrouta.js" async></script>

<button data-payrouta-checkout="/create-checkout">
  Checkout
</button>`,
  },
  {
    id: "node",
    label: "Node",
    file: "checkout.ts",
    lang: "ts",
    code: (o) => `import { PayRouta } from "@payrouta/server";

const payrouta = new PayRouta({
  baseUrl: "${o}/api/v1",
  secretKey: process.env.PAYROUTA_SECRET_KEY!,
  environment: "sandbox",
});

const checkout = await payrouta.createCheckout(
  {
    reference: "order_2291",
    payerCountry: "NG",
    amount: "40.00",
    currency: "USD",
    methods: ["card", "bank-transfer", "mobile-money", "bnpl"],
    returnUrl: "https://shop.example/orders/2291",
  },
  "order_2291-checkout",
);`,
  },
  {
    id: "python",
    label: "Python",
    file: "checkout.py",
    lang: "py",
    code: (o) => `from payrouta import PayRouta

payrouta = PayRouta("${o}/api/v1", secret_key, "sandbox")

checkout = payrouta.create_checkout(
    {
        "reference": "order_2291",
        "payerCountry": "NG",
        "amount": "40.00",
        "currency": "USD",
        "methods": ["card", "bank-transfer", "mobile-money", "bnpl"],
        "returnUrl": "https://shop.example/orders/2291",
    },
    "order_2291-checkout",
)`,
  },
  {
    id: "cli",
    label: "CLI",
    file: "terminal",
    lang: "sh",
    code: () => `$ payrouta login --key pr_sandbox_…

$ payrouta checkout create \\
    --reference order_2291 \\
    --amount 40.00 --currency USD --payer-country NG \\
    --methods card,bank-transfer,mobile-money,bnpl \\
    --return-url https://shop.example/orders/2291

$ payrouta payments list --state Confirmed`,
  },
  {
    id: "mcp",
    label: "MCP",
    file: "mcp.json",
    lang: "json",
    code: (o) => `{
  "mcpServers": {
    "payrouta": {
      "url": "${o}/api/mcp",
      "headers": { "Authorization": "Bearer pr_sandbox_…" }
    }
  }
}`,
  },
];

// Just enough highlighting for four short snippets.
const rules: Record<Lang, [RegExp, string][]> = {
  html: [
    [/<\/?[a-z]+/g, "tag"],
    [/\s[a-z-]+(?==)/g, "attr"],
    [/"[^"]*"/g, "str"],
  ],
  ts: [
    [/\/\/.*$/gm, "com"],
    [/"[^"]*"/g, "str"],
    [/\b(import|from|const|await|new|process)\b/g, "kw"],
    [/\b[A-Za-z]+(?=\()/g, "fn"],
  ],
  py: [
    [/#.*$/gm, "com"],
    [/"[^"]*"/g, "str"],
    [/\b(from|import)\b/g, "kw"],
    [/\b[A-Za-z_]+(?=\()/g, "fn"],
  ],
  json: [
    [/"[^"]*"(?=\s*:)/g, "attr"],
    [/"[^"]*"/g, "str"],
  ],
  sh: [
    [/^\$/gm, "com"],
    [/\bpayrouta\b/g, "kw"],
    [/--[a-z-]+/g, "attr"],
  ],
};

function highlight(code: string, lang: Lang) {
  const marks: { start: number; end: number; cls: string }[] = [];
  for (const [re, cls] of rules[lang])
    for (const m of code.matchAll(re)) {
      const start = m.index!;
      const end = start + m[0].length;
      if (!marks.some((k) => start < k.end && end > k.start)) marks.push({ start, end, cls });
    }
  marks.sort((a, b) => a.start - b.start);
  const out: React.ReactNode[] = [];
  let at = 0;
  marks.forEach((m, i) => {
    out.push(<Fragment key={`t${i}`}>{code.slice(at, m.start)}</Fragment>);
    out.push(
      <span key={`m${i}`} className={`dt-${m.cls}`}>
        {code.slice(m.start, m.end)}
      </span>,
    );
    at = m.end;
  });
  out.push(code.slice(at));
  return out;
}

export function DevTabs({ origin }: { origin: string }) {
  const [id, setId] = useState(snippets[1].id);
  const [copied, setCopied] = useState(false);
  const s = snippets.find((x) => x.id === id)!;
  const code = s.code(origin);
  return (
    <div className="dt" data-tilt>
      <div className="dt-bar">
        <span className="dt-lights" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <div className="dt-tabs" role="tablist" aria-label="Language">
          {snippets.map((x) => (
            <button
              key={x.id}
              type="button"
              role="tab"
              aria-selected={x.id === id}
              className="dt-tab"
              onClick={() => {
                setId(x.id);
                setCopied(false);
              }}
            >
              {x.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="dt-copy"
          aria-label={copied ? "Copied" : `Copy ${s.label} code`}
          onClick={() =>
            navigator.clipboard?.writeText(code).then(
              () => setCopied(true),
              () => setCopied(false),
            )
          }
        >
          {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
        </button>
      </div>
      <div className="dt-file">{s.file}</div>
      <pre className="dt-code" tabIndex={0} role="tabpanel" aria-label={`${s.label} example`} key={s.id}>
        <code>
          {code.split("\n").map((line, i) => (
            <span className="dt-line" key={i} style={{ "--i": i } as React.CSSProperties}>
              {line ? highlight(line, s.lang) : "\u00a0"}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}
