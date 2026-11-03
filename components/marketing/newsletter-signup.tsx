"use client";
import { useState } from "react";
import { turnstileHeader } from "@/lib/turnstile";
import { Turnstile, turnstileSiteKey } from "../turnstile";

// Double opt-in: the API emails a confirmation link; nothing else is sent
// until it's clicked.
export function NewsletterSignup() {
  const [email, setEmail] = useState("");
  const [honeypot, setHoneypot] = useState("");
  // The check starts when someone reaches for the field, not on every page view.
  const [engaged, setEngaged] = useState(false);
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const [state, setState] = useState<{ status: "idle" | "busy" | "done" | "error"; message?: string }>({
    status: "idle",
  });

  return (
    <form
      className="mk-subscribe"
      onSubmit={async (e) => {
        e.preventDefault();
        setState({ status: "busy" });
        try {
          const res = await fetch("/api/marketing/subscribe", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(captcha ? { [turnstileHeader]: captcha } : {}),
            },
            body: JSON.stringify({ email, source: "website_footer", website_url_hp: honeypot }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || "We couldn't sign you up. Try again.");
          setState({ status: "done", message: data.message });
          setEmail("");
        } catch (err) {
          setState({ status: "error", message: err instanceof Error ? err.message : "Something went wrong." });
        }
        setCaptcha(null);
        setRound((n) => n + 1);
      }}
    >
      <label htmlFor="newsletter-email" className="mk-sr">Email address</label>
      <div>
        <input
          id="newsletter-email"
          type="email"
          autoComplete="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onFocus={() => setEngaged(true)}
          required
          disabled={state.status === "busy"}
        />
        <button className="mk-btn primary" disabled={state.status === "busy" || (!!turnstileSiteKey && !captcha)}>
          {state.status === "busy" ? "Sending…" : "Subscribe"}
        </button>
      </div>
      <input
        className="mk-hp"
        type="text"
        name="website_url_hp"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        value={honeypot}
        onChange={(e) => setHoneypot(e.target.value)}
      />
      {engaged && <Turnstile quiet onToken={setCaptcha} round={round} />}
      {state.message && (
        <p role="status" className={state.status === "error" ? "error" : undefined}>
          {state.message}
        </p>
      )}
    </form>
  );
}
