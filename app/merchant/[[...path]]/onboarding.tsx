"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export function Onboarding({
  orgId,
  version,
  state,
  value,
}: {
  orgId: string;
  version: number;
  state: string;
  value: Record<string, unknown>;
}) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  return (
    <section>
      <h2>{state}</h2>
      <p>
        Describe the scope you want to process. Live access requires a separate
        review of your evidence, provider account arrangement, and limits.
      </p>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          const form = new FormData(event.currentTarget);
          const text = (name: string) => String(form.get(name) || "").trim();
          const input = {
            legalName: text("legalName"),
            tradingName: text("tradingName"),
            country: text("country"),
            website: text("website"),
            activity: text("activity"),
            businessContact: text("businessContact"),
            technicalContact: text("technicalContact"),
            methods: form.getAll("methods"),
            volumeRange: text("volumeRange"),
            settlementCurrencies: text("settlementCurrencies")
              .split(",")
              .map((s) => s.trim()),
            payerMarkets: text("payerMarkets")
              .split(",")
              .map((s) => s.trim()),
          };
          try {
            const r = await fetch("/api/merchant", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "application",
                orgId,
                version,
                input,
                submit: true,
              }),
            });
            const body = await r.json();
            setMessage(
              r.ok
                ? "Application submitted for review."
                : body.error || "Unable to save.",
            );
            if (r.ok) router.refresh();
          } catch {
            setMessage("Unable to save. Check your connection.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset
          disabled={busy || !["Draft", "Changes requested"].includes(state)}
        >
          {[
            "legalName",
            "tradingName",
            "country",
            "website",
            "activity",
            "businessContact",
            "technicalContact",
            "volumeRange",
            "settlementCurrencies",
            "payerMarkets",
          ].map((name) => (
            <label key={name}>
              {
                (
                  {
                    legalName: "Legal name",
                    tradingName: "Trading name",
                    country: "Operating country (ISO code)",
                    website: "Business website",
                    activity: "Business activity",
                    businessContact: "Business contact email",
                    technicalContact: "Technical contact email",
                    volumeRange: "Expected volume range",
                    settlementCurrencies:
                      "Settlement currencies (comma separated)",
                    payerMarkets: "Payer countries (comma separated)",
                  } as Record<string, string>
                )[name]
              }
              <input
                name={name}
                required={name !== "tradingName"}
                defaultValue={
                  Array.isArray(value[name])
                    ? (value[name] as string[]).join(",")
                    : String(value[name] || "")
                }
              />
            </label>
          ))}
          <fieldset>
            <legend>Requested methods</legend>
            {["bank-transfer", "card", "mobile-money", "stablecoin"].map(
              (method) => (
                <label key={method}>
                  <input
                    type="checkbox"
                    name="methods"
                    value={method}
                    defaultChecked={
                      Array.isArray(value.methods) &&
                      value.methods.includes(method)
                    }
                  />
                  {method}
                </label>
              ),
            )}
          </fieldset>
          <button>Submit for review</button>
        </fieldset>
      </form>
      <p role="status">{message}</p>
    </section>
  );
}
