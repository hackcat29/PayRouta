"use client";
import Link from "next/link";
import { ReactNode, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { countries, fiat } from "@/lib/portal/domain";
import { labelOf } from "@/lib/providers/normalized";

const supportedMethods = ["stablecoin"] as const;
type SupportedMethod = (typeof supportedMethods)[number];

type ApplicationValues = {
  legalName: string;
  tradingName: string;
  country: string;
  website: string;
  activity: string;
  businessContact: string;
  technicalContact: string;
  methods: SupportedMethod[];
  volumeRange: string;
  settlementCurrencies: string[];
  payerMarkets: string[];
};
const volumeOptions = [
  "Under $10,000 per month",
  "$10,000–$100,000 per month",
  "Over $100,000 per month",
] as const;
const steps = [
  {
    id: "business",
    title: "Your business",
    description: "Tell us who you are and where your business operates.",
  },
  {
    id: "methods",
    title: "How customers pay",
    description: "Choose the payment methods you want to offer.",
  },
  {
    id: "settlement",
    title: "Currencies and markets",
    description:
      "Tell us which currencies you expect and where your customers are. Your providers pay you directly into the account you set up with them.",
  },
  {
    id: "documents",
    title: "Verify your business",
    description:
      "Upload only the documents PayRouta asks for. The list below is based on your application.",
  },
  {
    id: "review",
    title: "Review",
    description: "Check the details before asking for a live-access review.",
  },
] as const;

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value))
    return value.map((entry) => String(entry)).filter(Boolean);
  if (typeof value === "string")
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  return [];
}
function initialForm(value: Record<string, unknown>): ApplicationValues {
  const methods = toStringArray(value.methods).filter((method) =>
    (supportedMethods as readonly string[]).includes(method),
  ) as SupportedMethod[];
  return {
    legalName: String(value.legalName || ""),
    tradingName: String(value.tradingName || ""),
    country: String(value.country || ""),
    website: String(value.website || ""),
    activity: String(value.activity || ""),
    businessContact: String(value.businessContact || ""),
    technicalContact: String(value.technicalContact || ""),
    methods: methods.length ? methods : ["stablecoin"],
    volumeRange: String(value.volumeRange || ""),
    settlementCurrencies: toStringArray(value.settlementCurrencies),
    payerMarkets: toStringArray(value.payerMarkets),
  };
}
function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
function validWebsite(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
function validateStep(step: number, form: ApplicationValues) {
  if (step === 0) {
    const errors: string[] = [];
    if (!form.legalName.trim()) errors.push("Enter the legal business name.");
    if (!countries.some((country) => country.id === form.country))
      errors.push("Select an operating country from the list.");
    if (!validWebsite(form.website))
      errors.push("Enter a valid business website address.");
    if (form.activity.trim().length < 10)
      errors.push("Describe the business activity in at least 10 characters.");
    if (!validEmail(form.businessContact))
      errors.push("Enter a valid business contact email.");
    if (!validEmail(form.technicalContact))
      errors.push("Enter a valid technical contact email.");
    return errors;
  }
  if (step === 1)
    return form.methods.length ? [] : ["Select at least one payment method."];
  if (step === 2) {
    const errors: string[] = [];
    if (!form.settlementCurrencies.length)
      errors.push("Select at least one settlement currency.");
    if (!form.payerMarkets.length)
      errors.push("Select at least one payer country.");
    if (!form.volumeRange.trim()) errors.push("Select an expected volume.");
    return errors;
  }
  return [];
}
function SearchableSelect({
  id,
  label,
  options,
  value,
  onChange,
}: {
  id: string;
  label: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  const [query, setQuery] = useState("");
  const matches = useMemo(() => {
    const text = query.trim().toLowerCase();
    const filtered = text
      ? options.filter((option) =>
          `${option.label} ${option.value}`.toLowerCase().includes(text),
        )
      : options;
    return filtered.slice(0, 100);
  }, [options, query]);
  const selected = options.find((option) => option.value === value);
  const shown =
    selected && !matches.some((option) => option.value === selected.value)
      ? [selected, ...matches]
      : matches;
  return (
    <div>
      <label htmlFor={`${id}-search`}>Search {label.toLowerCase()}</label>
      <input
        id={`${id}-search`}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={`Search ${options.length} options`}
        autoComplete="off"
      />
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required
      >
        <option value="">Select…</option>
        {shown.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
function SearchableMultiSelect({
  id,
  label,
  options,
  selected,
  onChange,
}: {
  id: string;
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (values: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const matches = useMemo(() => {
    const text = query.trim().toLowerCase();
    const filtered = text
      ? options.filter((option) =>
          `${option.label} ${option.value}`.toLowerCase().includes(text),
        )
      : options;
    return filtered.slice(0, 100);
  }, [options, query]);
  const shownValues = new Set([
    ...selected,
    ...matches.map((option) => option.value),
  ]);
  const shown = [...shownValues].map(
    (value) =>
      options.find((option) => option.value === value) ?? {
        value,
        label: value,
      },
  );
  return (
    <div>
      <label htmlFor={`${id}-search`}>Search {label.toLowerCase()}</label>
      <input
        id={`${id}-search`}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={`Search ${options.length} options`}
        autoComplete="off"
      />
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        multiple
        size={6}
        value={selected}
        onChange={(event) =>
          onChange(
            Array.from(event.target.selectedOptions, (option) => option.value),
          )
        }
      >
        {shown.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <p>Hold Ctrl or Command to choose more than one.</p>
    </div>
  );
}

export function Onboarding({
  orgId,
  version,
  state,
  value,
  requirements,
  evidencePanel,
}: {
  orgId: string;
  version: number;
  state: string;
  value: Record<string, unknown>;
  requirements: string[];
  evidencePanel: ReactNode;
}) {
  const router = useRouter();
  const [form, setForm] = useState(() => initialForm(value));
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const editable = ["Draft", "Changes requested"].includes(state);
  const countryName =
    countries.find((country) => country.id === form.country)?.name ||
    form.country ||
    "Not set";
  const methodLabels = form.methods.length
    ? form.methods.map((method) => labelOf(method)).join(", ")
    : "No methods selected";
  function update<Key extends keyof ApplicationValues>(
    key: Key,
    next: ApplicationValues[Key],
  ) {
    setForm((current) => ({ ...current, [key]: next }));
    setErrors([]);
  }
  function nextStep() {
    const failed = validateStep(step, form);
    if (failed.length) {
      setErrors(failed);
      return;
    }
    setStep((current) => Math.min(current + 1, steps.length - 1));
  }
  async function save(submitting: boolean) {
    setBusy(true);
    setMessage("");
    const payload = {
      legalName: form.legalName.trim(),
      tradingName: form.tradingName.trim(),
      country: form.country.trim(),
      website: form.website.trim(),
      activity: form.activity.trim(),
      businessContact: form.businessContact.trim(),
      technicalContact: form.technicalContact.trim(),
      methods: form.methods,
      volumeRange: form.volumeRange.trim(),
      settlementCurrencies: form.settlementCurrencies,
      payerMarkets: form.payerMarkets,
    };
    try {
      const response = await fetch("/api/merchant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "application",
          orgId,
          version,
          input: submitting
            ? payload
            : Object.fromEntries(
                Object.entries(payload).filter(
                  ([, entry]) =>
                    entry !== "" &&
                    (!Array.isArray(entry) || entry.some(Boolean)),
                ),
              ),
          submit: submitting,
        }),
      });
      const body = await response.json();
      setMessage(
        response.ok
          ? submitting
            ? "Application submitted for review."
            : "Draft saved."
          : body.error || "Unable to save.",
      );
      if (response.ok) router.refresh();
    } catch {
      setMessage("Unable to save. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ms-wizard">
      <ol className="merchant-steps" aria-label="Business setup steps">
        {steps.map((entry, index) => (
          <li
            key={entry.id}
            aria-current={index === step ? "step" : undefined}
            className={index < step ? "complete" : undefined}
          >
            {entry.title}
          </li>
        ))}
      </ol>
      <section
        className="ms-wizard-body"
        aria-labelledby="merchant-setup-heading"
      >
        <p className="ms-step-meta">
          Step {step + 1} of {steps.length}
          <span
            className={`ms-pill ${state === "Approved" ? "good" : state === "Draft" ? "" : "info"}`}
          >
            {state}
          </span>
        </p>
        <h2 id="merchant-setup-heading">{steps[step].title}</h2>
        <p>{steps[step].description}</p>
        {typeof value.reviewFeedback === "string" && (
          <p>{value.reviewFeedback}</p>
        )}
        {errors.length > 0 && (
          <div role="alert">
            {errors.map((error) => (
              <p key={error}>{error}</p>
            ))}
          </div>
        )}

        {step === 0 && (
          <div>
            <label htmlFor="merchant-legal-name">
              Legal name
              <input
                id="merchant-legal-name"
                value={form.legalName}
                onChange={(event) => update("legalName", event.target.value)}
                required
              />
            </label>
            <label htmlFor="merchant-trading-name">
              Trading name
              <input
                id="merchant-trading-name"
                value={form.tradingName}
                onChange={(event) => update("tradingName", event.target.value)}
              />
            </label>
            <SearchableSelect
              id="merchant-country"
              label="Operating country"
              options={countries.map((country) => ({
                value: country.id,
                label: `${country.name} (${country.id})`,
              }))}
              value={form.country}
              onChange={(next) => update("country", next)}
            />
            <label htmlFor="merchant-website">
              Business website
              <input
                id="merchant-website"
                type="url"
                inputMode="url"
                placeholder="https://example.com"
                value={form.website}
                onChange={(event) => update("website", event.target.value)}
                required
              />
            </label>
            <label htmlFor="merchant-activity">
              Business activity
              <textarea
                id="merchant-activity"
                value={form.activity}
                onChange={(event) => update("activity", event.target.value)}
                required
              />
            </label>
            <label htmlFor="merchant-business-contact">
              Business contact email
              <input
                id="merchant-business-contact"
                type="email"
                value={form.businessContact}
                onChange={(event) =>
                  update("businessContact", event.target.value)
                }
                required
              />
            </label>
            <label htmlFor="merchant-technical-contact">
              Technical contact email
              <input
                id="merchant-technical-contact"
                type="email"
                value={form.technicalContact}
                onChange={(event) =>
                  update("technicalContact", event.target.value)
                }
                required
              />
            </label>
          </div>
        )}

        {step === 1 && (
          <fieldset>
            <legend>How do you want customers to pay?</legend>
            {supportedMethods.map((method) => (
              <label key={method}>
                <input
                  id={`merchant-method-${method}`}
                  type="checkbox"
                  checked={form.methods.includes(method)}
                  onChange={(event) =>
                    update(
                      "methods",
                      event.target.checked
                        ? [...form.methods, method]
                        : form.methods.filter((entry) => entry !== method),
                    )
                  }
                />
                {labelOf(method)}
              </label>
            ))}
          </fieldset>
        )}

        {step === 2 && (
          <div>
            <p>
              Your payout bank account and identity details are collected
              separately, encrypted, in{" "}
              <Link href="/merchant/activation">Activate payments</Link>.
              Payouts go to that account; regulated processing partners hold
              your balance until then, never PayRouta&apos;s own bank accounts.
            </p>
            <SearchableMultiSelect
              id="merchant-settlement-currencies"
              label="Currencies you expect to be paid in"
              options={fiat.map((currency) => ({
                value: currency,
                label: currency,
              }))}
              selected={form.settlementCurrencies}
              onChange={(next) => update("settlementCurrencies", next)}
            />
            <SearchableMultiSelect
              id="merchant-payer-markets"
              label="Payer countries"
              options={countries.map((country) => ({
                value: country.id,
                label: `${country.name} (${country.id})`,
              }))}
              selected={form.payerMarkets}
              onChange={(next) => update("payerMarkets", next)}
            />
            <fieldset>
              <legend>Expected payment volume</legend>
              {volumeOptions.map((option) => (
                <label key={option}>
                  <input
                    id={`merchant-volume-${option}`}
                    type="radio"
                    name="merchant-volume"
                    checked={form.volumeRange === option}
                    onChange={() => update("volumeRange", option)}
                  />
                  {option}
                </label>
              ))}
              <label>
                <input
                  id="merchant-volume-other"
                  type="radio"
                  name="merchant-volume"
                  checked={
                    form.volumeRange !== "" &&
                    !volumeOptions.includes(
                      form.volumeRange as (typeof volumeOptions)[number],
                    )
                  }
                  onChange={() => update("volumeRange", form.volumeRange)}
                />
                Another range
              </label>
              {form.volumeRange !== "" &&
                !volumeOptions.includes(
                  form.volumeRange as (typeof volumeOptions)[number],
                ) && (
                  <label htmlFor="merchant-volume-description">
                    Describe the expected volume
                    <input
                      id="merchant-volume-description"
                      value={form.volumeRange}
                      onChange={(event) =>
                        update("volumeRange", event.target.value)
                      }
                    />
                  </label>
                )}
            </fieldset>
          </div>
        )}

        {step === 3 && (
          <div>
            {requirements.length ? (
              <>
                <p>Based on this application, upload these documents:</p>
                <ul>
                  {requirements.map((requirement) => (
                    <li key={requirement}>{requirement}</li>
                  ))}
                </ul>
              </>
            ) : (
              <p>
                No documents are required yet. Save the earlier steps so
                PayRouta can determine what is needed.
              </p>
            )}
            {evidencePanel}
          </div>
        )}

        {step === 4 && (
          <dl>
            <dt>Business</dt>
            <dd>
              {form.legalName || "Not set"}
              {form.tradingName ? `, trading as ${form.tradingName}` : ""}
            </dd>
            <dt>Operating country</dt>
            <dd>{countryName}</dd>
            <dt>Website</dt>
            <dd>{form.website || "Not set"}</dd>
            <dt>Payment methods</dt>
            <dd>{methodLabels}</dd>
            <dt>Currencies</dt>
            <dd>{form.settlementCurrencies.join(", ") || "Not set"}</dd>
            <dt>Payer countries</dt>
            <dd>{form.payerMarkets.join(", ") || "Not set"}</dd>
            <dt>Expected volume</dt>
            <dd>{form.volumeRange || "Not set"}</dd>
          </dl>
        )}

        <div className="merchant-wizard-actions">
          {step > 0 && (
            <button type="button" onClick={() => setStep(step - 1)}>
              Back
            </button>
          )}
          <button
            type="button"
            disabled={busy || !editable}
            onClick={() => void save(false)}
          >
            Save draft
          </button>
          {step < steps.length - 1 ? (
            <button
              type="button"
              disabled={busy || !editable}
              onClick={nextStep}
            >
              Continue
            </button>
          ) : (
            <button
              type="button"
              disabled={busy || !editable}
              onClick={() => void save(true)}
            >
              Submit for review
            </button>
          )}
        </div>
        <p role="status">{message}</p>
      </section>
    </div>
  );
}
