"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createAuthClient } from "better-auth/react";
import { twoFactorClient } from "better-auth/client/plugins";
import { BrandLogo } from "../brand-logo";
import { Field } from "./ui";
export const authClient = createAuthClient({ plugins: [twoFactorClient()] });
export function AuthScreen({
  signUp = false,
  local = false,
}: {
  signUp?: boolean;
  local?: boolean;
}) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [factor, setFactor] = useState(false);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [reset, setReset] = useState(false);
  return (
    <div className="portal p-auth">
      <div className="p-auth-brand">
        <Link href="/">
          <BrandLogo reverse />
        </Link>
        <div>
          <h1>
            A clearer path
            <br />
            to joining PayRouta.
          </h1>
          <p>
            Describe your capabilities, test your integration, and follow your
            application through review.
          </p>
        </div>
        <small>Provider workspace · Secure account access</small>
      </div>
      <div className="p-auth-form">
        <div className="p-auth-card">
          <p className="p-muted">PayRouta provider workspace</p>
          <h1>
            {factor
              ? "Verify your identity"
              : reset
                ? "Reset your password"
                : signUp
                  ? "Create your account"
                  : "Welcome back"}
          </h1>
          <p>
            {factor
              ? "Enter the six-digit code from your authenticator."
              : signUp
                ? "Start with your business email. You’ll create your organization after verification."
                : "Sign in to manage your organization."}
          </p>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              setMessage("");
              const f = new FormData(event.currentTarget);
              try {
                if (factor) {
                  const r = await authClient.twoFactor.verifyTotp({
                    code: String(f.get("code")),
                    trustDevice: false,
                  });
                  if (r.error) throw new Error(r.error.message);
                  router.push("/provider/overview");
                } else if (reset) {
                  const r = await authClient.requestPasswordReset({
                    email,
                    redirectTo: "/provider/reset-password",
                  });
                  if (r.error) throw new Error(r.error.message);
                  setMessage(
                    "If the account exists, reset instructions are available through the configured mail adapter.",
                  );
                } else if (signUp) {
                  const r = await authClient.signUp.email({
                    name: String(f.get("name")),
                    email,
                    password: String(f.get("password")),
                    callbackURL: "/provider/organizations/new",
                  });
                  if (r.error) throw new Error(r.error.message);
                  setMessage(
                    local
                      ? "Account created. Open the local mail capture to verify your email. No email was sent."
                      : "Check your email to verify your account.",
                  );
                } else {
                  const r = await authClient.signIn.email({
                    email,
                    password: String(f.get("password")),
                  });
                  if (r.error) throw new Error(r.error.message);
                  if (
                    r.data &&
                    "twoFactorRedirect" in r.data &&
                    r.data.twoFactorRedirect
                  )
                    setFactor(true);
                  else router.push("/provider/overview");
                }
              } catch (e) {
                setMessage(
                  e instanceof Error ? e.message : "Unable to sign in",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            {factor ? (
              <Field label="Authenticator code">
                <input
                  name="code"
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  required
                />
              </Field>
            ) : (
              <>
                {signUp && (
                  <Field label="Your name">
                    <input name="name" autoComplete="name" required />
                  </Field>
                )}
                <Field label="Business email">
                  <input
                    name="email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </Field>
                {!reset && (
                  <Field
                    label="Password"
                    hint={signUp ? "Use at least 12 characters." : undefined}
                  >
                    <input
                      name="password"
                      type="password"
                      minLength={12}
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
              <div role="status" className="p-notice">
                {message}
              </div>
            )}
            <button className="p-button" disabled={busy}>
              {busy
                ? "Please wait…"
                : factor
                  ? "Verify code"
                  : reset
                    ? "Send reset instructions"
                    : signUp
                      ? "Create account"
                      : "Sign in"}
            </button>
          </form>
          <p>
            {signUp ? "Already have an account? " : "New to PayRouta? "}
            <Link href={signUp ? "/provider/sign-in" : "/provider/sign-up"}>
              {signUp ? "Sign in" : "Create an account"}
            </Link>
          </p>
          {!signUp && !factor && (
            <button className="p-link" onClick={() => setReset(!reset)}>
              {reset ? "Back to sign in" : "Forgot password?"}
            </button>
          )}
          {local && (
            <div className="p-local-note">
              Local development · Fictional accounts only.
              <br />
              <Link href="/provider/dev-mail">Open local mail capture</Link>
            </div>
          )}
        </div>
      </div>
    </div>
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
export function ResetPassword({ token }: { token: string }) {
  const [message, setMessage] = useState("");
  return (
    <div className="portal p-simple">
      <h1>Choose a new password</h1>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const result = await authClient.resetPassword({
            token,
            newPassword: String(new FormData(e.currentTarget).get("password")),
          });
          setMessage(
            result.error?.message || "Password updated. You can sign in.",
          );
        }}
      >
        <Field label="New password">
          <input type="password" name="password" minLength={12} required />
        </Field>
        <button className="p-button">Update password</button>
        <p role="status">{message}</p>
        <Link href="/provider/sign-in">Return to sign in</Link>
      </form>
    </div>
  );
}
