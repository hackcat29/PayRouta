"use client";
import { useRef, useState } from "react";
import {
  accessMethods,
  accessProviderTypes,
  accessRequestSchema,
} from "@/lib/portal/access-request-schema";
import { track } from "@/lib/analytics";
import { errorText } from "@/lib/error-copy";

type Errors = Record<string, string[] | undefined>;

// Payment providers ask for access here; operations reviews each request and
// emails an invitation when it's approved.
export function ProviderAccessForm() {
  const [errors, setErrors] = useState<Errors>({});
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const submission = useRef("");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const form = e.currentTarget;
    const f = new FormData(form);
    submission.current ||= crypto.randomUUID();
    const parsed = accessRequestSchema.safeParse({
      submissionId: submission.current,
      name: f.get("name"),
      email: f.get("email"),
      company: f.get("company"),
      website: f.get("website"),
      country: f.get("country"),
      providerType: f.get("providerType") || undefined,
      methods: f.getAll("methods"),
      markets: f.get("markets"),
      message: f.get("message"),
      companyFax: f.get("companyFax"),
    });
    if (!parsed.success) {
      const fieldErrors = parsed.error.flatten().fieldErrors as Errors;
      setErrors(fieldErrors);
      setStatus("Please check the highlighted fields.");
      form.querySelector<HTMLElement>(`[name="${Object.keys(fieldErrors)[0]}"]`)?.focus();
      return;
    }
    setErrors({});
    setBusy(true);
    setStatus("Sending your request…");
    try {
      const response = await fetch("/api/provider-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const data = await response.json().catch(() => ({}));
      if (data.errors) setErrors(data.errors);
      setStatus(response.ok ? data.message : errorText(data, response.status));
      setDone(response.ok);
      track("provider_access_request", { outcome: response.ok ? "accepted" : "rejected" });
    } catch {
      setStatus("We couldn't confirm your request was saved. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const error = (name: string) =>
    errors[name] && (
      <span id={`${name}-error`} className="field-error">
        {errors[name]?.[0]}
      </span>
    );
  const described = (name: string) => ({
    "aria-invalid": !!errors[name],
    "aria-describedby": errors[name] ? `${name}-error` : undefined,
  });
  const input = (name: string, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="field" htmlFor={`pa-${name}`}>
      <span>{label}</span>
      <input id={`pa-${name}`} name={name} required maxLength={160} {...described(name)} {...props} />
      {error(name)}
    </label>
  );

  if (done)
    return (
      <div className="contact-form" role="status">
        <h3 className="mk-box-title">Request received</h3>
        <p>{status}</p>
      </div>
    );

  return (
    <form className="contact-form" onSubmit={submit} noValidate>
      <fieldset disabled={busy}>
        <div className="form-grid">
          {input("name", "Your name", { autoComplete: "name", maxLength: 100 })}
          {input("email", "Work email", { type: "email", autoComplete: "email", maxLength: 254 })}
          {input("company", "Company", { autoComplete: "organization" })}
          {input("website", "Website", { type: "url", autoComplete: "url", placeholder: "https://", maxLength: 500 })}
          {input("country", "Country of registration", { autoComplete: "country-name", maxLength: 100 })}
          <label className="field" htmlFor="pa-providerType">
            <span>What kind of payment service do you run?</span>
            <select id="pa-providerType" name="providerType" required defaultValue="" {...described("providerType")}>
              <option value="" disabled>
                Choose one
              </option>
              {accessProviderTypes.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            {error("providerType")}
          </label>
        </div>
        <fieldset {...described("methods")}>
          <legend>Payment methods you can process</legend>
          <div className="checkbox-grid">
            {accessMethods.map((m) => (
              <label key={m}>
                <input type="checkbox" name="methods" value={m} />
                {m}
              </label>
            ))}
          </div>
          {error("methods")}
        </fieldset>
        <label className="field" htmlFor="pa-markets">
          <span>Countries where you can process payments</span>
          <input
            id="pa-markets"
            name="markets"
            required
            maxLength={500}
            placeholder="For example: Nigeria, Ghana, Kenya"
            {...described("markets")}
          />
          {error("markets")}
        </label>
        <label className="field" htmlFor="pa-message">
          <span>Anything else we should know? (optional)</span>
          <textarea
            id="pa-message"
            name="message"
            maxLength={2000}
            placeholder="Licences you hold, settlement currencies, volumes you can support"
            {...described("message")}
          />
          {error("message")}
        </label>
        <div className="honeypot" aria-hidden="true">
          <label>
            Leave empty
            <input name="companyFax" tabIndex={-1} autoComplete="off" />
          </label>
        </div>
        <p className="note">
          Don&apos;t include credentials, API keys or identity documents. We&apos;ll ask for documents after
          approval, inside the provider workspace.
        </p>
        <button className="button" type="submit">
          {busy ? "Sending…" : "Request provider access"}
        </button>
      </fieldset>
      <p role="status" className={`form-status ${status && !done ? "error" : ""}`}>
        {status}
      </p>
    </form>
  );
}
