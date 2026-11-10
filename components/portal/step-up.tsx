"use client";
// Confirming it's you, where the action happens (lib/portal/step-up.ts).
//
// Any dashboard request that comes back STEP_UP_REQUIRED opens this dialog:
// a passkey, an authenticator code or a recovery code, then the request is
// sent again and the page carries on as if nothing happened. An account
// without two-step verification (TWO_STEP_REQUIRED) can add a passkey right
// here, or go to its security settings. Cancelling returns the original
// answer, so the page shows its usual message.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { startAuthentication } from "@simplewebauthn/browser";
import { authClient } from "./auth-screen";
import { errorText } from "@/lib/error-copy";
import "./step-up.css";

type Kind = "confirm" | "setup";
type Ctx = { securityHref: string; request: (kind?: Kind) => Promise<boolean> };
const StepUpContext = createContext<Ctx | null>(null);

export const useStepUp = () => useContext(StepUpContext);

// "Confirm it's you" as a link-like button anywhere inside a dashboard.
export function StepUpLink({ children = "Confirm it's you" }: { children?: ReactNode }) {
  const ctx = useStepUp();
  const router = useRouter();
  if (!ctx) return null;
  return (
    <button type="button" className="su-link" onClick={() => void ctx.request().then((ok) => ok && router.refresh())}>
      {children}
    </button>
  );
}

const command = (body: Record<string, unknown>) =>
  fetch("/api/portal/command", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function answer(r: Response) {
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error(errorText(body, r.status));
  return body;
}

export function StepUpProvider({ securityHref, children }: { securityHref: string; children: ReactNode }) {
  const [kind, setKind] = useState<Kind | null>(null);
  const pending = useRef<{ promise: Promise<boolean>; resolve: (ok: boolean) => void } | null>(null);

  const request = useCallback((k: Kind = "confirm") => {
    if (pending.current) return pending.current.promise;
    let resolve!: (ok: boolean) => void;
    const promise = new Promise<boolean>((r) => (resolve = r));
    pending.current = { promise, resolve };
    setKind(k);
    return promise;
  }, []);
  const finish = useCallback((ok: boolean) => {
    pending.current?.resolve(ok);
    pending.current = null;
    setKind(null);
  }, []);

  // Every same-origin API call: confirm and send again on STEP_UP_REQUIRED.
  useEffect(() => {
    const original = window.fetch;
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
      const api = url.origin === location.origin && url.pathname.startsWith("/api/");
      const again = api && input instanceof Request ? input.clone() : null;
      const response = await original(input, init);
      if (!api || response.status !== 403) return response;
      const code = await response
        .clone()
        .json()
        .then((b: { error?: unknown }) => b?.error)
        .catch(() => null);
      if (code !== "STEP_UP_REQUIRED" && code !== "TWO_STEP_REQUIRED") return response;
      const ok = await request(code === "TWO_STEP_REQUIRED" ? "setup" : "confirm");
      return ok ? original(again ?? input, init) : response;
    };
    return () => {
      window.fetch = original;
    };
  }, [request]);

  return (
    <StepUpContext.Provider value={{ securityHref, request }}>
      {children}
      {kind && <StepUpDialog kind={kind} securityHref={securityHref} onKind={setKind} onDone={finish} />}
    </StepUpContext.Provider>
  );
}

function StepUpDialog({
  kind,
  securityHref,
  onKind,
  onDone,
}: {
  kind: Kind;
  securityHref: string;
  onKind: (k: Kind) => void;
  onDone: (ok: boolean) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [methods, setMethods] = useState<{ authenticator: boolean; passkeys: number } | null>(null);
  const [recovery, setRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
  }, []);
  useEffect(() => {
    if (kind !== "confirm") return;
    let alive = true;
    void command({ action: "step-up-methods" })
      .then(answer)
      .then((m) => alive && setMethods(m))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [kind]);

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      const err = e as Error & { name?: string };
      setError(err.name === "NotAllowedError" ? "The passkey request was cancelled or timed out." : err.message || "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }
  const confirmWithPasskey = () =>
    run(async () => {
      const options = await answer(await command({ action: "step-up-passkey-options" }));
      const response = await startAuthentication({ optionsJSON: options });
      await answer(await command({ action: "step-up", method: "passkey", response }));
      onDone(true);
    });
  const addPasskey = () =>
    run(async () => {
      const r = await authClient.passkey.addPasskey({});
      if (r?.error) throw new Error(r.error.message || "The passkey wasn't saved. Try again.");
      // Now confirm with it.
      onKind("confirm");
    });

  return (
    <dialog
      ref={dialog}
      className="su-dialog"
      aria-labelledby="su-title"
      onCancel={(e) => {
        e.preventDefault();
        onDone(false);
      }}
    >
      {kind === "setup" ? (
        <>
          <h2 id="su-title">Turn on two-step verification</h2>
          <p>This action needs a passkey or an authenticator app on your account.</p>
          <div className="su-actions">
            <button type="button" className="su-primary" disabled={busy} onClick={() => void addPasskey()}>
              {busy ? "Waiting for your device…" : "Add a passkey"}
            </button>
            <Link className="su-secondary" href={securityHref} onClick={() => onDone(false)}>
              Use an authenticator app
            </Link>
          </div>
        </>
      ) : (
        <>
          <h2 id="su-title">Confirm it&apos;s you</h2>
          {!methods && !error && <p role="status">Loading…</p>}
          {methods && methods.passkeys > 0 && (
            <button type="button" className="su-primary su-wide" disabled={busy} onClick={() => void confirmWithPasskey()}>
              {busy ? "Waiting for your device…" : "Use your passkey"}
            </button>
          )}
          {methods?.authenticator && (
            <form
              className="su-form"
              onSubmit={(e) => {
                e.preventDefault();
                const code = String(new FormData(e.currentTarget).get("code")).replace(/\s/g, "");
                void run(async () => {
                  await answer(await command(recovery ? { action: "step-up", method: "recovery", code } : { action: "step-up", code }));
                  onDone(true);
                });
              }}
            >
              <label htmlFor="su-code">{recovery ? "Recovery code" : "Code from your authenticator app"}</label>
              <input
                id="su-code"
                name="code"
                autoFocus={!methods.passkeys}
                autoComplete="one-time-code"
                inputMode={recovery ? "text" : "numeric"}
                pattern={recovery ? undefined : "[0-9 ]{6,7}"}
                maxLength={recovery ? 32 : 7}
                required
              />
              <button className={methods.passkeys ? "su-secondary" : "su-primary"} disabled={busy}>
                Confirm
              </button>
              <button type="button" className="su-link" onClick={() => setRecovery(!recovery)}>
                {recovery ? "Use your authenticator app" : "Use a recovery code"}
              </button>
            </form>
          )}
          {methods && !methods.authenticator && !methods.passkeys && (
            <p>
              <Link href={securityHref} onClick={() => onDone(false)}>
                Set up two-step verification
              </Link>
            </p>
          )}
        </>
      )}
      {error && (
        <p className="su-error" role="alert">
          {error}
        </p>
      )}
      <button type="button" className="su-close" aria-label="Cancel" onClick={() => onDone(false)}>
        ×
      </button>
    </dialog>
  );
}
