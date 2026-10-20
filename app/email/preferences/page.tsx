"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";

type Topic = { id: string; label: string };
interface PreferenceData {
  email: string;
  name?: string;
  status: string;
  topics: string[];
  availableTopics: Topic[];
}

async function post(body: object) {
  const res = await fetch("/api/marketing/preferences", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong. Try again.");
  return data as { message: string; subscriber: PreferenceData };
}

// Linked from every marketing email: confirm (double opt-in), choose topics,
// or unsubscribe. "action=unsub" unsubscribes straight away; "action=confirm"
// waits for a click, so link scanners can't subscribe anyone.
export default function PreferencesPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; action?: string }>;
}) {
  const { token, action } = use(searchParams);
  const [data, setData] = useState<PreferenceData>();
  const [topics, setTopics] = useState<string[]>([]);
  const [error, setError] = useState(token ? "" : "This link is missing its token. Use the link from your email.");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const res = await fetch(`/api/marketing/preferences?token=${encodeURIComponent(token)}`);
        const loaded = await res.json();
        if (!res.ok) throw new Error(loaded.error || "This link isn't valid any more.");
        if (action === "unsub" && loaded.status !== "unsubscribed") {
          const r = await post({ token, unsubscribeAll: true });
          setNotice(r.message);
          setData(r.subscriber);
          setTopics([]);
        } else {
          setData(loaded);
          setTopics(loaded.topics || []);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "This link isn't valid any more.");
      }
    })();
  }, [token, action]);

  async function run(body: object) {
    setBusy(true);
    setNotice("");
    try {
      const r = await post({ token, ...body });
      setData(r.subscriber);
      setTopics(r.subscriber.topics || []);
      setNotice(r.message);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const pending = data?.status === "pending";
  const suppressed = data?.status === "bounced" || data?.status === "complained";

  return (
    <div className="mk">
      <section className="mk-article mk-prefs">
        <div>
          <h1 className="mk-h1">
            {pending ? "Confirm your subscription" : "Choose what we send you"}
          </h1>
          {error ? (
            <p className="mk-lead" role="alert">
              {error}
            </p>
          ) : !data ? (
            <p className="mk-lead">Loading…</p>
          ) : pending ? (
            <>
              <p className="mk-lead">
                Confirm that <strong>{data.email}</strong> should get emails from
                PayRouta. If you didn&apos;t sign up, close this page and you
                won&apos;t hear from us.
              </p>
              <div className="mk-actions">
                <button className="mk-btn primary" disabled={busy} onClick={() => run({ confirm: true })}>
                  Confirm subscription
                </button>
              </div>
              {notice && <p role="status">{notice}</p>}
            </>
          ) : (
            <>
              <p className="mk-lead">
                Emails to <strong>{data.email}</strong>.{" "}
                {suppressed
                  ? "We've stopped sending to this address because mail to it bounced or was reported as spam."
                  : data.status === "unsubscribed"
                    ? "You're unsubscribed. Pick topics below to start again."
                    : "Untick anything you don't want."}
              </p>
              {notice && (
                <p role="status" className="mk-notice">
                  {notice}
                </p>
              )}
              <form
                className="mk-prefs-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  run({ topics });
                }}
              >
                <fieldset disabled={busy || suppressed}>
                  <legend className="mk-sr">Topics</legend>
                  {data.availableTopics.map((t) => (
                    <label key={t.id}>
                      <input
                        type="checkbox"
                        checked={topics.includes(t.id)}
                        onChange={() =>
                          setTopics((p) => (p.includes(t.id) ? p.filter((x) => x !== t.id) : [...p, t.id]))
                        }
                      />
                      {t.label}
                    </label>
                  ))}
                </fieldset>
                <div className="mk-actions">
                  <button className="mk-btn primary" disabled={busy || suppressed}>
                    Save preferences
                  </button>
                  {data.status !== "unsubscribed" && !suppressed && (
                    <button
                      type="button"
                      className="mk-btn secondary"
                      disabled={busy}
                      onClick={() => run({ unsubscribeAll: true })}
                    >
                      Unsubscribe from everything
                    </button>
                  )}
                </div>
              </form>
              <p className="mk-note">
                Account emails, such as password resets, security notices and
                receipts, are always sent. They aren&apos;t marketing.
              </p>
            </>
          )}
          <p className="mk-note">
            <Link href="/">PayRouta home</Link>
          </p>
        </div>
      </section>
    </div>
  );
}
