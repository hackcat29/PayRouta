"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createAuthClient } from "better-auth/react";
import { emailOTPClient, twoFactorClient } from "better-auth/client/plugins";
import { passkeyClient } from "@better-auth/passkey/client";
import { ssoClient } from "@better-auth/sso/client";
import { BrandLogo } from "../brand-logo";
import { Field } from "./ui";
export const authClient = createAuthClient({
  plugins: [
    twoFactorClient(),
    emailOTPClient(),
    passkeyClient(),
    ssoClient({ domainVerification: { enabled: true } }),
  ],
});
type Step =
  | "credentials"
  | "factor"
  | "reset"
  | "check-email"
  | "reset-sent"
  | "code-request"
  | "code"
  | "sso";

const titles: Record<Step, [signIn: string, signUp: string]> = {
  credentials: ["Sign in", "Create your account"],
  factor: ["Two-step verification", "Two-step verification"],
  reset: ["Reset your password", "Reset your password"],
  "check-email": ["Check your email", "Check your email"],
  "reset-sent": ["Check your email", "Check your email"],
  "code-request": ["Sign in with a code", "Sign in with a code"],
  code: ["Enter your code", "Enter your code"],
  sso: ["Company single sign-on", "Company single sign-on"],
};

// Shared by /sign-in and /sign-up (merchants) and /provider/sign-in and
// /provider/sign-up (payment providers). `base` keeps links on the same set.
// Providers join by invitation: their sign-up is reachable only from an
// invitation link, so provider sign-in points everyone else to the request
// form.
export function AuthScreen({
  signUp = false,
  local = false,
  next,
  base = "/provider",
  google = false,
}: {
  signUp?: boolean;
  local?: boolean;
  next?: string;
  base?: "" | "/provider";
  google?: boolean;
}) {
  const merchant = next ? next.startsWith("/merchant") : base === "";
  const home = next ?? (merchant ? "/merchant" : "/provider/overview");
  const suffix = next ? `?next=${encodeURIComponent(next)}` : "";
  const router = useRouter();
  const [message, setMessage] = useState<{ text: string; error?: boolean }>();
  const [step, setStep] = useState<Step>("credentials");
  const [recovery, setRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const callbackURL = next ?? (merchant ? "/merchant" : "/provider/overview");
  const invited = !!next?.includes("invitation=");
  const errorCallbackURL = `${base}/sign-in`;
  const go = (s: Step) => {
    setStep(s);
    setMessage(undefined);
  };

  // Offer saved passkeys in the email field's autofill where the browser can.
  useEffect(() => {
    if (signUp || step !== "credentials" || typeof window === "undefined")
      return;
    const pk = window.PublicKeyCredential as unknown as {
      isConditionalMediationAvailable?: () => Promise<boolean>;
    };
    let cancelled = false;
    pk?.isConditionalMediationAvailable?.().then((ok) => {
      if (!ok || cancelled) return;
      void authClient.signIn.passkey({ autoFill: true }).then((r) => {
        if (!cancelled && r && !r.error) router.push(home);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [signUp, step, home, router]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setMessage(undefined);
    try {
      await action();
    } catch (e) {
      setMessage({
        text:
          e instanceof Error ? e.message : "Something went wrong. Try again.",
        error: true,
      });
    } finally {
      setBusy(false);
    }
  }

  const withGoogle = () =>
    run(async () => {
      const r = await authClient.signIn.social({
        provider: "google",
        callbackURL,
        newUserCallbackURL: callbackURL,
        errorCallbackURL,
      });
      if (r.error)
        throw new Error(
          r.error.message || "Google sign-in didn't start. Try again.",
        );
    });

  const withPasskey = () =>
    run(async () => {
      const r = await authClient.signIn.passkey();
      if (r?.error)
        throw new Error(
          "That passkey didn't work. Try again, or use another way to sign in.",
        );
      router.push(home);
    });

  async function resendVerification() {
    setBusy(true);
    const r = await authClient.sendVerificationEmail({ email, callbackURL });
    setBusy(false);
    setMessage(
      r.error
        ? {
            text:
              r.error.message ||
              "We couldn't send the email. Try again shortly.",
            error: true,
          }
        : { text: "Sent. The new link replaces the old one." },
    );
  }

  async function submit(f: FormData) {
    if (step === "factor") {
      const code = String(f.get("code")).trim();
      const r = recovery
        ? await authClient.twoFactor.verifyBackupCode({ code })
        : await authClient.twoFactor.verifyTotp({ code, trustDevice: false });
      if (r.error)
        throw new Error(
          recovery
            ? "That recovery code isn't valid."
            : "That code isn't right. Codes change every 30 seconds.",
        );
      return router.push(home);
    }
    if (step === "reset") {
      const r = await authClient.requestPasswordReset({
        email,
        redirectTo: `${base}/reset-password`,
      });
      if (r.error) throw new Error(r.error.message);
      return go("reset-sent");
    }
    if (step === "code-request") {
      const r = await authClient.emailOtp.sendVerificationOtp({
        email,
        type: "sign-in",
      });
      if (r.error)
        throw new Error(
          r.error.status === 429
            ? "Too many codes requested. Wait a few minutes."
            : r.error.message || "We couldn't send a code.",
        );
      return go("code");
    }
    if (step === "code") {
      const r = await authClient.signIn.emailOtp({
        email,
        otp: String(f.get("code")).trim(),
      });
      if (r.error)
        throw new Error(
          r.error.code === "TWO_FACTOR_REQUIRED"
            ? r.error.message ||
                "This account uses two-step verification. Sign in with your password or a passkey."
            : "That code isn't right or has expired.",
        );
      return router.push(home);
    }
    if (step === "sso") {
      const r = await authClient.signIn.sso({
        email,
        callbackURL,
        errorCallbackURL,
      });
      if (r.error)
        throw new Error(
          "Single sign-on isn't set up for that email's company. Ask your admin, or use another way to sign in.",
        );
      const url = (r.data as { url?: string } | null)?.url;
      if (url) window.location.href = url;
      return;
    }
    if (signUp) {
      const r = await authClient.signUp.email({
        name: String(f.get("name")),
        email,
        password: String(f.get("password")),
        callbackURL,
      });
      if (r.error) throw new Error(r.error.message);
      return go("check-email");
    }
    const r = await authClient.signIn.email({
      email,
      password: String(f.get("password")),
      callbackURL,
    });
    if (r.error) {
      // Unverified: better-auth has just sent a fresh verification link.
      if (r.error.status === 403) return go("check-email");
      throw new Error(
        r.error.status === 429
          ? "Too many attempts. Wait a minute and try again."
          : "That email and password don't match.",
      );
    }
    if (r.data && "twoFactorRedirect" in r.data && r.data.twoFactorRedirect)
      return go("factor");
    router.push(home);
  }

  const intro: Partial<Record<Step, string>> = {
    reset:
      "Enter your account email and we'll send you a link to choose a new password.",
    "code-request": "We'll email you a 6-digit code. No password needed.",
    code: `Enter the 6-digit code we sent to ${email}. It expires in 10 minutes.`,
    sso: "Enter your work email and we'll send you to your company's sign-in page.",
  };
  const submitLabel: Partial<Record<Step, string>> = {
    factor: "Verify",
    reset: "Send reset link",
    "code-request": "Email me a code",
    code: "Sign in",
    sso: "Continue",
  };

  return (
    <div className={`portal p-auth ${signUp ? "is-signup" : "is-signin"}`}>
      <div className="p-auth-brand">
        <Link href="/" className="p-auth-logo">
          <BrandLogo />
        </Link>
        {signUp && (
          <ul className="p-auth-points">
            {(merchant
              ? [
                  ["Start in test mode today", "No paperwork until you're ready to take real payments."],
                  ["Every way your customers pay", "Cards, bank transfers, wallets, mobile money, stablecoins and crypto."],
                  ["A backup behind every method", "If a processor fails, the same payment goes through another."],
                ]
              : [
                  ["Describe what you support", "Methods, markets and currencies, in one application."],
                  ["Test in the sandbox", "Run scenarios against your integration before review."],
                  ["Follow your review", "See every decision and request in one place."],
                ]
            ).map(([title, text]) => (
              <li key={title}>
                <span aria-hidden>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                    <path d="m5 12.5 4.5 4.5L19 7.5" />
                  </svg>
                </span>
                <div>
                  <strong>{title}</strong>
                  <p>{text}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="p-auth-form">
        <div className="p-auth-card">
          <h1>{titles[step][signUp ? 1 : 0]}</h1>
          {step === "check-email" || step === "reset-sent" ? (
            <>
              <p>
                {step === "check-email" ? (
                  <>
                    We&apos;ve sent a link to <strong>{email}</strong>. Open it
                    to confirm your email and you&apos;ll be signed in.
                  </>
                ) : (
                  <>
                    If there&apos;s an account for <strong>{email}</strong>,
                    we&apos;ve sent a link to reset the password. It expires in
                    one hour.
                  </>
                )}
              </p>
              <p>Nothing arrived? Check your spam folder.</p>
              {message && (
                <div
                  role="status"
                  className={`p-notice${message.error ? " error" : ""}`}
                >
                  {message.text}
                </div>
              )}
              <div className="p-auth-actions">
                {step === "check-email" && (
                  <button
                    className="p-button secondary"
                    disabled={busy}
                    onClick={resendVerification}
                  >
                    {busy ? "Sending…" : "Send a new link"}
                  </button>
                )}
                <button className="p-link" onClick={() => go("credentials")}>
                  {step === "check-email"
                    ? "Use a different email"
                    : "Back to sign in"}
                </button>
              </div>
            </>
          ) : (
            <>
              {intro[step] && <p>{intro[step]}</p>}
              {step === "factor" && (
                <p>
                  {recovery
                    ? "Enter one of the recovery codes you saved when you set up two-step verification."
                    : local
                      ? "Enter 123456 (local demo), or run npm run portal:code for a live code."
                      : "Enter the 6-digit code from your authenticator app."}
                </p>
              )}
              {step === "credentials" && signUp && (
                <p>
                  Use your work email. You&apos;ll set up your business after
                  confirming it.
                </p>
              )}
              {step === "credentials" && (
                <div className="p-auth-alt">
                  {google && (
                    <button
                      type="button"
                      className="p-button secondary"
                      disabled={busy}
                      onClick={withGoogle}
                    >
                      <GoogleMark />{" "}
                      {signUp ? "Sign up with Google" : "Continue with Google"}
                    </button>
                  )}
                  {!signUp && (
                    <button
                      type="button"
                      className="p-button secondary"
                      disabled={busy}
                      onClick={withPasskey}
                    >
                      Sign in with a passkey
                    </button>
                  )}
                  <button
                    type="button"
                    className="p-button secondary"
                    disabled={busy}
                    onClick={() => go("sso")}
                  >
                    Use company SSO
                  </button>
                  <p className="p-auth-or">
                    <span>or with your email</span>
                  </p>
                </div>
              )}
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const data = new FormData(event.currentTarget);
                  void run(() => submit(data));
                }}
              >
                {step === "factor" || step === "code" ? (
                  <Field
                    label={
                      step === "code"
                        ? "Sign-in code"
                        : recovery
                          ? "Recovery code"
                          : "Authentication code"
                    }
                  >
                    <input
                      key={step + String(recovery)}
                      name="code"
                      autoComplete="one-time-code"
                      inputMode={
                        recovery && step === "factor" ? "text" : "numeric"
                      }
                      pattern={
                        recovery && step === "factor" ? undefined : "[0-9]{6}"
                      }
                      placeholder={
                        recovery && step === "factor" ? "" : "000000"
                      }
                      autoFocus
                      required
                    />
                  </Field>
                ) : (
                  <>
                    {signUp && step === "credentials" && (
                      <Field label="Full name">
                        <input
                          name="name"
                          autoComplete="name"
                          maxLength={120}
                          required
                        />
                      </Field>
                    )}
                    <Field label={step === "sso" ? "Work email" : "Email"}>
                      <input
                        name="email"
                        type="email"
                        autoComplete={
                          !signUp && step === "credentials"
                            ? "username webauthn"
                            : "email"
                        }
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                      />
                    </Field>
                    {step === "credentials" && (
                      <Field
                        label="Password"
                        hint={signUp ? "At least 12 characters." : undefined}
                      >
                        <input
                          name="password"
                          type="password"
                          minLength={signUp ? 12 : undefined}
                          maxLength={128}
                          autoComplete={
                            signUp ? "new-password" : "current-password"
                          }
                          required
                        />
                      </Field>
                    )}
                  </>
                )}
                {message && (
                  <div
                    role="alert"
                    className={`p-notice${message.error ? " error" : ""}`}
                  >
                    {message.text}
                  </div>
                )}
                <button className="p-button" disabled={busy}>
                  {busy
                    ? "Please wait…"
                    : (submitLabel[step] ??
                      (signUp ? "Create account" : "Sign in"))}
                </button>
              </form>
              {step === "factor" ? (
                <button
                  className="p-link"
                  onClick={() => setRecovery(!recovery)}
                >
                  {recovery
                    ? "Use your authenticator app"
                    : "Use a recovery code"}
                </button>
              ) : step === "code" ? (
                <div className="p-auth-actions">
                  <button
                    className="p-link"
                    disabled={busy}
                    onClick={() => go("code-request")}
                  >
                    Send a new code
                  </button>
                  <button className="p-link" onClick={() => go("credentials")}>
                    Back to sign in
                  </button>
                </div>
              ) : step !== "credentials" ? (
                <button className="p-link" onClick={() => go("credentials")}>
                  Back to sign in
                </button>
              ) : (
                <>
                  {base === "/provider" && !signUp && !invited ? (
                    <p>
                      Want to offer your payment service on PayRouta?{" "}
                      <Link href="/partners#request">Request provider access</Link>
                    </p>
                  ) : (
                    <p>
                      {signUp ? "Already have an account? " : "New to PayRouta? "}
                      <Link
                        href={`${base}/${signUp ? "sign-in" : "sign-up"}${suffix}`}
                      >
                        {signUp ? "Sign in" : invited ? "Create your login" : "Create an account"}
                      </Link>
                    </p>
                  )}
                  {!signUp && (
                    <div className="p-auth-actions">
                      <button
                        className="p-link"
                        onClick={() => go("code-request")}
                      >
                        Email me a sign-in code
                      </button>
                      <button className="p-link" onClick={() => go("reset")}>
                        Forgot your password?
                      </button>
                    </div>
                  )}
                  {signUp && (
                    <p className="p-auth-legal">
                      By creating an account you agree to the{" "}
                      <Link href="/terms">Terms of Service</Link> and{" "}
                      <Link href="/privacy">Privacy Policy</Link>.
                    </p>
                  )}
                </>
              )}
            </>
          )}
          {local && (
            <div className="p-local-note">
              Local development · fictional accounts only.{" "}
              <Link href="/provider/dev-mail">Open the local mail capture</Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"
      />
    </svg>
  );
}
export function SecuritySettings({
  enabled,
  execute,
}: {
  enabled: boolean;
  execute: (data: Record<string, unknown>) => Promise<unknown>;
}) {
  const [uri, setUri] = useState("");
  const [codes, setCodes] = useState<string[]>([]);
  const [error, setError] = useState("");
  return (
    <div className="p-stack">
      <p>
        {enabled
          ? "Authenticator enabled. Verify a fresh code to authorize sensitive actions for 15 minutes."
          : "Enable an authenticator before managing credentials, memberships, or internal review."}
      </p>
      {!enabled && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const r = await authClient.twoFactor.enable({
              password: String(f.get("password")),
            });
            if (r.error) setError(r.error.message || "Enrollment failed");
            else if (r.data && "totpURI" in r.data) {
              setUri(r.data.totpURI);
              setCodes(r.data.backupCodes);
            }
          }}
        >
          <Field label="Current password">
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </Field>
          <button className="p-button">Set up authenticator</button>
        </form>
      )}
      {uri && (
        <div className="p-notice">
          <p>
            Add this secret to your authenticator. Keep your recovery codes
            private.
          </p>
          <code className="p-wrap">{uri}</code>
          <JsonViewCodes codes={codes} />
        </div>
      )}
      {(enabled || uri) && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const code = String(new FormData(e.currentTarget).get("code"));
            if (uri) {
              const r = await authClient.twoFactor.verifyTotp({
                code,
                trustDevice: false,
              });
              if (r.error) {
                setError(r.error.message || "Invalid code");
                return;
              }
            }
            await execute({ action: "step-up", code });
          }}
        >
          <Field label="Authenticator code">
            <input
              name="code"
              inputMode="numeric"
              pattern="[0-9]{6}"
              autoComplete="one-time-code"
              required
            />
          </Field>
          <button className="p-button">Verify for sensitive actions</button>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
function JsonViewCodes({ codes }: { codes: string[] }) {
  return (
    <details>
      <summary>Recovery codes — save once</summary>
      <pre>{codes.join("\n")}</pre>
    </details>
  );
}
export function ResetPassword({
  token,
  error,
  base = "/provider",
}: {
  token: string;
  error?: string;
  base?: "" | "/provider";
}) {
  const [message, setMessage] = useState<{ text: string; error?: boolean }>();
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const invalid = !token || error === "INVALID_TOKEN";
  return (
    <div className="portal p-auth-solo">
      <div className="p-auth-card">
        <Link href="/" aria-label="PayRouta home">
          <BrandLogo />
        </Link>
        <h1>
          {done
            ? "Password updated"
            : invalid
              ? "This link has expired"
              : "Choose a new password"}
        </h1>
        {invalid ? (
          <>
            <p>
              Reset links work once and expire after an hour. Ask for a new one
              from the sign-in page.
            </p>
            <Link className="p-button" href={`${base}/sign-in`}>
              Back to sign in
            </Link>
          </>
        ) : done ? (
          <>
            <p>
              We&apos;ve signed you out everywhere. Sign in with your new
              password.
            </p>
            <Link className="p-button" href={`${base}/sign-in`}>
              Sign in
            </Link>
          </>
        ) : (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const newPassword = String(f.get("password"));
              if (newPassword !== String(f.get("confirm")))
                return setMessage({
                  text: "The two passwords don't match.",
                  error: true,
                });
              setBusy(true);
              const result = await authClient.resetPassword({
                token,
                newPassword,
              });
              setBusy(false);
              if (result.error)
                setMessage({
                  text:
                    result.error.code === "INVALID_TOKEN"
                      ? "This link has expired. Ask for a new one from the sign-in page."
                      : result.error.message ||
                        "We couldn't update your password.",
                  error: true,
                });
              else setDone(true);
            }}
          >
            <Field label="New password" hint="At least 12 characters.">
              <input
                type="password"
                name="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                required
              />
            </Field>
            <Field label="Confirm new password">
              <input
                type="password"
                name="confirm"
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                required
              />
            </Field>
            {message && (
              <div
                role="alert"
                className={`p-notice${message.error ? " error" : ""}`}
              >
                {message.text}
              </div>
            )}
            <button className="p-button" disabled={busy}>
              {busy ? "Please wait…" : "Update password"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

type PasskeyRow = {
  id: string;
  name?: string | null;
  createdAt?: string | Date | null;
  deviceType?: string;
};

// Add, list and remove passkeys for the signed-in account.
export function PasskeySettings() {
  const listed = authClient.useListPasskeys();
  const rows = (listed.data ?? []) as PasskeyRow[];
  const load = async () => {
    await listed.refetch?.();
  };
  const [message, setMessage] = useState<{ text: string; error?: boolean }>();
  const [busy, setBusy] = useState(false);
  return (
    <div className="p-stack">
      <p>
        Sign in with Face ID, Touch ID, Windows Hello or a security key instead
        of a password. Passkeys can&apos;t be phished or reused on another site.
      </p>
      {rows.length > 0 && (
        <ul className="p-passkeys">
          {rows.map((p) => (
            <li key={p.id}>
              <span>
                <strong>{p.name || "Passkey"}</strong>
                {p.createdAt && (
                  <small>
                    {" "}
                    · added {new Date(p.createdAt).toLocaleDateString()}
                  </small>
                )}
              </span>
              <button
                className="p-link"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  const r = await authClient.passkey.deletePasskey({
                    id: p.id,
                  });
                  setBusy(false);
                  setMessage(
                    r.error
                      ? { text: "Couldn't remove that passkey.", error: true }
                      : { text: "Passkey removed." },
                  );
                  await load();
                }}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const name =
            String(new FormData(e.currentTarget).get("name") || "").trim() ||
            undefined;
          setBusy(true);
          setMessage(undefined);
          const r = await authClient.passkey.addPasskey({ name });
          setBusy(false);
          if (r?.error)
            setMessage({
              text: r.error.message || "The passkey wasn't saved. Try again.",
              error: true,
            });
          else {
            setMessage({
              text: "Passkey added. You can use it next time you sign in.",
            });
            (e.target as HTMLFormElement).reset();
            await load();
          }
        }}
      >
        <Field label="Name (optional)" hint="For example, Work laptop">
          <input name="name" maxLength={60} />
        </Field>
        <button className="p-button" disabled={busy}>
          {busy ? "Please wait…" : "Add a passkey"}
        </button>
      </form>
      {message && (
        <p role="status" className={`p-notice${message.error ? " error" : ""}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
