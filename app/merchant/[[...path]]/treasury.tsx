"use client";
// Merchant-side treasury controls: account activation (identity and payout
// details, terms, submission), payouts and refunds. Every call goes to
// /api/treasury; sensitive ones need a recent authenticator check (step-up).
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { countries } from "@/lib/portal/domain";

function useTreasury(orgId: string) {
  const router = useRouter();
  const [message, setMessage] = useState<{ text: string; error: boolean; stepUp?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  async function run(body: Record<string, unknown>, done: string) {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/treasury", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, ...body }),
      });
      const data = await response.json();
      if (!response.ok) {
        const text = String(data.error || "Request failed");
        setMessage({ text: friendly(text), error: true, stepUp: /authenticator/i.test(text) });
        return null;
      }
      setMessage({ text: done, error: false });
      router.refresh();
      return data;
    } catch {
      setMessage({ text: "We couldn't reach PayRouta. Check your connection and try again.", error: true });
      return null;
    } finally {
      setBusy(false);
    }
  }
  return { run, busy, message };
}

const errors: Record<string, string> = {
  KYB_PROFILE_REQUIRED: "Save your business details first.",
  VERIFICATION_DETAILS_REQUIRED: "Add your identity and bank details first.",
  MERCHANT_TERMS_NOT_ACCEPTED: "Accept the merchant terms first.",
  MERCHANT_ACCOUNT_ALREADY_SUBMITTED: "Your account is already with our team.",
  OWNER_DETAILS_MUST_MATCH_PROFILE: "Add details for every owner listed in your business details.",
  NOTHING_TO_PAY_OUT: "There is nothing available to pay out yet.",
  INSUFFICIENT_AVAILABLE_BALANCE: "That's more than your available balance.",
  PAYOUT_CURRENCY_NOT_SUPPORTED: "Payouts go to your bank account in its own currency; this balance is in another currency.",
  PAYOUTS_PAUSED_RECONCILIATION: "Payouts are paused while we check your balance. We'll be in touch.",
  MERCHANT_NOT_LIVE: "This isn't available while your account is not active.",
  REFUND_EXCEEDS_PAYMENT: "That's more than what remains refundable on this payment.",
  REFUND_NOT_SUPPORTED_ON_RAIL: "This payment was made by bank transfer straight to you, so refund the customer from your bank.",
  EVIDENCE_ALREADY_SUBMITTED: "You've already responded to this dispute.",
  EVIDENCE_DEADLINE_PASSED: "The deadline to respond has passed.",
  DISPUTE_CLOSED: "This dispute has already been decided.",
  EVIDENCE_CUSTOMER_DETAILS_REQUIRED: "Add the customer's name, email and phone number.",
  EVIDENCE_NOT_SUPPORTED_ON_RAIL: "This payment's provider doesn't accept evidence online. Our team will contact you.",
};
const friendly = (code: string) => errors[code] ?? (code.includes(" ") ? code : "Something went wrong. Please try again.");

function Message({ message }: { message: { text: string; error: boolean; stepUp?: boolean } | null }) {
  if (!message) return null;
  return (
    <p role={message.error ? "alert" : "status"} className={`tr-message ${message.error ? "error" : ""}`}>
      {message.text}{" "}
      {message.stepUp && <Link href="/provider/settings">Verify your authenticator</Link>}
    </p>
  );
}

const str = (f: FormData, k: string) => {
  const v = String(f.get(k) ?? "").trim();
  return v || undefined;
};

// Decimal major units → minor units string, or null if malformed.
export function toMinor(value: string, exponent: number) {
  const m = value.trim().match(/^(\d{1,15})(?:\.(\d+))?$/);
  if (!m || (m[2]?.length ?? 0) > exponent) return null;
  const minor = BigInt(m[1]) * 10n ** BigInt(exponent) + BigInt((m[2] ?? "").padEnd(exponent, "0") || "0");
  return minor > 0n ? minor.toString() : null;
}

function Country({ name, defaultValue, label }: { name: string; defaultValue?: string; label: string }) {
  return (
    <label>
      {label}
      <select name={name} defaultValue={defaultValue ?? ""} required>
        <option value="" disabled>
          Select…
        </option>
        {countries.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function Address({ prefix, country }: { prefix: string; country?: string }) {
  return (
    <div className="tr-grid">
      <label className="tr-wide">
        Street address
        <input name={`${prefix}Line1`} required autoComplete="address-line1" />
      </label>
      <label>
        City
        <input name={`${prefix}City`} required autoComplete="address-level2" />
      </label>
      <label>
        State or region <small>(optional)</small>
        <input name={`${prefix}Region`} autoComplete="address-level1" />
      </label>
      <label>
        Postal code <small>(optional)</small>
        <input name={`${prefix}Postal`} autoComplete="postal-code" />
      </label>
      <Country name={`${prefix}Country`} label="Country" defaultValue={country} />
    </div>
  );
}

function Person({ prefix, title, country }: { prefix: string; title: string; country?: string }) {
  return (
    <fieldset className="tr-fieldset">
      <legend>{title}</legend>
      <div className="tr-grid">
        <label>
          Date of birth
          <input type="date" name={`${prefix}Dob`} required />
        </label>
        <label>
          Phone <small>(international format)</small>
          <input name={`${prefix}Phone`} placeholder="+234 801 234 5678" autoComplete="tel" />
        </label>
        <label>
          Nationality <small>(optional)</small>
          <select name={`${prefix}Nationality`} defaultValue="">
            <option value="">—</option>
            {countries.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          ID document <small>(where your country requires one)</small>
          <select name={`${prefix}IdType`} defaultValue="">
            <option value="">—</option>
            <option value="national-id">National ID</option>
            <option value="passport">Passport</option>
            <option value="drivers-licence">Driver&apos;s licence</option>
            <option value="tax-id">Tax ID (e.g. SSN, BVN, NIN)</option>
          </select>
        </label>
        <label>
          ID number
          <input name={`${prefix}IdNumber`} autoComplete="off" />
        </label>
        <label className="tr-check">
          <input type="checkbox" name={`${prefix}Pep`} /> Politically exposed person
        </label>
      </div>
      <p className="tr-hint">Home address</p>
      <Address prefix={prefix} country={country} />
    </fieldset>
  );
}

function person(f: FormData, prefix: string) {
  const phone = str(f, `${prefix}Phone`)?.replace(/[\s()-]/g, "");
  return {
    dateOfBirth: str(f, `${prefix}Dob`),
    phone,
    address: {
      line1: str(f, `${prefix}Line1`),
      city: str(f, `${prefix}City`),
      region: str(f, `${prefix}Region`),
      postalCode: str(f, `${prefix}Postal`),
      country: str(f, `${prefix}Country`),
    },
    idNumber: str(f, `${prefix}IdNumber`)?.replace(/\s/g, ""),
    idType: str(f, `${prefix}IdType`),
    nationality: str(f, `${prefix}Nationality`),
    politicallyExposed: f.get(`${prefix}Pep`) === "on",
  };
}

export function VerificationForm({
  orgId,
  owners,
  country,
  currency,
  saved,
}: {
  orgId: string;
  owners: { name: string }[];
  country?: string;
  currency?: string;
  saved: { payoutAccount?: { accountLast4?: string | null; currency?: string; holderName?: string } } | null;
}) {
  const { run, busy, message } = useTreasury(orgId);
  const [open, setOpen] = useState(!saved);
  if (!open)
    return (
      <div className="tr-saved">
        <p>
          Saved. Payouts go to <strong>{saved?.payoutAccount?.holderName}</strong> ·{" "}
          {saved?.payoutAccount?.currency} account ending <strong>{saved?.payoutAccount?.accountLast4}</strong>. Identity
          details are stored encrypted and never shown again.
        </p>
        <button type="button" className="tr-secondary" onClick={() => setOpen(true)}>
          Replace details
        </button>
      </div>
    );
  return (
    <form
      className="tr-form"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        void run(
          {
            action: "verification-details",
            input: {
              businessPhone: str(f, "businessPhone")?.replace(/[\s()-]/g, ""),
              merchantCategoryCode: str(f, "mcc"),
              incorporationDate: str(f, "incorporationDate"),
              representative: person(f, "rep"),
              owners: owners.map((_, i) => person(f, `owner${i}`)),
              payoutAccount: {
                country: str(f, "bankCountry"),
                currency: str(f, "bankCurrency")?.toUpperCase(),
                holderName: str(f, "holderName"),
                holderType: str(f, "holderType"),
                accountNumber: str(f, "accountNumber")?.replace(/[\s-]/g, ""),
                routingNumber: str(f, "routingNumber")?.replace(/\s/g, ""),
              },
            },
          },
          "Details saved securely.",
        ).then((ok) => ok && setOpen(false));
      }}
    >
      <p className="tr-hint">
        We use these to verify your business with our banking partners and to pay you. They are encrypted and only
        shared for verification.
      </p>
      <div className="tr-grid">
        <label>
          Business phone
          <input name="businessPhone" required placeholder="+44 20 7123 4567" autoComplete="tel" />
        </label>
        <label>
          Date of incorporation <small>(optional)</small>
          <input type="date" name="incorporationDate" />
        </label>
        <label>
          Merchant category code <small>(optional, 4 digits)</small>
          <input name="mcc" inputMode="numeric" pattern="\d{4}" />
        </label>
      </div>
      <Person prefix="rep" title="Your details (account representative)" country={country} />
      {owners.map((o, i) => (
        <Person key={i} prefix={`owner${i}`} title={`Owner: ${o.name}`} country={country} />
      ))}
      <fieldset className="tr-fieldset">
        <legend>Payout bank account</legend>
        <div className="tr-grid">
          <label className="tr-wide">
            Account holder name <small>(must match your business or your own name)</small>
            <input name="holderName" required />
          </label>
          <label>
            Account type
            <select name="holderType" defaultValue="company">
              <option value="company">Business account</option>
              <option value="individual">Personal account</option>
            </select>
          </label>
          <Country name="bankCountry" label="Bank country" defaultValue={country} />
          <label>
            Currency
            <input name="bankCurrency" required defaultValue={currency} maxLength={3} pattern="[A-Za-z]{3}" />
          </label>
          <label>
            Account number or IBAN
            <input name="accountNumber" required autoComplete="off" />
          </label>
          <label>
            Routing / sort code / bank code <small>(if your country uses one)</small>
            <input name="routingNumber" autoComplete="off" />
          </label>
        </div>
      </fieldset>
      <div className="tr-actions">
        <button disabled={busy}>{busy ? "Saving…" : "Save details"}</button>
        {saved && (
          <button type="button" className="tr-secondary" onClick={() => setOpen(false)}>
            Cancel
          </button>
        )}
      </div>
      <Message message={message} />
    </form>
  );
}

export function AcceptTerms({ orgId, accepted }: { orgId: string; accepted: string | null }) {
  const { run, busy, message } = useTreasury(orgId);
  const [checked, setChecked] = useState(false);
  if (accepted) return <p>Accepted on {new Date(accepted).toUTCString().slice(5, 16)}.</p>;
  return (
    <div>
      <label className="tr-check">
        <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} /> I agree to the
        PayRouta Merchant Terms (version 2026-10-09), including the terms of PayRouta&apos;s payment processing
        partners, on behalf of my business.
      </label>
      <div className="tr-actions">
        <button disabled={!checked || busy} onClick={() => void run({ action: "accept-terms" }, "Terms accepted.")}>
          Accept terms
        </button>
      </div>
      <Message message={message} />
    </div>
  );
}

export function SubmitForReview({ orgId, ready, resubmit }: { orgId: string; ready: boolean; resubmit: boolean }) {
  const { run, busy, message } = useTreasury(orgId);
  return (
    <div>
      <div className="tr-actions">
        <button disabled={!ready || busy} onClick={() => void run({ action: "submit" }, "Submitted. We'll email you when we've reviewed it.")}>
          {busy ? "Submitting…" : resubmit ? "Resubmit for review" : "Submit for review"}
        </button>
      </div>
      <Message message={message} />
    </div>
  );
}

export function PayoutRequest({
  orgId,
  balances,
}: {
  orgId: string;
  balances: { asset: string; available: string; label: string; exponent: number }[];
}) {
  const { run, busy, message } = useTreasury(orgId);
  const [asset, setAsset] = useState(balances[0]?.asset ?? "");
  const [amount, setAmount] = useState("");
  const current = balances.find((b) => b.asset === asset);
  if (!balances.length) return null;
  return (
    <form
      className="tr-inline"
      onSubmit={(e) => {
        e.preventDefault();
        const minor = amount ? toMinor(amount, current?.exponent ?? 2) : undefined;
        if (amount && !minor) return;
        void run({ action: "payout", asset, ...(minor ? { amountMinor: minor } : {}) }, "Payout on its way to your bank.");
      }}
    >
      {balances.length > 1 && (
        <label>
          Currency
          <select value={asset} onChange={(e) => setAsset(e.target.value)}>
            {balances.map((b) => (
              <option key={b.asset} value={b.asset}>
                {b.asset.slice(5, 8)}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        Amount <small>(leave empty for everything available)</small>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder={current?.label} />
      </label>
      <button disabled={busy || current?.available === "0"}>{busy ? "Sending…" : "Pay out now"}</button>
      <Message message={message} />
    </form>
  );
}

const reasons = [
  ["requested_by_customer", "Requested by customer"],
  ["duplicate", "Duplicate payment"],
  ["fraudulent", "Fraudulent"],
  ["other", "Other"],
] as const;

export function RefundPanel({
  orgId,
  intentId,
  remainingLabel,
  remainingMinor,
  exponent,
}: {
  orgId: string;
  intentId: string;
  remainingLabel: string;
  remainingMinor: string;
  exponent: number;
}) {
  const { run, busy, message } = useTreasury(orgId);
  const [open, setOpen] = useState(false);
  if (remainingMinor === "0") return <p className="tr-hint">This payment has been fully refunded.</p>;
  if (!open)
    return (
      <>
        <button className="tr-secondary" onClick={() => setOpen(true)}>
          Refund payment
        </button>
        <Message message={message} />
      </>
    );
  return (
    <form
      className="tr-form"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const raw = String(f.get("amount") || "").trim();
        const minor = raw ? toMinor(raw, exponent) : undefined;
        if (raw && !minor) return;
        void run(
          {
            action: "refund",
            intentId,
            ...(minor ? { amountMinor: minor } : {}),
            reason: reasons.find(([v]) => v === f.get("reason"))?.[1],
          },
          "Refund started. The customer usually sees it in 5–10 business days.",
        ).then((ok) => ok && setOpen(false));
      }}
    >
      <div className="tr-grid">
        <label>
          Amount <small>(up to {remainingLabel}; leave empty for the full amount)</small>
          <input name="amount" inputMode="decimal" />
        </label>
        <label>
          Reason
          <select name="reason" defaultValue="requested_by_customer">
            {reasons.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="tr-hint">Refunds come out of your balance. PayRouta&apos;s fee for the original payment is not returned.</p>
      <div className="tr-actions">
        <button disabled={busy}>{busy ? "Refunding…" : "Refund"}</button>
        <button type="button" className="tr-secondary" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      <Message message={message} />
    </form>
  );
}

// The merchant's response to a dispute, modelled on processors' evidence
// forms: what was sold, who bought it, proof of delivery, the refund policy
// and anything else that shows the charge was valid.
export function DisputeResponse({ orgId, disputeId, reason }: { orgId: string; disputeId: string; reason: string | null }) {
  const { run, busy, message } = useTreasury(orgId);
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <button className="tr-secondary" onClick={() => setOpen(true)}>
        Respond
      </button>
    );
  const delivery = reason === "product_not_received" || reason === "fraudulent";
  return (
    <form
      className="tr-form tr-evidence"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const evidence = Object.fromEntries(
          [
            "productDescription", "customerName", "customerEmail", "customerPhone", "serviceDate",
            "shippingCarrier", "shippingTrackingNumber", "shippingDate", "deliveryAddress", "refundPolicy", "explanation",
          ]
            .map((k) => [k, str(f, k)])
            .filter(([, v]) => v),
        );
        void run({ action: "dispute-evidence", disputeId, evidence }, "Evidence sent. The card network usually decides within 60–75 days.").then(
          (ok) => ok && setOpen(false),
        );
      }}
    >
      <p className="tr-hint">
        You can respond once. Be specific and factual: the customer&apos;s bank decides based only on what you send.
      </p>
      <label>
        What did the customer buy? <small>(at least 20 characters)</small>
        <textarea name="productDescription" rows={3} required minLength={20} />
      </label>
      <div className="tr-grid">
        <label>
          Customer name
          <input name="customerName" />
        </label>
        <label>
          Customer email
          <input name="customerEmail" type="email" />
        </label>
        <label>
          Customer phone
          <input name="customerPhone" type="tel" />
        </label>
        <label>
          Date of service or purchase
          <input name="serviceDate" type="date" />
        </label>
      </div>
      <fieldset className="tr-fieldset">
        <legend>Delivery {delivery ? "" : "(if a physical product)"}</legend>
        <div className="tr-grid">
          <label>
            Carrier
            <input name="shippingCarrier" />
          </label>
          <label>
            Tracking number
            <input name="shippingTrackingNumber" />
          </label>
          <label>
            Delivered on
            <input name="shippingDate" type="date" />
          </label>
          <label className="tr-wide">
            Delivery address
            <input name="deliveryAddress" />
          </label>
        </div>
      </fieldset>
      <label>
        Your refund policy, as shown to the customer
        <textarea name="refundPolicy" rows={2} />
      </label>
      <label>
        Anything else that shows the payment was valid
        <textarea name="explanation" rows={3} />
      </label>
      <div className="tr-actions">
        <button disabled={busy}>{busy ? "Sending…" : "Send evidence"}</button>
        <button type="button" className="tr-secondary" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      <Message message={message} />
    </form>
  );
}
