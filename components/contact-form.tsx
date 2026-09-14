"use client";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { enquirySchema, safeIntent, type Intent } from "@/lib/enquiries/schema";
import { track } from "@/lib/analytics";
const methodNames = [
  "Instant bank transfers (iDEAL, FedNow, Pix, UPI, NIP)",
  "Digital wallets (Apple Pay, Google Pay, PayPal, OPay, PalmPay)",
  "Cards & domestic schemes (Visa, Mastercard, Verve, CB, JCB)",
  "Direct debit & wire transfers (ACH, SEPA, Bacs, Wire)",
  "Cash vouchers (OXXO, Konbini, Paysafecard, Boleto)",
  "Buy now, pay later & installments (Klarna, Affirm, Tabby)",
  "Mobile money & phone bills (M-Pesa, MTN MoMo, Airtel)",
  "Stablecoins (Circle USDC)",
  "Crypto apps & exchanges (Binance Pay, Coinbase)",
  "Real-World Assets (e.g. Ondo, Paxos Gold, T-Bills)",
  "Local payment methods",
];
export function ContactForm({
  initialIntent,
  configured,
}: {
  initialIntent?: Intent;
  configured: boolean;
}) {
  const searchParams = useSearchParams();
  const paramIntent = searchParams?.get("intent");
  const [intent, setIntent] = useState<Intent>(
    initialIntent ?? safeIntent(paramIntent),
  );

  useEffect(() => {
    if (paramIntent) {
      setIntent(safeIntent(paramIntent));
    }
  }, [paramIntent]);
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>(
    {},
  );
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  const reference = useRef("");
  const locked = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const signature = useRef("");
  useEffect(() => () => controller.current?.abort(), []);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (locked.current) return;
    const form = e.currentTarget;
    const f = new FormData(form);
    const fields = {
      intent,
      name: String(f.get("name") || ""),
      email: String(f.get("email") || ""),
      company: String(f.get("company") || ""),
      country: String(f.get("country") || ""),
      website: String(f.get("website") || ""),
      message: String(f.get("message") || ""),
      volume: String(f.get("volume") || ""),
      methods: f.getAll("methods"),
      providerType: String(f.get("providerType") || ""),
      capabilities: String(f.get("capabilities") || ""),
      companyFax: String(f.get("companyFax") || ""),
    };
    const nextSignature = JSON.stringify(fields);
    if (!reference.current || signature.current !== nextSignature) {
      reference.current = crypto.randomUUID();
      signature.current = nextSignature;
    }
    const result = enquirySchema.safeParse({
      ...fields,
      submissionId: reference.current,
    });
    setErrors({});
    setSuccess(false);
    if (!result.success) {
      const fieldErrors = result.error.flatten().fieldErrors;
      setErrors(fieldErrors);
      setStatus("Please check the highlighted fields.");
      const name = Object.keys(fieldErrors)[0];
      form.querySelector<HTMLElement>(`[name="${name}"]`)?.focus();
      return;
    }
    if (!configured) {
      setStatus(
        "Online submission is not yet available. Your enquiry has not been sent.",
      );
      return;
    }
    locked.current = true;
    setBusy(true);
    setStatus("Sending your enquiry…");
    controller.current = new AbortController();
    const timeout = setTimeout(() => controller.current?.abort(), 12000);
    try {
      const response = await fetch("/api/enquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result.data),
        signal: controller.current.signal,
      });
      const data = await response.json();
      setStatus(data.message || "Delivery could not be confirmed.");
      setSuccess(response.ok && data.ok === true);
      if (data.errors) setErrors(data.errors);
      track("enquiry", {
        intent,
        outcome: response.ok && data.ok ? "accepted" : "unconfirmed",
      });
    } catch {
      setStatus(
        "Delivery could not be confirmed. It may have reached the recipient. Your details remain available for retry.",
      );
      track("enquiry", { intent, outcome: "unconfirmed" });
    } finally {
      clearTimeout(timeout);
      locked.current = false;
      setBusy(false);
    }
  }
  function field(
    name: string,
    label: string,
    {
      optional = false,
      max = 160,
      type = "text",
      area = false,
    }: { optional?: boolean; max?: number; type?: string; area?: boolean } = {},
  ) {
    return (
      <label className="field" key={name} htmlFor={name}>
        <span id={`${name}-label`}>
          {label}
          {optional ? " (optional)" : ""}
        </span>
        {area ? (
          <textarea
            id={name}
            aria-labelledby={`${name}-label`}
            name={name}
            maxLength={max}
            required={!optional}
            aria-invalid={!!errors[name]}
            aria-describedby={errors[name] ? `${name}-error` : undefined}
          />
        ) : (
          <input
            id={name}
            aria-labelledby={`${name}-label`}
            name={name}
            type={type}
            maxLength={max}
            required={!optional}
            autoComplete={
              name === "name"
                ? "name"
                : name === "email"
                  ? "email"
                  : name === "company"
                    ? "organization"
                    : name === "website"
                      ? "url"
                      : undefined
            }
            aria-invalid={!!errors[name]}
            aria-describedby={errors[name] ? `${name}-error` : undefined}
          />
        )}{" "}
        {errors[name] && (
          <span id={`${name}-error`} className="field-error">
            {errors[name]?.[0]}
          </span>
        )}
      </label>
    );
  }
  return (
    <form className="contact-form" onSubmit={submit} noValidate>
      <fieldset disabled={busy || success}>
        <label className="field" htmlFor="intent">
          I’m interested in
          <select
            id="intent"
            value={intent}
            onChange={(e) => {
              setIntent(e.target.value as Intent);
              setErrors({});
              setStatus("");
            }}
          >
            <option value="merchant">Merchant access</option>
            <option value="provider">Provider participation</option>
            <option value="pricing">Pricing</option>
            <option value="general">General enquiry</option>
          </select>
        </label>
        <div className="form-grid">
          {field("name", "Name", { max: 100 })}
          {field("email", "Work email", { type: "email", max: 254 })}
          {field("company", "Company")}
          {field("country", "Country / region", { max: 100 })}
        </div>
        {field("website", "Website", { optional: true, type: "url", max: 500 })}
        {(intent === "merchant" || intent === "pricing") && (
          <>
            <label className="field" htmlFor="volume">
              Expected monthly volume (optional)
              <select id="volume" name="volume">
                <option value="">Select a range</option>
                <option>Exploring / not yet known</option>
                <option>Under 1,000 transactions</option>
                <option>1,000–10,000 transactions</option>
                <option>Over 10,000 transactions</option>
              </select>
            </label>
            <fieldset>
              <legend>Required payment methods (optional)</legend>
              <div className="checkbox-grid">
                {methodNames.map((m) => (
                  <label key={m}>
                    <input type="checkbox" name="methods" value={m} />
                    {m}
                  </label>
                ))}
              </div>
            </fieldset>
          </>
        )}
        {intent === "provider" && (
          <>
            {field("providerType", "Provider type", {
              optional: true,
              max: 120,
            })}
            {field("capabilities", "Payment capabilities", {
              optional: true,
              area: true,
              max: 1000,
            })}
          </>
        )}
        {field("message", "How can we help?", { area: true, max: 4000 })}
        <div className="honeypot" aria-hidden="true">
          <label>
            Leave empty
            <input name="companyFax" tabIndex={-1} autoComplete="off" />
          </label>
        </div>
        <p className="note">
          Please don’t include payment data, identity documents, credentials, or
          other secrets. This enquiry does not subscribe you to marketing.
        </p>
        <button className="button" type="submit">
          {busy ? "Sending…" : configured ? "Send enquiry" : "Check enquiry"}
        </button>
      </fieldset>
      <p
        role="status"
        className={`form-status ${status && !success ? "error" : ""}`}
      >
        {status}
      </p>
      {success && (
        <button
          className="text-link"
          type="button"
          onClick={() => {
            setSuccess(false);
            setStatus("");
            reference.current = "";
          }}
        >
          Start another enquiry
        </button>
      )}
      {!configured && (
        <p className="note">
          Online submission is not yet available. You can explore and validate
          this form; nothing will be sent.
        </p>
      )}
    </form>
  );
}
