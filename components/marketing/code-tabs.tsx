"use client";
import { useState } from "react";

// Samples mirror the published SDK surface in sdks/node and sdks/python.
type Token = [cls: "" | "k" | "s" | "c" | "f", text: string];
const t = (cls: Token[0], text: string): Token => [cls, text];

const samples: Record<string, { file: string; tokens: Token[] }> = {
  "Node.js": {
    file: "checkout.ts",
    tokens: [
      t("k", "import"), t("", " { PayRouta } "), t("k", "from"), t("s", ' "@payrouta/server"'), t("", ";\n\n"),
      t("k", "const"), t("", " payrouta = "), t("k", "new"), t("f", " PayRouta"), t("", "({\n"),
      t("", "  baseUrl: process.env.PAYROUTA_API_URL,\n"),
      t("", "  secretKey: process.env.PAYROUTA_SECRET_KEY,\n"),
      t("", "  environment: "), t("s", '"production"'), t("", ",\n});\n\n"),
      t("c", "// One intent. Every method your customer can use.\n"),
      t("k", "const"), t("", " intent = "), t("k", "await"), t("", " payrouta."), t("f", "createIntent"), t("", "(\n  {\n"),
      t("", "    reference: "), t("s", '"order_2291"'), t("", ",\n"),
      t("", "    amount: "), t("s", '"240.00"'), t("", ",\n"),
      t("", "    asset: { kind: "), t("s", '"fiat"'), t("", ", identifier: "), t("s", '"EUR"'), t("", ", network: "), t("s", '""'), t("", " },\n"),
      t("", "    precision: 2,\n"),
      t("", "    methods: ["), t("s", '"card"'), t("", ", "), t("s", '"bank-transfer"'), t("", ", "), t("s", '"mobile-money"'), t("", ", "), t("s", '"stablecoin"'), t("", "],\n"),
      t("", "    settlement: { kind: "), t("s", '"fiat"'), t("", ", identifier: "), t("s", '"EUR"'), t("", ", network: "), t("s", '""'), t("", " },\n"),
      t("", "    returnUrl: "), t("s", '"https://shop.example/orders/2291"'), t("", ",\n  },\n"),
      t("", "  crypto."), t("f", "randomUUID"), t("", "(), "), t("c", "// idempotency key\n"), t("", ");\n\n"),
      t("k", "const"), t("", " session = "), t("k", "await"), t("", " payrouta."), t("f", "createCheckoutSession"), t("", "(intent.id, crypto."), t("f", "randomUUID"), t("", "());"),
    ],
  },
  Python: {
    file: "checkout.py",
    tokens: [
      t("k", "import"), t("", " os, uuid\n"), t("k", "from"), t("", " payrouta "), t("k", "import"), t("f", " PayRouta"), t("", "\n\n"),
      t("", "payrouta = "), t("f", "PayRouta"), t("", "(\n"),
      t("", "    os.environ["), t("s", '"PAYROUTA_API_URL"'), t("", "],\n"),
      t("", "    os.environ["), t("s", '"PAYROUTA_SECRET_KEY"'), t("", "],\n"),
      t("", "    "), t("s", '"production"'), t("", ",\n)\n\n"),
      t("c", "# One intent. Every method your customer can use.\n"),
      t("", "intent = payrouta."), t("f", "create_intent"), t("", "(\n    {\n"),
      t("", "        "), t("s", '"reference"'), t("", ": "), t("s", '"order_2291"'), t("", ",\n"),
      t("", "        "), t("s", '"amount"'), t("", ": "), t("s", '"240.00"'), t("", ",\n"),
      t("", "        "), t("s", '"asset"'), t("", ": {"), t("s", '"kind"'), t("", ": "), t("s", '"fiat"'), t("", ", "), t("s", '"identifier"'), t("", ": "), t("s", '"EUR"'), t("", ", "), t("s", '"network"'), t("", ": "), t("s", '""'), t("", "},\n"),
      t("", "        "), t("s", '"precision"'), t("", ": 2,\n"),
      t("", "        "), t("s", '"methods"'), t("", ": ["), t("s", '"card"'), t("", ", "), t("s", '"bank-transfer"'), t("", ", "), t("s", '"mobile-money"'), t("", "],\n"),
      t("", "        "), t("s", '"settlement"'), t("", ": {"), t("s", '"kind"'), t("", ": "), t("s", '"fiat"'), t("", ", "), t("s", '"identifier"'), t("", ": "), t("s", '"EUR"'), t("", ", "), t("s", '"network"'), t("", ": "), t("s", '""'), t("", "},\n"),
      t("", "        "), t("s", '"returnUrl"'), t("", ": "), t("s", '"https://shop.example/orders/2291"'), t("", ",\n    },\n"),
      t("", "    idempotency_key=str(uuid."), t("f", "uuid4"), t("", "()),\n)\n\n"),
      t("", "session = payrouta."), t("f", "create_checkout_session"), t("", "(intent["), t("s", '"id"'), t("", "], str(uuid."), t("f", "uuid4"), t("", "()))"),
    ],
  },
  cURL: {
    file: "terminal",
    tokens: [
      t("f", "curl"), t("", " -X POST "), t("s", '"$PAYROUTA_API_URL/payment-intents"'), t("", " \\\n"),
      t("", "  -H "), t("s", '"Authorization: Bearer $PAYROUTA_SECRET_KEY"'), t("", " \\\n"),
      t("", "  -H "), t("s", '"PayRouta-Environment: production"'), t("", " \\\n"),
      t("", "  -H "), t("s", '"Idempotency-Key: $(uuidgen)"'), t("", " \\\n"),
      t("", "  -H "), t("s", '"Content-Type: application/json"'), t("", " \\\n"),
      t("", "  -d "), t("s", "'{\n    \"reference\": \"order_2291\",\n    \"amount\": \"240.00\",\n    \"asset\": {\"kind\": \"fiat\", \"identifier\": \"EUR\", \"network\": \"\"},\n    \"precision\": 2,\n    \"methods\": [\"card\", \"bank-transfer\", \"mobile-money\"],\n    \"settlement\": {\"kind\": \"fiat\", \"identifier\": \"EUR\", \"network\": \"\"},\n    \"returnUrl\": \"https://shop.example/orders/2291\"\n  }'"),
    ],
  },
};

export function CodeTabs({ events = true }: { events?: boolean }) {
  const names = Object.keys(samples);
  const [active, setActive] = useState(names[0]);
  const sample = samples[active];
  return (
    <div className="mk-card mk-code" data-reveal>
      <div className="mk-code-tabs" role="tablist" aria-label="Code language">
        {names.map((n) => (
          <button
            key={n}
            role="tab"
            id={`tab-${n}`}
            aria-selected={n === active}
            aria-controls="code-panel"
            onClick={() => setActive(n)}
          >
            {n}
          </button>
        ))}
        <span className="file">{sample.file}</span>
      </div>
      <pre id="code-panel" role="tabpanel" aria-labelledby={`tab-${active}`} tabIndex={0}>
        <code>
          {sample.tokens.map(([cls, text], i) =>
            cls ? (
              <span key={i} className={cls}>
                {text}
              </span>
            ) : (
              text
            ),
          )}
        </code>
      </pre>
      {events && (
        <div className="mk-events" aria-label="Example webhook events">
          <header>
            <span className="mk-dot-live" /> Webhook events · signed
          </header>
          {[
            ["12:04:31", "payment_intent.method_selected", "card"],
            ["12:04:33", "payment.processing", "provider_b"],
            ["12:04:34", "payment.confirmed", "€240.00"],
            ["12:06:10", "settlement.completed", "EUR"],
          ].map(([time, name, meta]) => (
            <div className="mk-event" key={name}>
              <span>{time}</span>
              <b>{name}</b>
              <em>{meta}</em>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
