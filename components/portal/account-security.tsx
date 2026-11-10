"use client";
// Your account's security, the same in every dashboard: two-step
// verification (an authenticator app, passkeys, recovery codes), your
// password, and the devices signed in. Sensitive actions ask you to confirm
// with one of these (step-up.tsx).
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { authClient, PasskeySettings } from "./auth-screen";
import "./account-security.css";

type Message = { text: string; error?: boolean } | null;

function Note({ message }: { message: Message }) {
  if (!message) return null;
  return (
    <p role={message.error ? "alert" : "status"} className={`as-note${message.error ? " error" : ""}`}>
      {message.text}
    </p>
  );
}

// The secret inside an otpauth:// URI, in groups of four for typing.
const setupKey = (uri: string) => (new URL(uri).searchParams.get("secret") ?? "").replace(/(.{4})/g, "$1 ").trim();

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const text = codes.join("\n");
  return (
    <div className="as-codes">
      <h3>Save your recovery codes</h3>
      <p>Each code works once if you lose your phone. They won&apos;t be shown again.</p>
      <ol>
        {codes.map((c) => (
          <li key={c}>
            <code>{c}</code>
          </li>
        ))}
      </ol>
      <div className="as-row">
        <button
          type="button"
          className="as-btn"
          onClick={() => void navigator.clipboard.writeText(text).then(() => setCopied(true))}
        >
          {copied ? "Copied" : "Copy"}
        </button>
        <a className="as-btn" download="payrouta-recovery-codes.txt" href={`data:text/plain;charset=utf-8,${encodeURIComponent(text + "\n")}`}>
          Download
        </a>
        <button type="button" className="as-btn primary" onClick={onDone}>
          I&apos;ve saved them
        </button>
      </div>
    </div>
  );
}

function Authenticator({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [step, setStep] = useState<"idle" | "password" | "scan" | "codes" | "off" | "regenerate">("idle");
  const [uri, setUri] = useState("");
  const [qr, setQr] = useState("");
  const [codes, setCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  useEffect(() => {
    if (uri) void QRCode.toDataURL(uri, { width: 200, margin: 1 }).then(setQr);
  }, [uri]);
  async function run(work: () => Promise<void>) {
    setBusy(true);
    setMessage(null);
    try {
      await work();
    } catch (e) {
      setMessage({ text: (e as Error).message || "Something went wrong. Try again.", error: true });
    } finally {
      setBusy(false);
    }
  }
  const password = (label: string, submit: (password: string) => Promise<void>) => (
    <form
      className="as-form"
      onSubmit={(e) => {
        e.preventDefault();
        const value = String(new FormData(e.currentTarget).get("password"));
        void run(() => submit(value));
      }}
    >
      <label htmlFor="as-password">Your password</label>
      <input id="as-password" name="password" type="password" autoComplete="current-password" required autoFocus />
      <div className="as-row">
        <button className="as-btn primary" disabled={busy}>
          {busy ? "Please wait…" : label}
        </button>
        <button type="button" className="as-btn" onClick={() => setStep("idle")}>
          Cancel
        </button>
      </div>
    </form>
  );

  return (
    <div className="as-item">
      <div className="as-item-head">
        <div>
          <h3>Authenticator app</h3>
          <p>Google Authenticator, Microsoft Authenticator, 1Password, Authy or any app that shows 6-digit codes.</p>
        </div>
        <span className={`as-pill${enabled ? " on" : ""}`}>{enabled ? "On" : "Off"}</span>
      </div>
      {step === "idle" &&
        (enabled ? (
          <div className="as-row">
            <button type="button" className="as-btn" onClick={() => setStep("regenerate")}>
              New recovery codes
            </button>
            <button type="button" className="as-btn" onClick={() => setStep("off")}>
              Turn off
            </button>
          </div>
        ) : (
          <button type="button" className="as-btn primary" onClick={() => setStep("password")}>
            Set up
          </button>
        ))}
      {step === "password" &&
        password("Continue", async (pw) => {
          const r = await authClient.twoFactor.enable({ password: pw });
          if (r.error) throw new Error(r.error.message || "That password isn't right.");
          if (!r.data || !("totpURI" in r.data)) throw new Error("Something went wrong. Try again.");
          setUri(r.data.totpURI);
          setCodes(r.data.backupCodes);
          setStep("scan");
        })}
      {step === "scan" && (
        <div className="as-scan">
          {/* eslint-disable-next-line @next/next/no-img-element -- generated QR code */}
          {qr && <img src={qr} alt="QR code for your authenticator app" width={176} height={176} />}
          <form
            className="as-form"
            onSubmit={(e) => {
              e.preventDefault();
              const code = String(new FormData(e.currentTarget).get("code")).replace(/\s/g, "");
              void run(async () => {
                const r = await authClient.twoFactor.verifyTotp({ code, trustDevice: false });
                if (r.error) throw new Error("That code isn't right. Codes change every 30 seconds.");
                setStep("codes");
              });
            }}
          >
            <ol className="as-steps">
              <li>Open your authenticator app and scan the code.</li>
              <li>
                Can&apos;t scan? Enter this key: <code className="as-key">{setupKey(uri)}</code>
              </li>
              <li>Enter the 6-digit code it shows.</li>
            </ol>
            <label htmlFor="as-code">6-digit code</label>
            <input id="as-code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required autoFocus />
            <div className="as-row">
              <button className="as-btn primary" disabled={busy}>
                {busy ? "Checking…" : "Turn on"}
              </button>
              <button type="button" className="as-btn" onClick={() => setStep("idle")}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
      {step === "codes" && (
        <RecoveryCodes
          codes={codes}
          onDone={() => {
            setStep("idle");
            setUri("");
            setCodes([]);
            router.refresh();
          }}
        />
      )}
      {step === "regenerate" &&
        password("Create new codes", async (pw) => {
          const r = await authClient.twoFactor.generateBackupCodes({ password: pw });
          if (r.error || !r.data) throw new Error(r.error?.message || "That password isn't right.");
          setCodes(r.data.backupCodes);
          setStep("codes");
        })}
      {step === "off" &&
        password("Turn off", async (pw) => {
          const r = await authClient.twoFactor.disable({ password: pw });
          if (r.error) throw new Error(r.error.message || "That password isn't right.");
          setStep("idle");
          setMessage({ text: "Authenticator app turned off." });
          router.refresh();
        })}
      <Note message={message} />
    </div>
  );
}

function Password() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  return (
    <section className="as-card">
      <div className="as-item-head">
        <h2>Password</h2>
        {!open && (
          <button type="button" className="as-btn" onClick={() => setOpen(true)}>
            Change
          </button>
        )}
      </div>
      {open && (
        <form
          className="as-form as-grid"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const next = String(f.get("new"));
            if (next !== String(f.get("confirm"))) return setMessage({ text: "The new passwords don't match.", error: true });
            setBusy(true);
            setMessage(null);
            void authClient
              .changePassword({ currentPassword: String(f.get("current")), newPassword: next, revokeOtherSessions: true })
              .then((r) => {
                if (r.error) setMessage({ text: r.error.message || "That password isn't right.", error: true });
                else {
                  setMessage({ text: "Password changed. Other devices were signed out." });
                  setOpen(false);
                }
              })
              .finally(() => setBusy(false));
          }}
        >
          <label>
            Current password
            <input name="current" type="password" autoComplete="current-password" required />
          </label>
          <label>
            New password
            <input name="new" type="password" autoComplete="new-password" minLength={12} maxLength={128} required />
          </label>
          <label>
            Confirm new password
            <input name="confirm" type="password" autoComplete="new-password" minLength={12} maxLength={128} required />
          </label>
          <div className="as-row as-wide">
            <button className="as-btn primary" disabled={busy}>
              {busy ? "Please wait…" : "Change password"}
            </button>
            <button type="button" className="as-btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      <Note message={message} />
    </section>
  );
}

type SessionRow = { id: string; token: string; userAgent?: string | null; ipAddress?: string | null; updatedAt: string | Date };
const device = (ua?: string | null) => {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
};

function Sessions() {
  const current = authClient.useSession();
  const [rows, setRows] = useState<SessionRow[] | null>(null);
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const load = () =>
    void authClient.listSessions().then((r) => setRows(((r.data ?? []) as SessionRow[]).sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt))));
  useEffect(load, []);
  const mine = current.data?.session.token;
  return (
    <section className="as-card">
      <div className="as-item-head">
        <h2>Signed-in devices</h2>
        {rows && rows.length > 1 && (
          <button
            type="button"
            className="as-btn"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void authClient
                .revokeOtherSessions()
                .then((r) => setMessage(r.error ? { text: "Couldn't sign out the other devices.", error: true } : { text: "Other devices signed out." }))
                .finally(() => {
                  setBusy(false);
                  load();
                });
            }}
          >
            Sign out other devices
          </button>
        )}
      </div>
      {!rows ? (
        <p role="status">Loading…</p>
      ) : (
        <ul className="as-list">
          {(all ? rows : rows.slice(0, 5)).map((s) => (
            <li key={s.id}>
              <span>
                <strong>{device(s.userAgent)}</strong>
                <small>
                  {s.token === mine ? "This device" : `Active ${new Date(s.updatedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`}
                  {s.ipAddress ? ` · ${s.ipAddress}` : ""}
                </small>
              </span>
              {s.token !== mine && (
                <button
                  type="button"
                  className="as-btn"
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    void authClient.revokeSession({ token: s.token }).finally(() => {
                      setBusy(false);
                      load();
                    });
                  }}
                >
                  Sign out
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {rows && rows.length > 5 && !all && (
        <button type="button" className="as-btn" onClick={() => setAll(true)}>
          Show all {rows.length}
        </button>
      )}
      <Note message={message} />
    </section>
  );
}

export function AccountSecurity({ twoFactorEnabled }: { twoFactorEnabled: boolean }) {
  return (
    <div className="as">
      <section className="as-card">
        <div className="as-item-head">
          <h2>Two-step verification</h2>
        </div>
        <Authenticator enabled={twoFactorEnabled} />
        <div className="as-item">
          <div className="as-item-head">
            <div>
              <h3>Passkeys</h3>
              <p>Face ID, Touch ID, Windows Hello, a security key, or your Google or iCloud password manager.</p>
            </div>
          </div>
          <PasskeySettings />
        </div>
      </section>
      <Password />
      <Sessions />
    </div>
  );
}
